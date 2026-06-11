import type { App, TFile } from 'obsidian';

import type { EffectiveLockState, FrontmatterIgnoreRule, OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

import {
  collectGlobalFieldDefinitions,
  collectGlobalRelationDefinitions,
  pushIssueOnce,
  typeCompositionChain
} from './compose.ts';
import { normalizeLinkTarget } from './links.ts';
import { parseOntologyEntity, parseOntologySchema, parseOntologyType } from './parser.ts';
import { lintOntologySchemaSource, lintOntologyTypeSource } from './schema-linter.ts';
import { validateIndex, validateSchemaCompositionConflicts } from './validate.ts';

export interface BuildIndexSettings {
  entityTypeFields?: string[];
  filesToIgnore?: string[];
  foldersToIgnore?: string[];
  frontmatterIgnoreRules?: FrontmatterIgnoreRule[];
  schemaPath?: string;
  typeFolder: string;
}

function normalizedFolders(folders: string[] | undefined): string[] {
  return (folders ?? []).map((folder) => folder.trim().replace(/\/$/, '')).filter(Boolean);
}

function normalizedEntityTypeFields(fields: string[] | undefined): string[] {
  const normalized = (fields ?? []).map((field) => field.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : ['is-instance', 'type'];
}

function safePatternMatches(pattern: string, path: string): boolean {
  try {
    return new RegExp(pattern).test(path);
  } catch {
    return false;
  }
}

export function isIgnoredOntologyPath(path: string, settings: BuildIndexSettings): boolean {
  for (const folder of normalizedFolders(settings.foldersToIgnore)) {
    if (path === folder || path.startsWith(`${folder}/`)) {
      return true;
    }
  }

  return (settings.filesToIgnore ?? []).some((pattern) => pattern.trim() && safePatternMatches(pattern.trim(), path));
}

function frontmatterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => frontmatterValues(item));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const rawValue = String(value);
    return [rawValue, normalizeLinkTarget(rawValue)];
  }
  return [];
}

export function isIgnoredByFrontmatter(frontmatter: Record<string, unknown>, settings: BuildIndexSettings): boolean {
  for (const rule of settings.frontmatterIgnoreRules ?? []) {
    const key = rule.key.trim();
    if (!key || !(key in frontmatter)) {
      continue;
    }

    const expectedValue = rule.value?.trim();
    if (!expectedValue) {
      return true;
    }

    const expectedValues = new Set([expectedValue, normalizeLinkTarget(expectedValue)]);
    if (frontmatterValues(frontmatter[key]).some((value) => expectedValues.has(value))) {
      return true;
    }
  }
  return false;
}

export function isOntologyTypeFile(file: TFile, typeFolder: string): boolean {
  return file.extension === 'md' && file.path.startsWith(`${typeFolder.replace(/\/$/, '')}/`);
}

export function isOntologySchemaFile(file: TFile, schemaPath: string | undefined): boolean {
  return Boolean(schemaPath?.trim()) && file.path === schemaPath?.trim();
}

function createEmptyOntologyIndex(settings: BuildIndexSettings): OntologyIndex {
  return {
    ambiguousEntityNames: new Set<string>(),
    ancestorsByType: new Map<string, Set<string>>(),
    cacheVersion: 1,
    circularTypes: new Set<string>(),
    effectiveEntityLocks: new Map<string, EffectiveLockState>(),
    effectiveTypeLocks: new Map<string, EffectiveLockState>(),
    entities: new Map<string, OntologyEntity>(),
    entitiesByName: new Map<string, OntologyEntity>(),
    fieldDefinitions: new Map<string, PropertyDefinition>(),
    generatedAt: new Date().toISOString(),
    issues: [],
    relationDefinitions: new Map<string, RelationDefinition>(),
    schemaIssues: [],
    settings: {
      entityTypeFields: normalizedEntityTypeFields(settings.entityTypeFields),
      filesToIgnore: settings.filesToIgnore ?? [],
      foldersToIgnore: settings.foldersToIgnore ?? [],
      frontmatterIgnoreRules: settings.frontmatterIgnoreRules ?? [],
      schemaPath: settings.schemaPath ?? '',
      typeFolder: settings.typeFolder,
    },
    types: new Map<string, OntologyType>(),
  };
}

