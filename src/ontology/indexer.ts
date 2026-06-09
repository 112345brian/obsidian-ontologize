import type { App, TFile } from 'obsidian';

import type { EffectiveLockState, OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

import { extractAssertedLinkTargets, extractLinkTargets, extractNegatedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';
import { parseOntologyEntity, parseOntologyType } from './parser.ts';

export interface BuildIndexSettings {
  typeFolder: string;
}

export function isOntologyTypeFile(file: TFile, typeFolder: string): boolean {
  return file.extension === 'md' && file.path.startsWith(`${typeFolder.replace(/\/$/, '')}/`);
}

function createEmptyOntologyIndex(settings: BuildIndexSettings): OntologyIndex {
  return {
    ancestorsByType: new Map<string, Set<string>>(),
    cacheVersion: 1,
    effectiveEntityLocks: new Map<string, EffectiveLockState>(),
    effectiveTypeLocks: new Map<string, EffectiveLockState>(),
    entities: new Map<string, OntologyEntity>(),
    entitiesByName: new Map<string, OntologyEntity>(),
    generatedAt: new Date().toISOString(),
    issues: [],
    settings: { typeFolder: settings.typeFolder },
    types: new Map<string, OntologyType>(),
  };
}

function collectInheritedMap<T>(
  typeName: string,
  index: Pick<OntologyIndex, 'ancestorsByType' | 'types'>,
  selector: (type: OntologyType) => Map<string, T>
): Map<string, T> {
  const result = new Map<string, T>();
  const names = [...(index.ancestorsByType.get(typeName) ?? new Set<string>()), typeName];
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

export function computeAncestors(types: Map<string, OntologyType>, issues: OntologyIssue[]): Map<string, Set<string>> {
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

function computeTypeLock(name: string, types: Map<string, OntologyType>, ancestorsByType: Map<string, Set<string>>): EffectiveLockState {
  const type = types.get(name);
  if (!type?.lockIntent) {
    return { state: 'unlocked', reason: 'lock is not true' };
  }
  for (const ancestor of ancestorsByType.get(name) ?? []) {
    if (!types.get(ancestor)?.lockIntent) {
      return { state: 'incomplete', reason: `ancestor ${ancestor} is not locked` };
    }
  }
  return { state: 'locked' };
}

function entityTypeChain(entity: OntologyEntity, ancestorsByType: Map<string, Set<string>>): Set<string> {
  const chain = new Set<string>();
  for (const typeName of entity.instanceOf) {
    chain.add(typeName);
    for (const ancestor of ancestorsByType.get(typeName) ?? []) {
      chain.add(ancestor);
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

function nominalValues(index: OntologyIndex, definition: PropertyDefinition): string[] {
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

  const allowedValues = nominalValues(index, definition);
  if (allowedValues.length === 0) {
    return;
  }

  const allowed = new Set(allowedValues);
  for (const candidate of valuesForValidation(value)) {
    if (!allowed.has(candidate)) {
      index.issues.push({
        file: entity.path,
        message: `${property} value ${candidate} is outside nominal values: ${allowedValues.join(', ')}`,
        property,
        severity: 'error',
      });
    }
  }
}

export function validateIndex(index: OntologyIndex): void {
  for (const entity of index.entities.values()) {
    const chain = entityTypeChain(entity, index.ancestorsByType);

    for (const typeName of entity.instanceOf) {
      const type = index.types.get(typeName);
      if (!type) {
        index.issues.push({ file: entity.path, message: `Unknown type ${typeName}`, severity: 'error' });
        continue;
      }
      if (type.abstract) {
        index.issues.push({ file: entity.path, message: `Cannot instantiate abstract type ${typeName}`, severity: 'error' });
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
      for (const ancestor of [...(index.ancestorsByType.get(typeName) ?? []), typeName]) {
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

      for (const [property, relation] of collectInheritedMap(typeName, index, (type) => type.relations)) {
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
    const target = index.entitiesByName.get(targetName);
    if (!target) {
      index.issues.push({ file: entity.path, message: `${property} points to unknown entity ${targetName}`, property, severity: 'warning', target: targetName });
      continue;
    }

    if (relation.range) {
      const targetChain = entityTypeChain(target, index.ancestorsByType);
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
  index.entitiesByName = new Map([...index.entities.values()].map((entity) => [entity.name, entity]));
}

export function recomputeOntologyDerivedState(index: OntologyIndex): OntologyIndex {
  index.issues = [];
  rebuildEntityNameIndex(index);
  index.ancestorsByType = computeAncestors(index.types, index.issues);

  index.effectiveTypeLocks = new Map<string, EffectiveLockState>();
  for (const name of index.types.keys()) {
    index.effectiveTypeLocks.set(name, computeTypeLock(name, index.types, index.ancestorsByType));
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

export async function upsertOntologyFile(app: App, index: OntologyIndex, file: TFile, settings: BuildIndexSettings): Promise<OntologyIndex> {
  removeOntologyFile(index, file.path);

  if (isOntologyTypeFile(file, settings.typeFolder)) {
    const type = parseOntologyType(file.path, await app.vault.read(file));
    index.types.set(type.name, type);
    return recomputeOntologyDerivedState(index);
  }

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const entity = parseOntologyEntity(file.path, frontmatter ?? {});
  if (entity) {
    index.entities.set(entity.path, entity);
  }
  return recomputeOntologyDerivedState(index);
}

export async function buildOntologyIndex(app: App, settings: BuildIndexSettings): Promise<OntologyIndex> {
  const index = createEmptyOntologyIndex(settings);

  for (const file of app.vault.getMarkdownFiles()) {
    if (isOntologyTypeFile(file, settings.typeFolder)) {
      const type = parseOntologyType(file.path, await app.vault.read(file));
      index.types.set(type.name, type);
      continue;
    }

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const entity = parseOntologyEntity(file.path, frontmatter ?? {});
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
