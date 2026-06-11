import type { OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

/**
 * Single home for composition-chain resolution and definition merging.
 * The indexer, validator, query engine, and mutation planner all resolve
 * inheritance, interfaces, and global registries through these functions so a
 * rule can never diverge between the surface that reports a problem and the
 * surface that acts on it.
 */

export function issueKey(issue: OntologyIssue): string {
  return [
    issue.file,
    issue.severity,
    issue.message,
    issue.property ?? '',
    issue.target ?? '',
  ].join('\u0000');
}

const seenIssueKeys = new WeakMap<OntologyIssue[], Set<string>>();

export function pushIssueOnce(issues: OntologyIssue[], issue: OntologyIssue): void {
  let seen = seenIssueKeys.get(issues);
  if (!seen) {
    seen = new Set(issues.map(issueKey));
    seenIssueKeys.set(issues, seen);
  }
  const key = issueKey(issue);
  if (!seen.has(key)) {
    seen.add(key);
    issues.push(issue);
  }
}

export function isRelationDefinitionRegistry(type: OntologyType): boolean {
  return ['relation-definitions', 'relation-registry', 'relations'].includes(type.typeKind ?? '');
}

export function isFieldDefinitionRegistry(type: OntologyType): boolean {
  return ['field-definitions', 'field-registry', 'fields'].includes(type.typeKind ?? '');
}

/**
 * Walks ancestors plus implemented interfaces for a type. When `issues` is
 * provided, unknown or mis-marked interfaces are reported; chain consumers
 * that only need membership omit it and stay side-effect free.
 */
export function typeCompositionChain(
  typeName: string,
  index: Pick<OntologyIndex, 'ancestorsByType' | 'types'>,
  issues?: OntologyIssue[],
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
        if (issues) {
          pushIssueOnce(issues, {
            file: type.path,
            message: `Unknown interface ${interfaceName}`,
            severity: 'error',
          });
        }
        continue;
      }
      if (!interfaceType.isInterface && issues) {
        pushIssueOnce(issues, {
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

export function entityCompositionChain(entity: OntologyEntity, index: Pick<OntologyIndex, 'ancestorsByType' | 'types'>): Set<string> {
  const chain = new Set<string>();
  for (const typeName of entity.instanceOf) {
    for (const name of typeCompositionChain(typeName, index)) {
      chain.add(name);
    }
  }
  return chain;
}

export function collectGlobalRelationDefinitions(types: Map<string, OntologyType>): Map<string, RelationDefinition> {
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

export function collectGlobalFieldDefinitions(types: Map<string, OntologyType>): Map<string, PropertyDefinition> {
  const definitions = new Map<string, PropertyDefinition>();
  for (const type of types.values()) {
    if (!isFieldDefinitionRegistry(type)) {
      continue;
    }
    for (const [property, definition] of type.fields) {
      definitions.set(property, {
        ...definition,
        uses: definition.uses === property ? undefined : definition.uses,
      });
    }
  }
  return definitions;
}

export function resolveRelationDefinition(index: OntologyIndex, property: string, definition: RelationDefinition): RelationDefinition {
  const referenced = definition.uses ? index.relationDefinitions.get(definition.uses) : index.relationDefinitions.get(property);
  if (!referenced) {
    return definition;
  }
  return mergeDefined(referenced, definition);
}

export function resolvePropertyDefinition(index: OntologyIndex, property: string, definition: PropertyDefinition): PropertyDefinition {
  const referenced = definition.uses ? index.fieldDefinitions.get(definition.uses) : index.fieldDefinitions.get(property);
  if (!referenced) {
    return definition;
  }
  return mergeDefined(referenced, definition);
}

function mergeDefined<T extends object>(base: T, override: T): T {
  const definedOverride = Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
  return { ...base, ...definedOverride };
}

export function frontmatterPropertyKey(property: string, definition: PropertyDefinition): string {
  return definition.frontmatterKey ?? property;
}

/**
 * Resolves a `cannot-have` name to the frontmatter key it forbids, honoring a
 * global field's `frontmatter-key` alias the same way must-have/can-have do.
 */
export function forbiddenFrontmatterKey(index: OntologyIndex, property: string): string {
  return index.fieldDefinitions.get(property)?.frontmatterKey ?? property;
}

export function collectRelations(typeName: string, index: OntologyIndex): Map<string, RelationDefinition> {
  const result = new Map<string, RelationDefinition>();
  for (const name of typeCompositionChain(typeName, index)) {
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
 * more-derived types within a chain win, matching how validation raises
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

export function collectInheritedPropertyMap(
  typeName: string,
  index: OntologyIndex,
  selector: (type: OntologyType) => Map<string, PropertyDefinition>
): Map<string, PropertyDefinition> {
  const result = new Map<string, PropertyDefinition>();
  for (const name of typeCompositionChain(typeName, index)) {
    const type = index.types.get(name);
    if (!type || isFieldDefinitionRegistry(type)) {
      continue;
    }
    for (const [property, definition] of selector(type)) {
      const resolved = resolvePropertyDefinition(index, property, definition);
      result.set(frontmatterPropertyKey(property, resolved), resolved);
    }
  }
  return result;
}

export function getInheritedMustHave(index: OntologyIndex, entity: OntologyEntity): Map<string, PropertyDefinition> {
  const result = new Map<string, PropertyDefinition>();
  for (const typeName of entity.instanceOf) {
    for (const [property, definition] of collectInheritedPropertyMap(typeName, index, (type) => type.mustHave)) {
      result.set(property, definition);
    }
  }
  return result;
}

export function getInheritedCanHave(index: OntologyIndex, entity: OntologyEntity): Map<string, PropertyDefinition> {
  const result = new Map<string, PropertyDefinition>();
  for (const typeName of entity.instanceOf) {
    for (const [property, definition] of collectInheritedPropertyMap(typeName, index, (type) => type.canHave)) {
      result.set(property, definition);
    }
  }
  return result;
}

export function collectInheritedCannotHave(index: OntologyIndex, entity: OntologyEntity): Set<string> {
  const result = new Set<string>();
  for (const name of entityCompositionChain(entity, index)) {
    for (const property of index.types.get(name)?.cannotHave ?? []) {
      result.add(property);
    }
  }
  return result;
}