export function computeAncestors(
  types: Map<string, OntologyType>,
  issues: OntologyIssue[],
  circularTypes: Set<string> = new Set<string>()
): Map<string, Set<string>> {
  const ancestorsByType = new Map<string, Set<string>>();
  const visiting = new Set<string>();

  const visit = (name: string, stack: string[]): Set<string> => {
    if (ancestorsByType.has(name)) {
      return ancestorsByType.get(name)!;
    }
    const type = types.get(name);
    const ancestors = new Set<string>();
    if (!type) {
      return ancestors;
    }
    if (visiting.has(name)) {
      const cycleStart = stack.lastIndexOf(name);
      for (const member of stack.slice(cycleStart === -1 ? 0 : cycleStart)) {
        circularTypes.add(member);
      }
      circularTypes.add(name);
      pushIssueOnce(issues, {
        file: type.path,
        message: `Circular inheritance detected: ${[...stack, name].join(' -> ')}`,
        severity: 'error',
      });
      return ancestors;
    }

    visiting.add(name);
    for (const parent of type.extends) {
      if (!types.has(parent)) {
        pushIssueOnce(issues, {
          file: type.path,
          message: `Unknown parent type ${parent}`,
          severity: 'error',
        });
        continue;
      }
      ancestors.add(parent);
      for (const ancestor of visit(parent, [...stack, name])) {
        ancestors.add(ancestor);
      }
    }
    visiting.delete(name);
    ancestorsByType.set(name, ancestors);
    return ancestors;
  };

  for (const name of types.keys()) {
    visit(name, []);
  }
  return ancestorsByType;
}

function computeTypeLock(
  name: string,
  types: Map<string, OntologyType>,
  ancestorsByType: Map<string, Set<string>>,
  circularTypes: Set<string>
): EffectiveLockState {
  const type = types.get(name);
  if (!type?.lockIntent) {
    return { state: 'unlocked', reason: 'lock is not true' };
  }
  if (circularTypes.has(name)) {
    return { state: 'incomplete', reason: 'type is in a circular inheritance chain' };
  }
  for (const ancestor of ancestorsByType.get(name) ?? []) {
    if (circularTypes.has(ancestor)) {
      return { state: 'incomplete', reason: `ancestor ${ancestor} is in a circular inheritance chain` };
    }
    if (!types.get(ancestor)?.lockIntent) {
      return { state: 'incomplete', reason: `ancestor ${ancestor} is not locked` };
    }
  }
  for (const interfaceName of type.implements) {
    if (!types.get(interfaceName)?.lockIntent) {
      return { state: 'incomplete', reason: `interface ${interfaceName} is not locked` };
    }
  }
  return { state: 'locked' };
}

function computeEntityLock(entity: OntologyEntity, effectiveTypeLocks: Map<string, EffectiveLockState>): EffectiveLockState {
  if (!entity.lockIntent) {
    return { state: 'unlocked', reason: 'lock is not true' };
  }
  for (const typeName of entity.instanceOf) {
    const typeLock = effectiveTypeLocks.get(typeName);
    if (!typeLock || typeLock.state !== 'locked') {
      return { state: 'incomplete', reason: `type ${typeName} is not effectively locked` };
    }
  }
  return { state: 'locked' };
}

function matchesPathOrChild(candidatePath: string, path: string): boolean {
  return candidatePath === path || candidatePath.startsWith(`${path}/`);
}

