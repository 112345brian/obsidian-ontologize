import type { App, TFile } from 'obsidian';

import { Notice } from 'obsidian';

import type { OntologyIndex, OntologyIssue, RelationDefinition } from './types.ts';

import { getInheritedCanHave, getInheritedMustHave } from './indexer.ts';
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

function findFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file && 'extension' in file && file.extension === 'md' ? file as TFile : null;
}

export async function scaffoldEntity(app: App, index: OntologyIndex, file: TFile): Promise<number> {
  const entity = index.entities.get(file.path);
  if (!entity) {
    new Notice('This note has no instance_of/type frontmatter.');
    return 0;
  }

  const properties = new Map([...getInheritedCanHave(index, entity), ...getInheritedMustHave(index, entity)]);
  let added = 0;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const data = frontmatter as Record<string, unknown>;
    for (const property of properties.keys()) {
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

function typeCompositionChain(typeName: string, index: OntologyIndex, seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  const addTypeAndInterfaces = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    names.add(name);
    const type = index.types.get(name);
    for (const interfaceName of type?.implements ?? []) {
      addTypeAndInterfaces(interfaceName);
    }
  };

  for (const ancestor of index.ancestorsByType.get(typeName) ?? []) {
    addTypeAndInterfaces(ancestor);
  }
  addTypeAndInterfaces(typeName);
  return names;
}

function resolveRelation(index: OntologyIndex, property: string, relation: RelationDefinition): RelationDefinition {
  const referenced = relation.uses ? index.relationDefinitions.get(relation.uses) : index.relationDefinitions.get(property);
  return referenced ? { ...referenced, ...relation, uses: relation.uses } : relation;
}

function findRelation(index: OntologyIndex, typeNames: string[], property: string): RelationDefinition | undefined {
  for (const typeName of typeNames) {
    for (const name of typeCompositionChain(typeName, index)) {
      const relation = index.types.get(name)?.relations.get(property);
      if (relation) {
        return resolveRelation(index, property, relation);
      }
    }
  }
  return undefined;
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

    const property = issue.property;
    const sourceValue = sourceEntity.frontmatter[property];
    const relation = findRelation(index, sourceEntity.instanceOf, property);
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
