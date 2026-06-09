import type { App, TFile } from 'obsidian';

import type { EffectiveLockState, FrontmatterIgnoreRule, OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

import { extractAssertedLinkTargets, extractLinkTargets, extractNegatedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';
import { parseOntologyEntity, parseOntologySchema, parseOntologyType } from './parser.ts';

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
  return normalized.length > 0 ? normalized : ['instance_of', 'type'];
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
    generatedAt: new Date().toISOString(),
    issues: [],
    relationDefinitions: new Map<string, RelationDefinition>(),
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

function isRelationDefinitionRegistry(type: OntologyType): boolean {
  return ['relation-definitions', 'relation-registry', 'relations'].includes(type.typeKind ?? '');
}

function typeCompositionChain(
  typeName: string,
  index: Pick<OntologyIndex, 'ancestorsByType' | 'issues' | 'types'>,
  seen = new Set<string>()
): Set<string> {
  const names = new Set<string>();
  const addTypeAndInterfaces = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    names.add(name);
    const type = index.types.get(name);
    if (!type) {
      return;
    }
    for (const interfaceName of type.implements) {
      const interfaceType = index.types.get(interfaceName);
      if (!interfaceType) {
        index.issues.push({
          file: type.path,
          message: `Unknown interface ${interfaceName}`,
          severity: 'error',
        });
        continue;
      }
      if (!interfaceType.isInterface) {
        index.issues.push({
          file: type.path,
          message: `${interfaceName} is implemented but is not marked interface: true`,
          severity: 'warning',
        });
      }
      addTypeAndInterfaces(interfaceName);
    }
  };

  for (const ancestor of index.ancestorsByType.get(typeName) ?? []) {
    addTypeAndInterfaces(ancestor);
  }
  addTypeAndInterfaces(typeName);
  return names;
}

function collectInheritedMap<T>(
  typeName: string,
  index: Pick<OntologyIndex, 'ancestorsByType' | 'types'>,
  selector: (type: OntologyType) => Map<string, T>
): Map<string, T> {
  const result = new Map<string, T>();
  const names = typeCompositionChain(typeName, {
    ancestorsByType: index.ancestorsByType,
    issues: [],
    types: index.types,
  });
  for (const name of names) {
    const type = index.types.get(name);
    if (!type) {
      continue;
    }
    for (const [key, value] of selector(type)) {
      result.set(key, value);
    }
  }
  return result;
}

function collectGlobalRelationDefinitions(types: Map<string, OntologyType>): Map<string, RelationDefinition> {
  const definitions = new Map<string, RelationDefinition>();
  for (const type of types.values()) {
    if (!isRelationDefinitionRegistry(type)) {
      continue;
    }
    for (const [property, definition] of type.relations) {
      definitions.set(property, {
        ...definition,
        uses: definition.uses === property ? undefined : definition.uses,
      });
    }
  }
  return definitions;
}

function resolveRelationDefinition(index: OntologyIndex, property: string, definition: RelationDefinition): RelationDefinition {
  const referenced = definition.uses ? index.relationDefinitions.get(definition.uses) : index.relationDefinitions.get(property);
  if (!referenced) {
    return definition;
  }
  return {
    ...referenced,
    ...definition,
    uses: definition.uses,
  };
}

function collectRelations(typeName: string, index: OntologyIndex): Map<string, RelationDefinition> {
  const result = new Map<string, RelationDefinition>();
  // Composition issues are reported by entityCompositionChain during validation;
  // pass a scratch issue list so relation resolution stays side-effect free.
  const chain = typeCompositionChain(typeName, {
    ancestorsByType: index.ancestorsByType,
    issues: [],
    types: index.types,
  });
  for (const name of chain) {
    const type = index.types.get(name);
    if (!type || isRelationDefinitionRegistry(type)) {
      continue;
    }
    for (const [property, definition] of type.relations) {
      result.set(property, resolveRelationDefinition(index, property, definition));
    }
  }
  return result;
}

/**
 * Resolves the effective relation definitions for an entity by merging the
 * composition chain of every declared type. Later types in `instanceOf` and
 * more-derived types within a chain win, matching how `validateIndex` raises
 * relation issues. Mutations resolve inverses through this same function so the
 * fix that gets written always matches the issue that was reported.
 */
export function resolveEntityRelations(index: OntologyIndex, instanceOf: string[]): Map<string, RelationDefinition> {
  const result = new Map<string, RelationDefinition>();
  for (const typeName of instanceOf) {
    for (const [property, definition] of collectRelations(typeName, index)) {
      result.set(property, definition);
    }
  }
  return result;
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
      issues.push({
        file: type.path,
        message: `Circular inheritance detected: ${[...stack, name].join(' -> ')}`,
        severity: 'error',
      });
      return ancestors;
    }

    visiting.add(name);
    for (const parent of type.extends) {
      if (!types.has(parent)) {
        issues.push({
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

function entityCompositionChain(entity: OntologyEntity, index: OntologyIndex): Set<string> {
  const chain = new Set<string>();
  for (const typeName of entity.instanceOf) {
    for (const name of typeCompositionChain(typeName, index)) {
      chain.add(name);
    }
  }
  return chain;
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

function hasValue(frontmatter: Record<string, unknown>, key: string): boolean {
  const value = frontmatter[key];
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return !(Array.isArray(value) && value.length === 0);
}

function validateCardinality(
  file: string,
  property: string,
  definition: PropertyDefinition | RelationDefinition,
  value: unknown,
  issues: OntologyIssue[]
): void {
  if ((definition.cardinality === 'one' || definition.cardinality === 'one-to-one') && Array.isArray(value) && value.length > 1) {
    issues.push({
      file,
      message: `${property} allows one value but has ${value.length}`,
      property,
      severity: 'error',
    });
  }
}

function valuesForValidation(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => valuesForValidation(item));
  }
  if (typeof value === 'string') {
    return [normalizeLinkTarget(value)];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (value && typeof value === 'object' && 'target' in value) {
    return valuesForValidation(value.target);
  }
  return [];
}

function validateValueType(file: string, property: string, expectedType: string | undefined, value: unknown, issues: OntologyIssue[]): void {
  if (!expectedType || value === undefined || value === null || value === '') {
    return;
  }

  const normalizedType = normalizeLinkTarget(expectedType).toLowerCase();
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const valid = (() => {
      switch (normalizedType) {
        case 'boolean':
          return typeof item === 'boolean';
        case 'date':
          return typeof item === 'string' && !Number.isNaN(Date.parse(item));
        case 'link':
        case 'wikilink':
          return extractAssertedLinkTargets(item).length > 0;
        case 'number':
          return typeof item === 'number';
        case 'string':
        case 'text':
          return typeof item === 'string';
        default:
          return true;
      }
    })();

    if (!valid) {
      issues.push({
        file,
        message: `${property} must be ${expectedType}`,
        property,
        severity: 'error',
      });
    }
  }
}

function allowedPropertyValues(index: OntologyIndex, definition: PropertyDefinition): string[] {
  if (definition.values && definition.values.length > 0) {
    return definition.values;
  }
  const referencedType = definition.type ? index.types.get(definition.type) : undefined;
  if (referencedType?.typeKind === 'nominal') {
    return referencedType.values;
  }
  return [];
}

function validatePropertyDefinition(
  index: OntologyIndex,
  entity: OntologyEntity,
  property: string,
  definition: PropertyDefinition
): void {
  const value = entity.frontmatter[property];
  validateCardinality(entity.path, property, definition, value, index.issues);
  validateValueType(entity.path, property, definition.type, value, index.issues);

  const allowedValues = allowedPropertyValues(index, definition);
  if (allowedValues.length === 0) {
    return;
  }

  const allowed = new Set(allowedValues);
  for (const candidate of valuesForValidation(value)) {
    if (!allowed.has(candidate)) {
      index.issues.push({
        file: entity.path,
        message: `${property} value ${candidate} is outside allowed values: ${allowedValues.join(', ')}`,
        property,
        severity: 'error',
      });
    }
  }
}

export function validateIndex(index: OntologyIndex): void {
  for (const entity of index.entities.values()) {
    const chain = entityCompositionChain(entity, index);

    for (const typeName of entity.instanceOf) {
      const type = index.types.get(typeName);
      if (!type) {
        index.issues.push({ file: entity.path, message: `Unknown type ${typeName}`, severity: 'error' });
        continue;
      }
      if (type.abstract) {
        index.issues.push({ file: entity.path, message: `Cannot instantiate abstract type ${typeName}`, severity: 'error' });
      }
      if (type.isInterface) {
        index.issues.push({ file: entity.path, message: `Cannot instantiate interface ${typeName}`, severity: 'error' });
      }
    }

    for (const typeName of chain) {
      const type = index.types.get(typeName);
      if (!type) {
        continue;
      }
      for (const disjoint of type.disjoint) {
        if (chain.has(disjoint)) {
          index.issues.push({
            file: entity.path,
            message: `Entity is both ${typeName} and disjoint type ${disjoint}`,
            severity: 'error',
          });
        }
      }
    }

    for (const typeName of entity.instanceOf) {
      for (const [property, definition] of collectInheritedMap(typeName, index, (type) => type.mustHave)) {
        if (!hasValue(entity.frontmatter, property)) {
          index.issues.push({
            file: entity.path,
            message: `Missing required property ${property}`,
            property,
            severity: 'error',
          });
        } else {
          validatePropertyDefinition(index, entity, property, definition);
        }
      }

      for (const [property, definition] of collectInheritedMap(typeName, index, (type) => type.canHave)) {
        if (hasValue(entity.frontmatter, property)) {
          validatePropertyDefinition(index, entity, property, definition);
        }
      }

      const cannotHave = new Set<string>();
      for (const ancestor of typeCompositionChain(typeName, index)) {
        const type = index.types.get(ancestor);
        for (const property of type?.cannotHave ?? []) {
          cannotHave.add(property);
        }
      }
      for (const property of cannotHave) {
        if (hasValue(entity.frontmatter, property)) {
          index.issues.push({ file: entity.path, message: `Forbidden property ${property} is present`, property, severity: 'error' });
        }
      }

      for (const [property, relation] of collectRelations(typeName, index)) {
        validateRelation(index, entity, property, relation);
      }
    }
  }
}

function validateRelation(index: OntologyIndex, entity: OntologyEntity, property: string, relation: RelationDefinition): void {
  const value = entity.frontmatter[property];
  if (!hasValue(entity.frontmatter, property)) {
    return;
  }

  validateCardinality(entity.path, property, relation, value, index.issues);
  validateValueType(entity.path, property, relation.valueType, value, index.issues);

  const assertedTargets = new Set(extractAssertedLinkTargets(value));
  const negatedTargets = new Set(extractNegatedLinkTargets(value));
  for (const targetName of assertedTargets) {
    if (negatedTargets.has(targetName)) {
      index.issues.push({
        file: entity.path,
        message: `${property} both asserts and negates ${targetName}`,
        property,
        severity: 'error',
        target: targetName,
      });
    }
  }

  for (const targetName of assertedTargets) {
    if (hasNegatedTarget(value, targetName)) {
      continue;
    }
    if (index.ambiguousEntityNames?.has(targetName)) {
      index.issues.push({
        file: entity.path,
        message: `${property} target ${targetName} is ambiguous: multiple notes are named ${targetName}`,
        property,
        severity: 'warning',
        target: targetName,
      });
      continue;
    }
    const target = index.entitiesByName.get(targetName);
    if (!target) {
      index.issues.push({ file: entity.path, message: `${property} points to unknown entity ${targetName}`, property, severity: 'warning', target: targetName });
      continue;
    }

    if (relation.range) {
      const targetChain = entityCompositionChain(target, index);
      if (!targetChain.has(relation.range)) {
        index.issues.push({
          file: entity.path,
          message: `${property} target ${targetName} is not a ${relation.range}`,
          property,
          severity: 'error',
          target: targetName,
        });
      }
    }

    const inverseProperty = relation.symmetric ? property : relation.inverse;
    if (inverseProperty && !extractLinkTargets(target.frontmatter[inverseProperty]).includes(entity.name)) {
      index.issues.push({
        autofixable: true,
        autoUpdate: relation.autoUpdate === true,
        file: entity.path,
        message: `${property} -> ${targetName} is missing inverse ${inverseProperty} on ${targetName}`,
        property,
        severity: 'warning',
        target: targetName,
      });
    }
  }
}

function matchesPathOrChild(candidatePath: string, path: string): boolean {
  return candidatePath === path || candidatePath.startsWith(`${path}/`);
}

function deleteTypesByPath(index: OntologyIndex, path: string): void {
  for (const [name, type] of index.types.entries()) {
    if (matchesPathOrChild(type.path, path)) {
      index.types.delete(name);
    }
  }
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
  index.issues = [];
  rebuildEntityNameIndex(index);
  for (const name of index.ambiguousEntityNames ?? []) {
    const paths = [...index.entities.values()].filter((entity) => entity.name === name).map((entity) => entity.path).sort();
    index.issues.push({
      file: paths[0] ?? '',
      message: `Duplicate entity name ${name}: ${paths.join(', ')}. Wiki links to ${name} cannot be resolved unambiguously.`,
      severity: 'warning',
    });
  }
  const circularTypes = new Set<string>();
  index.ancestorsByType = computeAncestors(index.types, index.issues, circularTypes);
  index.circularTypes = circularTypes;
  index.relationDefinitions = collectGlobalRelationDefinitions(index.types);

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

export function removeOntologyFile(index: OntologyIndex, path: string): OntologyIndex {
  for (const [entityPath] of index.entities.entries()) {
    if (matchesPathOrChild(entityPath, path)) {
      index.entities.delete(entityPath);
    }
  }
  deleteTypesByPath(index, path);
  return recomputeOntologyDerivedState(index);
}

async function loadSchemaTypes(app: App, index: OntologyIndex, settings: BuildIndexSettings): Promise<void> {
  const schemaPath = settings.schemaPath?.trim();
  if (!schemaPath || !(await app.vault.adapter.exists(schemaPath))) {
    return;
  }

  for (const type of parseOntologySchema(schemaPath, await app.vault.adapter.read(schemaPath))) {
    index.types.set(type.name, type);
  }
}

export async function upsertOntologyFile(app: App, index: OntologyIndex, file: TFile, settings: BuildIndexSettings): Promise<OntologyIndex> {
  if (isOntologySchemaFile(file, settings.schemaPath)) {
    return buildOntologyIndex(app, settings);
  }

  removeOntologyFile(index, file.path);
  if (isIgnoredOntologyPath(file.path, settings)) {
    return recomputeOntologyDerivedState(index);
  }

  if (isOntologyTypeFile(file, settings.typeFolder)) {
    const type = parseOntologyType(file.path, await app.vault.read(file));
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
      const type = parseOntologyType(file.path, await app.vault.read(file));
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

export function getInheritedMustHave(index: OntologyIndex, entity: OntologyEntity): Map<string, PropertyDefinition> {
  const result = new Map<string, PropertyDefinition>();
  for (const typeName of entity.instanceOf) {
    for (const [property, definition] of collectInheritedMap(typeName, index, (type) => type.mustHave)) {
      result.set(property, definition);
    }
  }
  return result;
}

export function getInheritedCanHave(index: OntologyIndex, entity: OntologyEntity): Map<string, PropertyDefinition> {
  const result = new Map<string, PropertyDefinition>();
  for (const typeName of entity.instanceOf) {
    for (const [property, definition] of collectInheritedMap(typeName, index, (type) => type.canHave)) {
      result.set(property, definition);
    }
  }
  return result;
}
