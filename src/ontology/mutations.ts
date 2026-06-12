import type { App, TFile } from 'obsidian';

import type { AutoApplyBlock, FrontmatterValue, OntologyEntity, OntologyIndex, OntologyIssue, PropertyDefinition, RelationDefinition, TypeReplacement } from './types.ts';

import { getInheritedCanHave, getInheritedMustHave, resolveEntityRelations } from './compose.ts';
import { containsFrontmatterValue, extractAssertedLinkTargets, normalizeLinkTarget, toWikiLink } from './links.ts';
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
  candidates?: string[] | undefined;
  existingValue?: unknown;
  insert?: FrontmatterValue | undefined;
  kind: 'optional' | 'relation' | 'required';
  property: string;
}

export interface ApplyScaffoldPlanOptions {
  now?: Date | undefined;
}

function removeReplacementValue(frontmatter: Record<string, unknown>, field: string, value: string): boolean {
  const current = frontmatter[field];
  if (typeof current === 'string') {
    if (normalizeLinkTarget(current) !== value) {
      return false;
    }
    delete frontmatter[field];
    return true;
  }
  if (!Array.isArray(current)) {
    return false;
  }
  const filtered = current.filter((item) => normalizeLinkTarget(String(item)) !== value);
  if (filtered.length === current.length) {
    return false;
  }
  if (filtered.length === 0) {
    delete frontmatter[field];
  } else {
    frontmatter[field] = filtered.length === 1 ? filtered[0] : filtered;
  }
  return true;
}

function addReplacementValue(frontmatter: Record<string, unknown>, field: string, value: string): void {
  const linkedValue = toWikiLink(value);
  const current = frontmatter[field];
  if (current === undefined || current === null || current === '') {
    frontmatter[field] = linkedValue;
    return;
  }
  const values: unknown[] = Array.isArray(current) ? current as unknown[] : [current];
  if (values.some((item) => normalizeLinkTarget(String(item)) === value)) {
    return;
  }
  frontmatter[field] = [...values, linkedValue];
}

/** Applies backward-compatible remove-only rules and from/to replacement rules. */
export function applyTypeReplacements(
  frontmatter: Record<string, unknown>,
  replacements: TypeReplacement[],
  defaultFields: string[],
): void {
  for (const replacement of replacements) {
    const sourceFields = replacement.field ? [replacement.field] : defaultFields;
    let addedToExplicitDestination = false;
    for (const sourceField of sourceFields) {
      if (!removeReplacementValue(frontmatter, sourceField, replacement.value) || !replacement.newValue) {
        continue;
      }
      const destinationField = replacement.newField ?? sourceField;
      if (replacement.newField && addedToExplicitDestination) {
        continue;
      }
      addReplacementValue(frontmatter, destinationField, replacement.newValue);
      addedToExplicitDestination = true;
    }
  }
}

function findFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file && 'extension' in file && file.extension === 'md' ? file as TFile : null;
}

function buildCandidates(
  index: OntologyIndex,
  definition: PropertyDefinition | undefined,
  relDef: RelationDefinition | undefined,
): string[] | undefined {
  if (definition?.values?.length) {
    return definition.values;
  }
  if (relDef !== undefined) {
    const rangeType = relDef.range ? normalizeLinkTarget(relDef.range) : undefined;
    const entities = [...index.entities.values()];
    const filtered = rangeType ? entities.filter((e) => e.instanceOf.includes(rangeType)) : entities;
    return filtered.sort((a, b) => a.name.localeCompare(b.name)).map((e) => `[[${e.name}]]`);
  }
  if (definition?.type?.includes('wikilink')) {
    return [...index.entities.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `[[${e.name}]]`);
  }
  return undefined;
}

function scaffoldPlan(
  property: string,
  kind: ScaffoldFieldPlan['kind'],
  index: OntologyIndex,
  definition?: PropertyDefinition,
  relDef?: RelationDefinition,
): ScaffoldFieldPlan {
  return {
    candidates: buildCandidates(index, definition, relDef),
    ...(definition?.insert !== undefined ? { insert: definition.insert } : {}),
    kind,
    property,
  };
}

