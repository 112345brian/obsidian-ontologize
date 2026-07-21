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
import { containsFrontmatterValue, extractAssertedLinkTargets, extractAssertedWikiLinkTargets, extractLinkTargets, extractNegatedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';
import { normalizeKey } from './parser.ts';
import { NOTE_CONTENT_KEYS, TYPE_KEYS } from './schema-linter.ts';
import { isInsertTemplate } from './templates.ts';
import { parseTypeExpression } from './type-expression.ts';
import { scaleNeutral } from './scale.ts';

// Obsidian's own link resolution is case-insensitive on the case-insensitive
// filesystems (macOS/Windows) this plugin actually runs on, so a wikilink whose
// case differs from the target file's real name still resolves fine in Obsidian
// even though it wouldn't match entitiesByName's exact-case keys. Also fold away
// apostrophes (straight and curly): idiomatic kebab-case elides an apostrophe
// entirely rather than treating it as a word separator (Trump's -> trumps, not
// trump-s), but some older slugs/links in the wild get this backwards and
// hyphenate it instead, so a name with the apostrophe stripped should still
// resolve against the real entity that has one. Cache the folded lookup per
// index (rebuilt each time the index itself changes) rather than rescanning
// entitiesByName on every relation target. Keyed on entitiesByName itself
// (not on the index) because the indexer mutates and reuses the same index
// object across incremental updates, reassigning entitiesByName to a fresh
// Map on every rebuild — keying on index would never invalidate.
const foldedNameCache = new WeakMap<Map<string, OntologyEntity>, Map<string, OntologyEntity>>();

function foldEntityName(name: string): string {
  return name.toLowerCase().replace(/['’‘]/g, '');
}

function resolveEntityByFoldedName(index: OntologyIndex, targetName: string): OntologyEntity | undefined {
  let cache = foldedNameCache.get(index.entitiesByName);
  if (!cache) {
    cache = new Map();
    for (const [name, candidate] of index.entitiesByName) {
      const folded = foldEntityName(name);
      if (!cache.has(folded)) {
        cache.set(folded, candidate);
      }
    }
    foldedNameCache.set(index.entitiesByName, cache);
  }
  return cache.get(foldEntityName(targetName));
}

// A hyphen substituted for an elided apostrophe (the exact mistake foldEntityName
// corrects for) is only half of the legacy-slug bug: some older links in this
// vault's history aren't just missing the apostrophe, they're the *entire* title
// kebab-slugified ("trump-s-immigration-policies" instead of "Trump's
// Immigration Policies") — hyphens standing in for spaces too. Stripping every
// non-alphanumeric character folds both forms onto the same key, at the cost of
// also merging two genuinely different real titles that happen to share the
// same letters/digits once punctuation is gone. Guard against that: if two
// distinct entities fold to the same key, record it as an unresolvable
// collision (null) rather than silently picking one and resolving to the wrong
// note.
const slugFoldedNameCache = new WeakMap<Map<string, OntologyEntity>, Map<string, OntologyEntity | null>>();

function slugFoldEntityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveEntityBySlugFold(index: OntologyIndex, targetName: string): OntologyEntity | undefined {
  let cache = slugFoldedNameCache.get(index.entitiesByName);
  if (!cache) {
    cache = new Map();
    for (const [name, candidate] of index.entitiesByName) {
      const folded = slugFoldEntityName(name);
      cache.set(folded, cache.has(folded) ? null : candidate);
    }
    slugFoldedNameCache.set(index.entitiesByName, cache);
  }
  return cache.get(slugFoldEntityName(targetName)) ?? undefined;
}

// Shared fallback chain for resolving a wikilink target name to an entity: exact
// name match, then case/apostrophe-folded, then fully slug-folded. Used by every
// relation-target resolution so the two call sites can't silently drift apart.
function resolveEntityLoosely(index: OntologyIndex, targetName: string): OntologyEntity | undefined {
  return index.entitiesByName.get(targetName)
    ?? resolveEntityByFoldedName(index, targetName)
    ?? resolveEntityBySlugFold(index, targetName);
}

// Ignored-field patterns are entity-independent, but isIgnoredEntityField is called
// once per frontmatter key of every entity — normalize each pattern once per settings
// object (settings are never mutated in place, only replaced wholesale by a new index
// build) rather than re-normalizing every pattern on every call.
const ignoredFieldPatternCache = new WeakMap<string[], Array<{ isPrefix: boolean; normalized: string }>>();

// entityTypeFields is a fixed per-index setting, not per-entity — kebab-case-normalize
// it once per settings array reference instead of on every entity (settings arrays are
// replaced wholesale, never mutated in place, when the user edits a setting). Distinct
// from indexer.ts's normalizedEntityTypeFields, which only trims/defaults the raw
// setting; this additionally kebab-cases each field name to match frontmatter keys.
const kebabEntityTypeFieldsCache = new WeakMap<string[], string[]>();

function kebabEntityTypeFields(entityTypeFields: string[]): string[] {
  let normalized = kebabEntityTypeFieldsCache.get(entityTypeFields);
  if (!normalized) {
    normalized = entityTypeFields.map(normalizeKey);
    kebabEntityTypeFieldsCache.set(entityTypeFields, normalized);
  }
  return normalized;
}

function isIgnoredEntityField(key: string, ignoredEntityFields: string[]): boolean {
  let patterns = ignoredFieldPatternCache.get(ignoredEntityFields);
  if (!patterns) {
    // Frontmatter keys are normalized to kebab-case on read (dots/underscores become
    // hyphens), so a trailing "." can never match anything — the prefix marker has to be
    // a trailing "-". Normalize the pattern itself too (case/separator variance in what the
    // user typed), preserving the trailing hyphen through normalizeKey's own trim.
    patterns = ignoredEntityFields.map((pattern) => {
      const isPrefix = pattern.endsWith('-') || pattern.endsWith('.') || pattern.endsWith('_');
      return isPrefix
        ? { isPrefix, normalized: `${normalizeKey(pattern.slice(0, -1))}-` }
        : { isPrefix, normalized: normalizeKey(pattern) };
    });
    ignoredFieldPatternCache.set(ignoredEntityFields, patterns);
  }
  return patterns.some(({ isPrefix, normalized }) => (isPrefix ? key.startsWith(normalized) : key === normalized));
}

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

function valueMatchesType(expectedType: string, value: unknown): boolean {
  switch (normalizeLinkTarget(expectedType).toLowerCase()) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'link':
    case 'wikilink':
      return extractAssertedWikiLinkTargets(value).length > 0;
    case 'number':
      return typeof value === 'number';
    case 'string':
    case 'text':
      return typeof value === 'string';
    default:
      return true;
  }
}

function validateStrictType(file: string, property: string, expectedType: string | undefined, value: unknown, issues: OntologyIssue[]): void {
  if (!expectedType || value === undefined || value === null || value === '') {
    return;
  }

  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (!parseTypeExpression(expectedType).some((type) => valueMatchesType(type, item))) {
      pushIssueOnce(issues, {
        file,
        message: `${property} must be ${expectedType}`,
        property,
        severity: 'error',
      });
    }
  }
}

function validateIncludedTypes(file: string, property: string, includedTypes: string[], value: unknown, issues: OntologyIssue[]): void {
  if (includedTypes.length === 0 || value === undefined || value === null || value === '') {
    return;
  }
  for (const item of Array.isArray(value) ? value : [value]) {
    if (!includedTypes.some((includedType) => valueMatchesType(includedType, item))) {
      pushIssueOnce(issues, {
        file,
        message: `${property} does not match included types: ${includedTypes.join(', ')}`,
        property,
        severity: 'warning',
      });
    }
  }
}

function validateExcludedTypes(file: string, property: string, excludedTypes: string[], value: unknown, issues: OntologyIssue[]): void {
  if (excludedTypes.length === 0 || value === undefined || value === null || value === '') {
    return;
  }
  for (const item of Array.isArray(value) ? value : [value]) {
    const matched = excludedTypes.filter((excludedType) => valueMatchesType(excludedType, item));
    if (matched.length > 0) {
      pushIssueOnce(issues, {
        file,
        message: `${property} matches excluded types: ${matched.join(', ')}`,
        property,
        severity: 'error',
      });
    }
  }
}

function displayInsertedValue(value: PropertyDefinition['insert']): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function allowedPropertyValues(index: OntologyIndex, definition: PropertyDefinition): string[] {
  if (definition.values && definition.values.length > 0) {
    return definition.values;
  }
  if (!definition.type) {
    return [];
  }
  const referencedTypes = parseTypeExpression(definition.type).map((type) => index.types.get(type));
  return referencedTypes.length > 0 && referencedTypes.every((type) => type?.typeKind === 'nominal')
    ? referencedTypes.flatMap((type) => type?.values ?? [])
    : [];
}

function validatePropertyDefinition(
  index: OntologyIndex,
  entity: OntologyEntity,
  property: string,
  definition: PropertyDefinition
): void {
  const value = entity.frontmatter[property];
  validateCardinality(entity.path, property, definition, value, index.issues);
  validateStrictType(entity.path, property, definition.type, value, index.issues);
  validateIncludedTypes(entity.path, property, definition.includedTypes ?? [], value, index.issues);
  validateExcludedTypes(entity.path, property, definition.excludedTypes ?? [], value, index.issues);

  if (definition.insert !== undefined && !isInsertTemplate(definition.insert) && !containsFrontmatterValue(value, definition.insert)) {
    pushIssueOnce(index.issues, {
      file: entity.path,
      message: `${property} must include ${displayInsertedValue(definition.insert)}`,
      property,
      severity: 'error',
    });
  }

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

/**
 * Validates a single entity against the current index state, appending any
 * new issues to `index.issues`. Callers are responsible for stripping the
 * entity's existing issues before calling this so they are not duplicated.
 * Exported so incremental batch revalidation can call it without a full sweep.
 */
export function validateSingleEntity(index: OntologyIndex, entity: OntologyEntity): void {
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
          kind: 'coherence',
          message: `Entity is both ${typeName} and disjoint type ${disjoint}`,
          severity: 'error',
        });
      }
    }
    for (const required of type.requires) {
      if (!chain.has(required)) {
        pushIssueOnce(index.issues, {
          file: entity.path,
          kind: 'coherence',
          message: `${typeName} requires class membership: ${required}`,
          severity: 'error',
        });
      }
    }
    for (const excluded of type.excludes) {
      if (chain.has(excluded)) {
        pushIssueOnce(index.issues, {
          file: entity.path,
          kind: 'coherence',
          message: `${typeName} excludes class membership: ${excluded}`,
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

  const canHave = getInheritedCanHave(index, entity);
  for (const [property, definition] of canHave) {
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

  const relations = resolveEntityRelations(index, entity.instanceOf);
  for (const [property, relation] of relations) {
    validateRelation(index, entity, property, relation);
  }

  // Validate weight map values against their scale's min/max.
  // Any object-valued frontmatter key that matches a known scale name is a weight map.
  for (const [key, mapValue] of Object.entries(entity.frontmatter)) {
    if (!mapValue || typeof mapValue !== 'object' || Array.isArray(mapValue)) continue;
    const scale = index.scales.get(key);
    if (!scale) continue;
    const { min, max } = scale;
    if (min === undefined && max === undefined) continue;
    const neutral = scaleNeutral(scale);
    for (const [entryKey, entryValue] of Object.entries(mapValue as Record<string, unknown>)) {
      if (typeof entryValue !== 'number') continue;
      if (entryValue === neutral) continue;
      if ((min !== undefined && entryValue < min) || (max !== undefined && entryValue > max)) {
        pushIssueOnce(index.issues, {
          file: entity.path,
          message: `${key}.${entryKey} value ${entryValue} is outside scale range [${min ?? '−∞'}, ${max ?? '∞'}]`,
          property: key,
          severity: 'error',
        });
      }
    }
  }

  // Opt-in: warn about frontmatter keys that are neither a declared must-have/can-have
  // field, a declared relation, an Obsidian core property, nor an explicitly ignored
  // pattern (for other plugins' metadata). Such a key is never validated or auto-mirrored
  // by anything above — it just sits inert — so this surfaces schema drift that would
  // otherwise pass silently.
  if (index.settings.warnUnknownEntityFields) {
    // A type-def file that doubles as its own hub entity (see resolveTypeFileAsEntity
    // in indexer.ts) carries its full raw type-schema frontmatter — must-have, can-have,
    // relations, subtype-of, etc. — none of which are declared must-have/can-have/relation
    // fields on the entity's own declared type. Exempt every recognized type-schema key
    // for such entities, or every dual-purpose hub type file floods with false positives.
    const isTypeDefEntity = [...index.types.values()].some((type) => type.path === entity.path);
    const known = new Set<string>([
      ...mustHave.keys(),
      ...canHave.keys(),
      ...relations.keys(),
      // entityTypeFields may be configured with unnormalized punctuation (instance_of,
      // is-instance, IsInstance…); frontmatter keys are normalized to kebab-case on read,
      // so normalize here too or the type-membership field itself gets flagged as unknown.
      ...kebabEntityTypeFields(index.settings.entityTypeFields),
      ...NOTE_CONTENT_KEYS,
      'lock',
      ...(isTypeDefEntity ? TYPE_KEYS : []),
    ]);
    for (const key of Object.keys(entity.frontmatter)) {
      if (known.has(key) || isIgnoredEntityField(key, index.settings.ignoredEntityFields)) {
        continue;
      }
      pushIssueOnce(index.issues, {
        file: entity.path,
        message: `Unknown field ${key} on entity of type ${entity.instanceOf.join(', ')}`,
        property: key,
        severity: 'warning',
      });
    }
  }
}

export function validateIndex(index: OntologyIndex): void {
  for (const entity of index.entities.values()) {
    validateSingleEntity(index, entity);
  }
  validateTransitiveRelationCycles(index);
}

/**
 * A relation declared `transitive: true` with a circular chain (A -> B -> A)
 * would imply an infinite set of inferred facts, so the spec forbids it.
 * Symmetric relations are exempt: symmetry makes every single edge a trivial
 * two-cycle by definition, and the runaway-inference risk the rule guards
 * against only arises from directed chains.
 */
function validateTransitiveRelationCycles(index: OntologyIndex): void {
  for (const [property, relation] of index.relationDefinitions) {
    if (relation.transitive !== true || relation.symmetric === true) {
      continue;
    }

    // Directed graph over entity names for this relation only.
    const edges = new Map<string, string[]>();
    for (const entity of index.entities.values()) {
      const targets = extractAssertedWikiLinkTargets(entity.frontmatter[property])
        .map((name) => resolveEntityLoosely(index, name)?.name)
        .filter((name): name is string => name !== undefined);
      if (targets.length > 0) {
        edges.set(entity.name, targets);
      }
    }

    // Iterative colored DFS: gray = on the current path, black = finished.
    const gray = new Set<string>();
    const black = new Set<string>();
    for (const root of edges.keys()) {
      if (black.has(root)) {
        continue;
      }
      const stack: Array<{ name: string; next: number }> = [{ name: root, next: 0 }];
      const path: string[] = [root];
      gray.add(root);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (!frame) break;
        const targets = edges.get(frame.name) ?? [];
        if (frame.next >= targets.length) {
          stack.pop();
          path.pop();
          gray.delete(frame.name);
          black.add(frame.name);
          continue;
        }
        const target = targets[frame.next++];
        if (target === undefined || black.has(target)) {
          continue;
        }
        if (gray.has(target)) {
          const cycleStart = path.indexOf(target);
          const cycle = [...path.slice(cycleStart === -1 ? 0 : cycleStart), target];
          const anchor = index.entitiesByName.get(target);
          pushIssueOnce(index.issues, {
            file: anchor?.path ?? '',
            kind: 'coherence',
            message: `Transitive relation ${property} forms a cycle: ${cycle.join(' -> ')}. Transitive relations must be acyclic.`,
            property,
            severity: 'error',
          });
          continue;
        }
        gray.add(target);
        path.push(target);
        stack.push({ name: target, next: 0 });
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
  validateStrictType(entity.path, property, relation.valueType, value, index.issues);

  // Only strings written as an actual [[wikilink]] are treated as link targets when
  // the relation's value-type explicitly allows plain text (e.g. a "wikilink | string"
  // relation for a plain-text external author) — a bare string there isn't a link at
  // all and validateStrictType already flags it against a wikilink-only relation, so
  // nothing is lost by restricting the check to genuine wikilinks in that case. But
  // most relations declare no value-type at all (the common case: just `range`), and
  // for those validateStrictType is a no-op — so a bare string must still be checked
  // as an asserted target, or a typo'd missing `[[ ]]` would silently skip existence
  // and range validation entirely.
  const allowsPlainString = relation.valueType !== undefined
    && parseTypeExpression(relation.valueType).some((type) => ['string', 'text'].includes(normalizeLinkTarget(type).toLowerCase()));
  const assertedTargets = new Set(
    allowsPlainString ? extractAssertedWikiLinkTargets(value) : extractAssertedLinkTargets(value)
  );
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
    const target = resolveEntityLoosely(index, targetName);
    if (!target) {
      pushIssueOnce(index.issues, { file: entity.path, message: `${property} points to unknown entity ${targetName}`, property, severity: 'warning', target: targetName });
      continue;
    }

    if (relation.range) {
      const targetChain = entityCompositionChain(target, index);
      if (!parseTypeExpression(relation.range).some((range) => targetChain.has(range))) {
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
    && sameStringArray(left.excludedTypes, right.excludedTypes)
    && left.frontmatterKey === right.frontmatterKey
    && sameStringArray(left.includedTypes, right.includedTypes)
    && JSON.stringify(left.insert) === JSON.stringify(right.insert)
    && left.type === right.type
    && sameStringArray(left.values, right.values);
}

function describePropertyDefinition(definition: PropertyDefinition): string {
  const parts = [
    definition.type ? `type ${definition.type}` : '',
    definition.cardinality ? `cardinality ${definition.cardinality}` : '',
    definition.includedTypes?.length ? `included-types ${definition.includedTypes.join(', ')}` : '',
    definition.excludedTypes?.length ? `excluded-types ${definition.excludedTypes.join(', ')}` : '',
    definition.frontmatterKey ? `frontmatter-key ${definition.frontmatterKey}` : '',
    definition.insert !== undefined ? `insert ${displayInsertedValue(definition.insert)}` : '',
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

  // Check implementable-by: if an interface restricts who can implement it,
  // the implementing type (or one of its ancestors) must be in that list.
  for (const type of index.types.values()) {
    if (isRelationDefinitionRegistry(type) || isFieldDefinitionRegistry(type) || type.isInterface) {
      continue;
    }
    for (const ifaceName of type.implements) {
      const iface = index.types.get(ifaceName);
      if (!iface?.implementableBy?.length) {
        continue;
      }
      const allowed = new Set(iface.implementableBy);
      const typeAndAncestors = new Set([type.name, ...(index.ancestorsByType.get(type.name) ?? [])]);
      if (![...typeAndAncestors].some((t) => allowed.has(t))) {
        pushIssueOnce(index.issues, {
          file: type.path,
          message: `${type.name} cannot implement ${ifaceName}: only ${[...allowed].join(', ')} (or their subtypes) may implement it`,
          severity: 'error',
        });
      }
    }
  }
}
