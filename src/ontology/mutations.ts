import type { App, TFile } from 'obsidian';

import type { OntologyIndex, OntologyIssue } from './types.ts';

import { getInheritedCanHave, getInheritedMustHave, resolveEntityRelations } from './compose.ts';
import { extractAssertedLinkTargets, toWikiLink } from './links.ts';

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
  kind: 'optional' | 'relation' | 'required';
  property: string;
}

function findFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file && 'extension' in file && file.extension === 'md' ? file as TFile : null;
}

export function planScaffoldEntity(index: OntologyIndex, path: string): ScaffoldFieldPlan[] {
  const entity = index.entities.get(path);
  if (!entity) {
    return [];
  }

  const plans = new Map<string, ScaffoldFieldPlan>();
  for (const property of getInheritedMustHave(index, entity).keys()) {
    if (!(property in entity.frontmatter)) {
      plans.set(property, { kind: 'required', property });
    }
  }
  for (const property of getInheritedCanHave(index, entity).keys()) {
    if (!(property in entity.frontmatter) && !plans.has(property)) {
      plans.set(property, { kind: 'optional', property });
    }
  }
  for (const property of resolveEntityRelations(index, entity.instanceOf).keys()) {
    if (!(property in entity.frontmatter) && !plans.has(property)) {
      plans.set(property, { kind: 'relation', property });
    }
  }
  return [...plans.values()];
}

export async function applyScaffoldPlan(app: App, file: TFile, plans: ScaffoldFieldPlan[]): Promise<number> {
  const properties = [...new Set(plans.map((plan) => plan.property))];
  let added = 0;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const data = frontmatter as Record<string, unknown>;
    for (const property of properties) {
      if (!(property in data)) {
        data[property] = null;
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