function looksLikeWikilinks(value: unknown): boolean {
  if (typeof value === 'string') { return /\[\[.+\]\]/.test(value); }
  if (Array.isArray(value)) { return value.length > 0 && value.every((v) => typeof v === 'string' && /\[\[.+\]\]/.test(v)); }
  return false;
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

const COMPARISON_RE = /^(>=|<=|!=|==|>|<)\s*(.+)$/;

function evalConditionValue(actual: unknown, expected: unknown): boolean {
  if (actual === undefined || actual === null) {
    return false;
  }
  if (typeof expected === 'string') {
    const m = COMPARISON_RE.exec(expected);
    const op = m?.[1];
    const rhs = m?.[2];
    if (op !== undefined && rhs !== undefined) {
      const numRhs = Number(rhs);
      const numActual = typeof actual === 'number' || typeof actual === 'string' ? Number(actual) : Number.NaN;
      if (!Number.isNaN(numRhs) && !Number.isNaN(numActual)) {
        if (op === '>') { return numActual > numRhs; }
        if (op === '<') { return numActual < numRhs; }
        if (op === '>=') { return numActual >= numRhs; }
        if (op === '<=') { return numActual <= numRhs; }
        if (op === '!=') { return numActual !== numRhs; }
        if (op === '==') { return numActual === numRhs; }
      }
      const strActual = typeof actual === 'string' || typeof actual === 'number' || typeof actual === 'boolean' ? String(actual) : undefined;
      const strRhs = rhs.trim();
      if (op === '!=') { return strActual !== strRhs; }
      if (op === '==') { return strActual === strRhs; }
    }
  }
  // Allow plain names to match wikilink values: condition `up: philosopher`
  // should fire when the note has `up: [[philosopher]]`.
  if (typeof expected === 'string' && !COMPARISON_RE.test(expected)) {
    const actualTargets = extractAssertedLinkTargets(actual);
    if (actualTargets.length > 0 && actualTargets.includes(normalizeLinkTarget(expected))) {
      return true;
    }
  }
  return containsFrontmatterValue(actual, expected);
}

function evalAutoApplyBlock(frontmatter: Record<string, unknown>, block: AutoApplyBlock): boolean {
  const all: boolean[] = [
    ...Object.entries(block.conditions).map(([key, expected]) => evalConditionValue(frontmatter[key], expected)),
    ...Object.values(block.blocks).map((sub) => evalAutoApplyBlock(frontmatter, sub)),
  ];
  if (all.length === 0) {
    return false;
  }
  return block.match === 'all' ? all.every(Boolean) : all.some(Boolean);
}

export function shouldAutoApplyScaffold(index: OntologyIndex, entity: OntologyEntity): boolean {
  return entity.instanceOf.some((typeName) => {
    const type = index.types.get(typeName);
    if (!type?.autoApply) {
      return false;
    }
    if (type.autoApply === true) {
      return true;
    }
    return evalAutoApplyBlock(entity.frontmatter, type.autoApply);
  });
}

/**
 * Given raw frontmatter from an untyped note, return the first type whose
 * conditional auto-apply block matches.  Types with `autoApply: true` are
 * skipped — they only fire once an entity is already typed.
 */
export function detectAutoApplyType(index: OntologyIndex, frontmatter: Record<string, unknown>): string | null {
  for (const type of index.types.values()) {
    if (!type.autoApply || type.autoApply === true) {
      continue;
    }
    if (evalAutoApplyBlock(frontmatter, type.autoApply)) {
      return type.name;
    }
  }
  return null;
}

export function planScaffoldEntity(index: OntologyIndex, path: string): ScaffoldFieldPlan[] {
  const entity = index.entities.get(path);
  if (!entity) {
    return [];
  }

  const plans = new Map<string, ScaffoldFieldPlan>();
  for (const [property, definition] of getInheritedMustHave(index, entity)) {
    if (needsScaffold(entity.frontmatter, property, definition)) {
      const existing = entity.frontmatter[property];
      const plan = scaffoldPlan(property, 'required', index, definition);
      plans.set(property, existing != null ? { ...plan, existingValue: existing } : plan);
    }
  }
  for (const [property, definition] of getInheritedCanHave(index, entity)) {
    if (needsScaffold(entity.frontmatter, property, definition) && !plans.has(property)) {
      const existing = entity.frontmatter[property];
      const plan = scaffoldPlan(property, 'optional', index, definition);
      plans.set(property, existing != null ? { ...plan, existingValue: existing } : plan);
    }
  }
  for (const [property, relDef] of resolveEntityRelations(index, entity.instanceOf)) {
    if (plans.has(property)) { continue; }
    const existing = entity.frontmatter[property];
    if (!(property in entity.frontmatter)) {
      plans.set(property, scaffoldPlan(property, 'relation', index, undefined, relDef));
    } else if (!looksLikeWikilinks(existing)) {
      plans.set(property, { ...scaffoldPlan(property, 'relation', index, undefined, relDef), existingValue: existing });
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
