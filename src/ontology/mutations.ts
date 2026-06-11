import type { App, TFile } from 'obsidian';

import type { FrontmatterValue, OntologyIndex, OntologyIssue, PropertyDefinition } from './types.ts';

import { getInheritedCanHave, getInheritedMustHave, resolveEntityRelations } from './compose.ts';
import { containsFrontmatterValue, extractAssertedLinkTargets, toWikiLink } from './links.ts';
import { isInsertTemplate, resolveInsertTemplate } from './templates.ts';

export interface FixMissingInversesOptions {
  onlyAutoUpdate?: boolean;
}

export interface MissingInverseFixPlan {
  autoUpdate: boolean;
  inverseProperty: string;
  message: string;
  sourceName: string;
  sourcePath: string;
  sourceProperty: string;
  targetName: string;
  targetPath: string;
  value: string;
}

export interface ScaffoldFieldPlan {
  insert?: FrontmatterValue | undefined;
  kind: 'optional' | 'relation' | 'required';
  property: string;
}

export interface ApplyScaffoldPlanOptions {
  now?: Date | undefined;
}

function findFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file && 'extension' in file && file.extension === 'md' ? file as TFile : null;
}

function scaffoldPlan(property: string, kind: ScaffoldFieldPlan['kind'], definition?: PropertyDefinition): ScaffoldFieldPlan {
  return {
    ...(definition?.insert !== undefined ? { insert: definition.insert } : {}),
    kind,
    property,
  };
}

function needsScaffold(frontmatter: Record<string, unknown>, property: string, definition?: PropertyDefinition): boolean {
  if (!(property in frontmatter)) {
    return true;
  }
  if (isInsertTemplate(definition?.insert)) {
    return false;
  }
  return definition?.insert !== undefined && !containsFrontmatterValue(frontmatter[property], definition.insert);
}

export function planScaffoldEntity(index: OntologyIndex, path: string): ScaffoldFieldPlan[] {
  const entity = index.entities.get(path);
  if (!entity) {
    return [];
  }

  const plans = new Map<string, ScaffoldFieldPlan>();
  for (const [property, definition] of getInheritedMustHave(index, entity)) {
    if (needsScaffold(entity.frontmatter, property, definition)) {
      plans.set(property, scaffoldPlan(property, 'required', definition));
    }
  }
  for (const [property, definition] of getInheritedCanHave(index, entity)) {
    if (needsScaffold(entity.frontmatter, property, definition) && !plans.has(property)) {
      plans.set(property, scaffoldPlan(property, 'optional', definition));
    }
  }
  for (const property of resolveEntityRelations(index, entity.instanceOf).keys()) {
    if (!(property in entity.frontmatter) && !plans.has(property)) {
      plans.set(property, { kind: 'relation', property });
    }
  }
  return [...plans.values()];
}

export async function applyScaffoldPlan(app: App, file: TFile, plans: ScaffoldFieldPlan[], options: ApplyScaffoldPlanOptions = {}): Promise<number> {
  let added = 0;
  const now = options.now ?? new Date();
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const data = frontmatter as Record<string, unknown>;
    for (const plan of plans) {
      const existing = data[plan.property];
      if (plan.insert !== undefined) {
        const template = isInsertTemplate(plan.insert);
        const insertedValue = resolveInsertTemplate(plan.insert, { now });
        const empty = existing === undefined || existing === null || existing === '' || (Array.isArray(existing) && existing.length === 0);
        if (template) {
          if (empty) {
            data[plan.property] = insertedValue;
            added++;
          }
          continue;
        }
        if (containsFrontmatterValue(existing, insertedValue)) {
          continue;
        }
        if (empty) {
          data[plan.property] = insertedValue;
        } else if (Array.isArray(existing)) {
          existing.push(insertedValue);
        } else {
          data[plan.property] = [existing, insertedValue];
        }
        added++;
      } else if (!(plan.property in data)) {
        data[plan.property] = null;
        added++;
      }
    }
  });
  return added;
}

function inverseIssueKey(issue: OntologyIssue): string {
  return `${issue.file}:${issue.property ?? ''}:${issue.target ?? ''}`;
}

export function planMissingInverses(index: OntologyIndex, options: FixMissingInversesOptions = {}): MissingInverseFixPlan[] {
  const issues = index.issues.filter((issue) => issue.autofixable && (!options.onlyAutoUpdate || issue.autoUpdate));
  const uniqueIssues = [...new Map(issues.map((issue) => [inverseIssueKey(issue), issue])).values()];
  const plans: MissingInverseFixPlan[] = [];

  for (const issue of uniqueIssues) {
    if (!issue.property || !issue.target) {
      continue;
    }
    const sourceEntity = index.entities.get(issue.file);
    const targetEntity = index.entitiesByName.get(issue.target);
    if (!sourceEntity || !targetEntity) {
      continue;
    }
    // An ambiguous target name cannot be resolved to a single file, so writing
    // the inverse would land on an arbitrary note. Skip rather than guess.
    if (index.ambiguousEntityNames?.has(issue.target)) {
      continue;
    }

    const property = issue.property;
    const sourceValue = sourceEntity.frontmatter[property];
    const relation = resolveEntityRelations(index, sourceEntity.instanceOf).get(property);
    const inverseProperty = relation?.symmetric ? property : relation?.inverse;
    if (!inverseProperty || !extractAssertedLinkTargets(sourceValue).includes(targetEntity.name)) {
      continue;
    }

    plans.push({
      autoUpdate: issue.autoUpdate === true,
      inverseProperty,
      message: issue.message,
      sourceName: sourceEntity.name,
      sourcePath: sourceEntity.path,
      sourceProperty: property,
      targetName: targetEntity.name,
      targetPath: targetEntity.path,
      value: toWikiLink(sourceEntity.name),
    });
  }

  return plans;
}

export async function applyMissingInversePlans(app: App, plans: MissingInverseFixPlan[]): Promise<number> {
  let fixed = 0;

  for (const plan of plans) {
    const targetFile = findFile(app, plan.targetPath);
    if (!targetFile) {
      continue;
    }

    await app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
      const data = frontmatter as Record<string, unknown>;
      const existing = data[plan.inverseProperty];
      const existingTargets = extractAssertedLinkTargets(existing);
      if (existingTargets.includes(plan.sourceName)) {
        return;
      }
      if (Array.isArray(existing)) {
        existing.push(plan.value);
      } else if (existing === undefined || existing === null || existing === '') {
        data[plan.inverseProperty] = [plan.value];
      } else {
        data[plan.inverseProperty] = [existing, plan.value];
      }
      fixed++;
    });
  }

  return fixed;
}

export async function fixMissingInverses(app: App, index: OntologyIndex, options: FixMissingInversesOptions = {}): Promise<number> {
  return applyMissingInversePlans(app, planMissingInverses(index, options));
}