function rebuildEntityNameIndex(index: OntologyIndex): void {
  const byName = new Map<string, OntologyEntity>();
  const counts = new Map<string, number>();
  for (const entity of index.entities.values()) {
    byName.set(entity.name, entity);
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  index.entitiesByName = byName;
  index.ambiguousEntityNames = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

export function recomputeOntologyDerivedState(index: OntologyIndex): OntologyIndex {
  index.issues = [...index.schemaIssues ?? []];
  rebuildEntityNameIndex(index);
  for (const name of index.ambiguousEntityNames ?? []) {
    const paths = [...index.entities.values()].filter((entity) => entity.name === name).map((entity) => entity.path).sort();
    pushIssueOnce(index.issues, {
      file: paths[0] ?? '',
      message: `Duplicate entity name ${name}: ${paths.join(', ')}. Wiki links to ${name} cannot be resolved unambiguously.`,
      severity: 'warning',
    });
  }
  const circularTypes = new Set<string>();
  index.ancestorsByType = computeAncestors(index.types, index.issues, circularTypes);
  index.circularTypes = circularTypes;
  index.fieldDefinitions = collectGlobalFieldDefinitions(index.types);
  index.relationDefinitions = collectGlobalRelationDefinitions(index.types);

  // Surface unknown/mis-marked interface issues once per type; every other
  // chain traversal (validation, queries, mutations) stays side-effect free.
  for (const name of index.types.keys()) {
    typeCompositionChain(name, index, index.issues);
  }
  validateSchemaCompositionConflicts(index);

  index.effectiveTypeLocks = new Map<string, EffectiveLockState>();
  for (const name of index.types.keys()) {
    index.effectiveTypeLocks.set(name, computeTypeLock(name, index.types, index.ancestorsByType, circularTypes));
  }

  index.effectiveEntityLocks = new Map<string, EffectiveLockState>();
  for (const entity of index.entities.values()) {
    index.effectiveEntityLocks.set(entity.path, computeEntityLock(entity, index.effectiveTypeLocks));
  }

  index.generatedAt = new Date().toISOString();
  validateIndex(index);
  return index;
}

function removeOntologyRecords(index: OntologyIndex, path: string): void {
  for (const [entityPath] of index.entities.entries()) {
    if (matchesPathOrChild(entityPath, path)) {
      index.entities.delete(entityPath);
    }
  }
  for (const [name, type] of index.types.entries()) {
    if (matchesPathOrChild(type.path, path)) {
      index.types.delete(name);
    }
  }
  index.schemaIssues = (index.schemaIssues ?? []).filter((item) => item.file !== path && !item.file.startsWith(`${path}#`));
}

export function removeOntologyFile(index: OntologyIndex, path: string): OntologyIndex {
  removeOntologyRecords(index, path);
  return recomputeOntologyDerivedState(index);
}

async function loadSchemaTypes(app: App, index: OntologyIndex, settings: BuildIndexSettings): Promise<void> {
  const schemaPath = settings.schemaPath?.trim();
  if (!schemaPath || !(await app.vault.adapter.exists(schemaPath))) {
    return;
  }

  const source = await app.vault.adapter.read(schemaPath);
  const lintIssues = lintOntologySchemaSource(schemaPath, source);
  index.schemaIssues?.push(...lintIssues);
  if (lintIssues.some((item) => item.severity === 'error')) {
    return;
  }
  for (const type of parseOntologySchema(schemaPath, source)) {
    index.types.set(type.name, type);
  }
}

export async function upsertOntologyFile(app: App, index: OntologyIndex, file: TFile, settings: BuildIndexSettings): Promise<OntologyIndex> {
  if (isOntologySchemaFile(file, settings.schemaPath)) {
    return buildOntologyIndex(app, settings);
  }

  removeOntologyRecords(index, file.path);
  if (isIgnoredOntologyPath(file.path, settings)) {
    return recomputeOntologyDerivedState(index);
  }

  if (isOntologyTypeFile(file, settings.typeFolder)) {
    const source = await app.vault.read(file);
    const lintIssues = lintOntologyTypeSource(file.path, source);
    index.schemaIssues?.push(...lintIssues);
    if (lintIssues.some((item) => item.severity === 'error')) {
      return recomputeOntologyDerivedState(index);
    }
    const type = parseOntologyType(file.path, source);
    index.types.set(type.name, type);
    return recomputeOntologyDerivedState(index);
  }

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
    return recomputeOntologyDerivedState(index);
  }
  const entity = parseOntologyEntity(file.path, frontmatter ?? {}, normalizedEntityTypeFields(settings.entityTypeFields));
  if (entity) {
    index.entities.set(entity.path, entity);
  }
  return recomputeOntologyDerivedState(index);
}

export async function buildOntologyIndex(app: App, settings: BuildIndexSettings): Promise<OntologyIndex> {
  const index = createEmptyOntologyIndex(settings);
  await loadSchemaTypes(app, index, settings);

  for (const file of app.vault.getMarkdownFiles()) {
    if (isOntologySchemaFile(file, settings.schemaPath)) {
      continue;
    }
    if (isIgnoredOntologyPath(file.path, settings)) {
      continue;
    }

    if (isOntologyTypeFile(file, settings.typeFolder)) {
      const source = await app.vault.read(file);
      const lintIssues = lintOntologyTypeSource(file.path, source);
      index.schemaIssues?.push(...lintIssues);
      if (lintIssues.some((item) => item.severity === 'error')) {
        continue;
      }
      const type = parseOntologyType(file.path, source);
      index.types.set(type.name, type);
      continue;
    }

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
      continue;
    }
    const entity = parseOntologyEntity(file.path, frontmatter ?? {}, normalizedEntityTypeFields(settings.entityTypeFields));
    if (entity) {
      index.entities.set(entity.path, entity);
    }
  }

  return recomputeOntologyDerivedState(index);
}
