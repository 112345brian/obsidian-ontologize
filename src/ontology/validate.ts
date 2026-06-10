import type { OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

import {
  collectInheritedCannotHave,
  entityCompositionChain,
  forbiddenFrontmatterKey,
  frontmatterPropertyKey,
  getInheritedCanHave,
  getInheritedMustHave,
  isFieldDefinitionRegistry,
  isRelationDefinitionRegistry,
  pushIssueOnce,
  resolveEntityRelations,
  resolvePropertyDefinition,
  typeCompositionChain
} from './compose.ts';
import { extractAssertedLinkTargets, extractLinkTargets, extractNegatedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';

export function hasValue(frontmatter: Record<string, unknown>, key: string): boolean {
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
    pushIssueOnce(issues, {
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
      pushIssueOnce(issues, {
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
      pushIssueOnce(index.issues, {
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
        pushIssueOnce(index.issues, { file: entity.path, message: `Unknown type ${typeName}`, severity: 'error' });
        continue;
      }
      if (type.abstract) {
        pushIssueOnce(index.issues, { file: entity.path, message: `Cannot instantiate abstract type ${typeName}`, severity: 'error' });
      }
      if (type.isInterface) {
        pushIssueOnce(index.issues, { file: entity.path, message: `Cannot instantiate interface ${typeName}`, severity: 'error' });
      }
    }

    for (const typeName of chain) {
      const type = index.types.get(typeName);
      if (!type) {
        continue;
      }
      for (const disjoint of type.disjoint) {
        if (chain.has(disjoint)) {
          pushIssueOnce(index.issues, {
            file: entity.path,
            message: `Entity is both ${typeName} and disjoint type ${disjoint}`,
            severity: 'error',
          });
        }
      }
    }

    // Contracts are merged across every declared type before validating, so an
    // entity with two types sharing an ancestor reports each problem exactly once.
    const mustHave = getInheritedMustHave(index, entity);
    for (const [property, definition] of mustHave) {
      if (!hasValue(entity.frontmatter, property)) {
        pushIssueOnce(index.issues, {
          file: entity.path,
          message: `Missing required property ${property}`,
          property,
          severity: 'error',
        });
      } else {
        validatePropertyDefinition(index, entity, property, definition);
      }
    }

    for (const [property, definition] of getInheritedCanHave(index, entity)) {
      if (!mustHave.has(property) && hasValue(entity.frontmatter, property)) {
        validatePropertyDefinition(index, entity, property, definition);
      }
    }

    for (const property of collectInheritedCannotHave(index, entity)) {
      const frontmatterKey = forbiddenFrontmatterKey(index, property);
      const presentKey = [frontmatterKey, property].find((key) => hasValue(entity.frontmatter, key));
      if (presentKey) {
        pushIssueOnce(index.issues, {
          file: entity.path,
          message: `Forbidden property ${presentKey} is present`,
          property: presentKey,
          severity: 'error',
        });
      }
    }

    for (const [property, relation] of resolveEntityRelations(index, entity.instanceOf)) {
      validateRelation(index, entity, property, relation);
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
      pushIssueOnce(index.issues, {
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
      pushIssueOnce(index.issues, {
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
      pushIssueOnce(index.issues, { file: entity.path, message: `${property} points to unknown entity ${targetName}`, property, severity: 'warning', target: targetName });
      continue;
    }

    if (relation.range) {
      const targetChain = entityCompositionChain(target, index);
      if (!targetChain.has(relation.range)) {
        pushIssueOnce(index.issues, {
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
      pushIssueOnce(index.issues, {
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

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = [...left ?? []].sort();
  const normalizedRight = [...right ?? []].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function samePropertyDefinition(left: PropertyDefinition, right: PropertyDefinition): boolean {
  return left.cardinality === right.cardinality
    && left.frontmatterKey === right.frontmatterKey
    && left.type === right.type
    && sameStringArray(left.values, right.values);
}

function describePropertyDefinition(definition: PropertyDefinition): string {
  const parts = [
    definition.type ? `type ${definition.type}` : '',
    definition.cardinality ? `cardinality ${definition.cardinality}` : '',
    definition.frontmatterKey ? `frontmatter-key ${definition.frontmatterKey}` : '',
    definition.values?.length ? `possible-values ${definition.values.join(', ')}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : 'untyped';
}

function semanticFieldId(source: OntologyType, property: string, definition: PropertyDefinition): string {
  return definition.uses ?? `${source.name}.${property}`;
}

interface FieldSource {
  bucket: 'can-have' | 'must-have';
  definition: PropertyDefinition;
  semanticId: string;
  source: OntologyType;
}

export function validateSchemaCompositionConflicts(index: OntologyIndex): void {
  for (const type of index.types.values()) {
    if (isRelationDefinitionRegistry(type) || isFieldDefinitionRegistry(type)) {
      continue;
    }

    const fields = new Map<string, FieldSource>();
    const forbidden = new Map<string, OntologyType>();

    for (const typeName of typeCompositionChain(type.name, index)) {
      const source = index.types.get(typeName);
      if (!source) {
        continue;
      }

      for (const property of source.cannotHave) {
        const forbiddenKey = forbiddenFrontmatterKey(index, property);
        const existing = fields.get(forbiddenKey);
        if (existing) {
          pushIssueOnce(index.issues, {
            file: type.path,
            message: `Schema conflict on ${type.name}.${forbiddenKey}: ${source.name} declares cannot-have but ${existing.source.name} declares ${existing.bucket}`,
            property: forbiddenKey,
            severity: 'error',
          });
        }
        forbidden.set(forbiddenKey, source);
      }

      for (const [bucket, definitions] of [['must-have', source.mustHave], ['can-have', source.canHave]] as const) {
        for (const [property, definition] of definitions) {
          const resolved = resolvePropertyDefinition(index, property, definition);
          const frontmatterKey = frontmatterPropertyKey(property, resolved);
          const semanticId = semanticFieldId(source, property, definition);
          const forbiddenSource = forbidden.get(frontmatterKey);
          if (forbiddenSource) {
            pushIssueOnce(index.issues, {
              file: type.path,
              message: `Schema conflict on ${type.name}.${frontmatterKey}: ${source.name} declares ${bucket} but ${forbiddenSource.name} declares cannot-have`,
              property: frontmatterKey,
              severity: 'error',
            });
          }

          const existing = fields.get(frontmatterKey);
          if (!existing) {
            fields.set(frontmatterKey, { bucket, definition: resolved, semanticId, source });
            continue;
          }

          if (existing.semanticId !== semanticId) {
            pushIssueOnce(index.issues, {
              file: type.path,
              message: `Schema conflict on ${type.name}.${frontmatterKey}: ${existing.source.name} uses semantic field ${existing.semanticId} but ${source.name} uses semantic field ${semanticId}`,
              property: frontmatterKey,
              severity: 'error',
            });
            continue;
          }

          if (!samePropertyDefinition(existing.definition, resolved)) {
            pushIssueOnce(index.issues, {
              file: type.path,
              message: `Schema conflict on ${type.name}.${frontmatterKey}: ${existing.source.name} declares ${existing.bucket} (${describePropertyDefinition(existing.definition)}) but ${source.name} declares ${bucket} (${describePropertyDefinition(resolved)})`,
              property: frontmatterKey,
              severity: 'error',
            });
            continue;
          }

          if (existing.bucket === 'can-have' && bucket === 'must-have') {
            fields.set(frontmatterKey, { bucket, definition: resolved, semanticId, source });
          }
        }
      }
    }
  }
}
