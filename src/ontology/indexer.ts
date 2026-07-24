import type {
  App,
  TFile
} from 'obsidian';

type MaybeFile = { extension: string } | null | undefined;

import type {
  EffectiveLockState,
  FrontmatterIgnoreRule,
  OntologyEntity,
  OntologyIndex,
  OntologyIssue,
  OntologyType,
  PropertyDefinition,
  RelationDefinition,
  Scale
} from './types.ts';

import {
  collectGlobalFieldDefinitions,
  collectGlobalRelationDefinitions,
  pushIssueOnce,
  resolveGlobalType,
  typeCompositionChain
} from './compose.ts';
import {
  basenameWithoutExtension,
  extractAssertedLinkTargets,
  normalizeLinkTarget
} from './links.ts';
import { detectTypeFromIngestFields } from './mutations.ts';
import {
  parseOntologyEntity,
  parseOntologySchema,
  parseOntologyType
} from './parser.ts';
import {
  lintOntologySchemaSource,
  lintOntologyTypeSource
} from './schema-linter.ts';
import {
  validateIndex,
  validateSchemaCompositionConflicts,
  validateSingleEntity
} from './validate.ts';

export interface BuildIndexSettings {
  autoApplyBlockPrefix?: string;
  entityTypeFields?: string[];
  filesToIgnore?: string[];
  foldersToIgnore?: string[];
  frontmatterIgnoreRules?: FrontmatterIgnoreRule[];
  globalTypePath?: string;
  ignoredEntityFields?: string[];
  requireOntologizePrefix?: boolean;
  schemaPath?: string;
  typeFolder: string;
  warnUnknownEntityFields?: boolean;
}

function normalizedFolders(folders: string[] | undefined): string[] {
  return (folders ?? []).map((folder) => folder.trim().replace(/\/$/, '')).filter(Boolean);
}

function normalizedEntityTypeFields(fields: string[] | undefined): string[] {
  const normalized = (fields ?? []).map((field) => field.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : ['is-instance', 'type'];
}

// Compiled once per pattern string; ignore patterns are checked against every
// vault file on every rebuild, so recompiling per call is wasted work and a
// permanently invalid pattern would be re-parsed forever.
const compiledIgnorePatterns = new Map<string, null | RegExp>();

function safePatternMatches(pattern: string, path: string): boolean {
  let compiled = compiledIgnorePatterns.get(pattern);
  if (compiled === undefined) {
    try {
      compiled = new RegExp(pattern);
    } catch {
      compiled = null;
    }
    compiledIgnorePatterns.set(pattern, compiled);
  }
  return compiled?.test(path) ?? false;
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

export function isOntologyTypeFile(file: TFile, typeFolder: string, frontmatter?: Record<string, unknown>): boolean {
  if (file.extension !== 'md') return false;
  if (file.path.startsWith(`${typeFolder.replace(/\/$/, '')}/`)) return true;
  return frontmatter?.['ontologize'] === true;
}

export function isOntologySchemaFile(file: TFile, schemaPath: string | undefined): boolean {
  return Boolean(schemaPath?.trim()) && file.path === schemaPath?.trim();
}

function createEmptyOntologyIndex(settings: BuildIndexSettings): OntologyIndex {
  return {
    ambiguousEntityNames: new Set<string>(),
    ancestorsByType: new Map<string, Set<string>>(),
    cacheVersion: 2,
    circularTypes: new Set<string>(),
    effectiveEntityLocks: new Map<string, EffectiveLockState>(),
    effectiveTypeLocks: new Map<string, EffectiveLockState>(),
    entities: new Map<string, OntologyEntity>(),
    entitiesByName: new Map<string, OntologyEntity>(),
    fieldDefinitions: new Map<string, PropertyDefinition>(),
    generatedAt: new Date().toISOString(),
    issues: [],
    relationDefinitions: new Map<string, RelationDefinition>(),
    scales: new Map<string, Scale>(),
    schemaIssues: [],
    settings: {
      autoApplyBlockPrefix: settings.autoApplyBlockPrefix ?? 'condition-',
      entityTypeFields: normalizedEntityTypeFields(settings.entityTypeFields),
      filesToIgnore: settings.filesToIgnore ?? [],
      foldersToIgnore: settings.foldersToIgnore ?? [],
      frontmatterIgnoreRules: settings.frontmatterIgnoreRules ?? [],
      globalTypePath: settings.globalTypePath ?? '',
      ignoredEntityFields: settings.ignoredEntityFields ?? [],
      requireOntologizePrefix: settings.requireOntologizePrefix === true,
      schemaPath: settings.schemaPath ?? '',
      typeFolder: settings.typeFolder,
      warnUnknownEntityFields: settings.warnUnknownEntityFields === true
    },
    types: new Map<string, OntologyType>()
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
        severity: 'error'
      });
      return ancestors;
    }

    visiting.add(name);
    for (const parent of type.subtypeOf) {
      if (!types.has(parent)) {
        pushIssueOnce(issues, {
          file: type.path,
          message: `Unknown parent type ${parent}`,
          severity: 'error'
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

// Incrementally re-derives the "Duplicate entity name" issue for a single name after
// rebuildEntityNameIndex — the fast path only touches one entity per edit, so only the
// name(s) that entity is (or was) registered under can have changed ambiguity status;
// every other name's issue is untouched. Mirrors the full derivation in
// recomputeOntologyDerivedState, which regenerates all of them from scratch.
function syncDuplicateEntityNameIssue(index: OntologyIndex, name: string): void {
  index.issues = index.issues.filter((issue) => !issue.message.startsWith(`Duplicate entity name ${name}:`));
  if (index.ambiguousEntityNames?.has(name)) {
    const paths = [...index.entities.values()].filter((entity) => entity.name === name).map((entity) => entity.path).sort();
    pushIssueOnce(index.issues, {
      file: paths[0] ?? '',
      message: `Duplicate entity name ${name}: ${paths.join(', ')}. Wiki links to ${name} cannot be resolved unambiguously.`,
      severity: 'warning'
    });
  }
}

// Obsidian resolves wikilinks case-insensitively, so `is-instance: [[philosopher]]`
// points at Philosopher.md just fine in the app — membership resolution has to
// accept the same variance instead of silently treating it as an unknown type.
// Mirrors the folded entity-name resolution in validate.ts.
function buildFoldedTypeNameMap(types: Map<string, OntologyType>): Map<string, string> {
  const folded = new Map<string, string>();
  for (const name of types.keys()) {
    const key = name.toLowerCase();
    if (!folded.has(key)) {
      folded.set(key, name);
    }
  }
  return folded;
}

function canonicalTypeName(types: Map<string, OntologyType>, folded: Map<string, string>, name: string): string {
  return types.has(name) ? name : folded.get(name.toLowerCase()) ?? name;
}

/**
 * Expands declared memberships to the full effective set: subtype-of-ancestors
 * plus also-apply co-types, to a fixpoint (also-apply can chain, and co-applied
 * types bring their own ancestors). Mirrors the schema contract that also-apply
 * types "are applied whenever this type is applied" — membership-level, no
 * frontmatter writes.
 */
function expandDeclaredMemberships(
  index: Pick<OntologyIndex, 'ancestorsByType' | 'types'>,
  foldedTypeNames: Map<string, string>,
  declared: string[],
): string[] {
  const expanded = new Set<string>();
  const queue = declared.map((name) => canonicalTypeName(index.types, foldedTypeNames, name));
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || expanded.has(name)) {
      continue;
    }
    expanded.add(name);
    for (const ancestor of index.ancestorsByType.get(name) ?? []) {
      if (!expanded.has(ancestor)) {
        queue.push(ancestor);
      }
    }
    for (const coType of index.types.get(name)?.alsoApply ?? []) {
      const canonical = canonicalTypeName(index.types, foldedTypeNames, coType);
      if (index.types.has(canonical) && !expanded.has(canonical)) {
        queue.push(canonical);
      }
    }
  }
  return [...expanded];
}

export function recomputeOntologyDerivedState(index: OntologyIndex): OntologyIndex {
  index.issues = [...index.schemaIssues ?? []];
  rebuildEntityNameIndex(index);
  for (const name of index.ambiguousEntityNames ?? []) {
    const paths = [...index.entities.values()].filter((entity) => entity.name === name).map((entity) => entity.path).sort();
    pushIssueOnce(index.issues, {
      file: paths[0] ?? '',
      message: `Duplicate entity name ${name}: ${paths.join(', ')}. Wiki links to ${name} cannot be resolved unambiguously.`,
      severity: 'warning'
    });
  }
  const circularTypes = new Set<string>();
  index.ancestorsByType = computeAncestors(index.types, index.issues, circularTypes);
  index.circularTypes = circularTypes;
  index.fieldDefinitions = collectGlobalFieldDefinitions(index.types);
  index.relationDefinitions = collectGlobalRelationDefinitions(index.types);
  index.scales = new Map<string, Scale>();
  for (const type of index.types.values()) {
    for (const [name, scale] of type.scales) {
      index.scales.set(name, scale);
    }
  }

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

  // Expand each entity's instanceOf to include all ancestors implied by subtype-of.
  // e.g. if philosopher is subtype-of person, a philosopher entity is also a person.
  // Expansion always starts from the declared memberships so ancestors removed
  // from the type hierarchy also disappear from entities on the next recompute.
  // (Entities hydrated from a pre-declaredInstanceOf cache fall back to the
  // stored expanded list until their file is next parsed.)
  const foldedTypeNames = buildFoldedTypeNameMap(index.types);
  for (const entity of index.entities.values()) {
    entity.instanceOf = expandDeclaredMemberships(index, foldedTypeNames, entity.declaredInstanceOf ?? entity.instanceOf);
  }

  index.effectiveEntityLocks = new Map<string, EffectiveLockState>();
  for (const entity of index.entities.values()) {
    index.effectiveEntityLocks.set(entity.path, computeEntityLock(entity, index.effectiveTypeLocks));
  }

  resolveGlobalType(index);

  index.generatedAt = new Date().toISOString();
  validateIndex(index);
  return index;
}

function resolveEntityFromFile(
  path: string,
  frontmatter: Record<string, unknown>,
  typeFields: string[],
  index: OntologyIndex
): OntologyEntity | null {
  const explicit = parseOntologyEntity(path, frontmatter, typeFields);
  if (explicit) return explicit;

  const detected = detectTypeFromIngestFields(index, frontmatter);
  if (!detected) return null;

  return {
    frontmatter,
    ignored: false,
    declaredInstanceOf: [detected],
    instanceOf: [detected],
    lockIntent: frontmatter['lock'] === true,
    name: basenameWithoutExtension(path),
    path
  };
}

/**
 * A type-def file that also declares an explicit instance-of doubles as the
 * browsable hub note for its own type (e.g. config/_types/moment.md embeds a
 * dashboard and carries its own member-of/aliases, unifying what used to be
 * a separate ARCHIVE/Moments.md). Only the explicit form counts here — the
 * ingest-from fallback is deliberately not consulted, since that would infer
 * a type for type-def files that never meant to be dual-purposed.
 */
function resolveTypeFileAsEntity(
  path: string,
  frontmatter: Record<string, unknown>,
  typeFields: string[]
): OntologyEntity | null {
  // On a type-def file, a bare "type" key is already reserved for typeKind
  // (nominal / relation-definitions / field-definitions / interface) — it
  // never means instance-of here, even if the vault's own entityTypeFields
  // setting treats "type" as an instance-of alias for regular entities.
  const dualPurposeFields = typeFields.filter((field) => field !== 'type');
  return parseOntologyEntity(path, frontmatter, dualPurposeFields);
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

function entityFrontmatterTouchesTransitiveRelation(index: OntologyIndex, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
  for (const property of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (index.relationDefinitions.get(property)?.transitive === true) {
      return true;
    }
  }
  return false;
}

function linkedEntityNames(frontmatter: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(frontmatter)) {
    for (const target of extractAssertedLinkTargets(value)) {
      names.add(target);
    }
  }
  return names;
}

function entityPathsLinkedToName(index: OntologyIndex, targetName: string): Set<string> {
  const paths = new Set<string>();
  for (const entity of index.entities.values()) {
    if (linkedEntityNames(entity.frontmatter).has(targetName)) {
      paths.add(entity.path);
    }
  }
  return paths;
}

function revalidateEntityPaths(index: OntologyIndex, paths: Set<string>): void {
  index.issues = index.issues.filter((issue) => !paths.has(issue.file));
  for (const path of paths) {
    const entity = index.entities.get(path);
    if (entity) {
      validateSingleEntity(index, entity);
    }
  }
}

async function loadSchemaTypes(app: App, index: OntologyIndex, settings: BuildIndexSettings): Promise<void> {
  const schemaPath = settings.schemaPath?.trim();
  if (!schemaPath) {
    return;
  }

  // Prefer the Vault API; fall back to the adapter for schema files kept in
  // dot-folders (e.g. .config/), which the vault index does not surface.
  const schemaFile = app.vault.getFileByPath(schemaPath);
  let source: string;
  if (schemaFile) {
    source = await app.vault.read(schemaFile);
  } else if (await app.vault.adapter.exists(schemaPath)) {
    source = await app.vault.adapter.read(schemaPath);
  } else {
    return;
  }
  const lintIssues = lintOntologySchemaSource(schemaPath, source, settings.autoApplyBlockPrefix);
  index.schemaIssues?.push(...lintIssues);
  if (lintIssues.some((item) => item.severity === 'error')) {
    return;
  }
  for (const type of parseOntologySchema(schemaPath, source, settings.autoApplyBlockPrefix)) {
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

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
  if (isOntologyTypeFile(file, settings.typeFolder, frontmatter)) {
    const source = await app.vault.read(file);
    const lintIssues = lintOntologyTypeSource(file.path, source, settings.autoApplyBlockPrefix, settings.requireOntologizePrefix, normalizedEntityTypeFields(settings.entityTypeFields));
    index.schemaIssues?.push(...lintIssues);
    if (lintIssues.some((item) => item.severity === 'error')) {
      return recomputeOntologyDerivedState(index);
    }
    const type = parseOntologyType(file.path, source, settings.autoApplyBlockPrefix, settings.requireOntologizePrefix);
    index.types.set(type.name, type);
    if (!isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
      const hubEntity = resolveTypeFileAsEntity(file.path, frontmatter ?? {}, normalizedEntityTypeFields(settings.entityTypeFields));
      if (hubEntity) {
        index.entities.set(hubEntity.path, hubEntity);
      }
    }
    return recomputeOntologyDerivedState(index);
  }

  if (isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
    return recomputeOntologyDerivedState(index);
  }
  const entity = resolveEntityFromFile(file.path, frontmatter ?? {}, normalizedEntityTypeFields(settings.entityTypeFields), index);
  if (entity) {
    index.entities.set(entity.path, entity);
  }
  return recomputeOntologyDerivedState(index);
}

export async function upsertOntologyEntityFileFast(app: App, index: OntologyIndex, file: TFile, settings: BuildIndexSettings): Promise<OntologyIndex> {
  if (isOntologySchemaFile(file, settings.schemaPath)) {
    return buildOntologyIndex(app, settings);
  }

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
  if (isOntologyTypeFile(file, settings.typeFolder, frontmatter) || isIgnoredOntologyPath(file.path, settings)) {
    return upsertOntologyFile(app, index, file, settings);
  }

  const previous = index.entities.get(file.path);
  if (entityFrontmatterTouchesTransitiveRelation(index, previous?.frontmatter, frontmatter)) {
    return upsertOntologyFile(app, index, file, settings);
  }

  if (isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
    return previous ? upsertOntologyFile(app, index, file, settings) : index;
  }

  const fresh = resolveEntityFromFile(file.path, frontmatter ?? {}, normalizedEntityTypeFields(settings.entityTypeFields), index);
  if (!fresh) {
    return previous ? upsertOntologyFile(app, index, file, settings) : index;
  }

  const foldedTypeNames = buildFoldedTypeNameMap(index.types);
  fresh.instanceOf = expandDeclaredMemberships(index, foldedTypeNames, fresh.declaredInstanceOf ?? fresh.instanceOf);

  const affectedPaths = new Set<string>([file.path]);
  for (const targetName of linkedEntityNames(previous?.frontmatter ?? {})) {
    const target = index.entitiesByName.get(targetName);
    if (target) affectedPaths.add(target.path);
  }
  for (const targetName of linkedEntityNames(fresh.frontmatter)) {
    const target = index.entitiesByName.get(targetName);
    if (target) affectedPaths.add(target.path);
  }
  for (const path of entityPathsLinkedToName(index, fresh.name)) {
    affectedPaths.add(path);
  }

  index.entities.set(file.path, fresh);
  rebuildEntityNameIndex(index);
  index.effectiveEntityLocks.set(file.path, computeEntityLock(fresh, index.effectiveTypeLocks));
  revalidateEntityPaths(index, affectedPaths);
  // Must run after revalidateEntityPaths, which clears and re-derives per-entity
  // issues for affectedPaths — a duplicate-name issue added before that filter runs
  // could be wiped out if its `file` (the alphabetically-first duplicate path) happens
  // to be one of the affected paths.
  syncDuplicateEntityNameIssue(index, fresh.name);
  if (previous && previous.name !== fresh.name) {
    syncDuplicateEntityNameIssue(index, previous.name);
  }
  index.generatedAt = new Date().toISOString();
  return index;
}

export interface BatchRevalidationResult {
  /** Entity paths whose frontmatter diverged from the in-memory record. */
  staleCount: number;
  /** Entity paths that were present in the batch but no longer exist or are now ignored. */
  removedCount: number;
}

/**
 * Re-checks a batch of entity paths against the current `metadataCache`
 * (synchronous — no disk I/O) and re-runs entity-level validation for each.
 *
 * This is the hot path for background sweeps: the type graph and derived state
 * (ancestors, locks, field/relation definitions) are assumed stable. Only
 * entity frontmatter staleness and per-entity validation issues are refreshed.
 *
 * Callers must strip and re-add issues for the batch paths (done here), and
 * should schedule a debounced cache write if the result shows any changes.
 */
export function revalidateEntityBatch(app: App, index: OntologyIndex, paths: string[]): BatchRevalidationResult {
  if (paths.length === 0) {
    return { removedCount: 0, staleCount: 0 };
  }

  const pathSet = new Set(paths);
  const typeFields = normalizedEntityTypeFields(index.settings.entityTypeFields);
  const foldedTypeNames = buildFoldedTypeNameMap(index.types);
  let staleCount = 0;
  let removedCount = 0;

  for (const path of paths) {
    const abstractFile = app.vault.getAbstractFileByPath(path) as MaybeFile;
    const tfile = abstractFile && 'extension' in abstractFile ? abstractFile as TFile : null;

    if (!tfile) {
      // File was deleted but the delete event was missed.
      index.entities.delete(path);
      removedCount++;
      continue;
    }

    const frontmatter = app.metadataCache.getFileCache(tfile)?.frontmatter ?? {};

    if (isIgnoredByFrontmatter(frontmatter, index.settings)) {
      index.entities.delete(path);
      removedCount++;
      continue;
    }

    const fresh = resolveEntityFromFile(path, frontmatter, typeFields, index);
    if (!fresh) {
      index.entities.delete(path);
      removedCount++;
      continue;
    }

    // Expand fresh instanceOf so the comparison is against the same expanded form
    // that recomputeOntologyDerivedState produces for stored entities.
    fresh.instanceOf = expandDeclaredMemberships(index, foldedTypeNames, fresh.declaredInstanceOf ?? fresh.instanceOf);

    const existing = index.entities.get(path);
    // Compare frontmatter by value — only update if something actually changed
    // to avoid unnecessary cache writes when the vault is quiet.
    if (
      !existing || JSON.stringify(existing.frontmatter) !== JSON.stringify(fresh.frontmatter)
      || existing.lockIntent !== fresh.lockIntent
      || [...existing.instanceOf].sort().join('\0') !== [...fresh.instanceOf].sort().join('\0')
    ) {
      index.entities.set(path, fresh);
      staleCount++;
    }
  }

  // Rebuild entity name index so ambiguity detection is current for the batch.
  const byName = new Map<string, OntologyEntity>();
  const counts = new Map<string, number>();
  for (const entity of index.entities.values()) {
    byName.set(entity.name, entity);
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  index.entitiesByName = byName;
  index.ambiguousEntityNames = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));

  // Strip batch issues, then re-run per-entity validation for them.
  // Issues belonging to other entities are preserved — they will be refreshed
  // when their own batch sweep runs.
  index.issues = index.issues.filter((issue) => !pathSet.has(issue.file));
  for (const path of paths) {
    const entity = index.entities.get(path);
    if (entity) {
      validateSingleEntity(index, entity);
    }
  }

  return { removedCount, staleCount };
}

export async function buildOntologyIndex(app: App, settings: BuildIndexSettings): Promise<OntologyIndex> {
  const index = createEmptyOntologyIndex(settings);
  await loadSchemaTypes(app, index, settings);

  const allFiles = app.vault.getMarkdownFiles();
  const entityFiles = [];
  const typeFields = normalizedEntityTypeFields(settings.entityTypeFields);

  // Pass 1: load all type files so ingest-from detection has the full type map.
  for (const file of allFiles) {
    if (isOntologySchemaFile(file, settings.schemaPath) || isIgnoredOntologyPath(file.path, settings)) {
      continue;
    }
    const cachedFm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (isOntologyTypeFile(file, settings.typeFolder, cachedFm)) {
      const source = await app.vault.read(file);
      const lintIssues = lintOntologyTypeSource(file.path, source, settings.autoApplyBlockPrefix, settings.requireOntologizePrefix, normalizedEntityTypeFields(settings.entityTypeFields));
      index.schemaIssues?.push(...lintIssues);
      if (!lintIssues.some((item) => item.severity === 'error')) {
        const type = parseOntologyType(file.path, source, settings.autoApplyBlockPrefix, settings.requireOntologizePrefix);
        index.types.set(type.name, type);
      }
      if (!isIgnoredByFrontmatter(cachedFm ?? {}, settings)) {
        const hubEntity = resolveTypeFileAsEntity(file.path, cachedFm ?? {}, typeFields);
        if (hubEntity) {
          index.entities.set(hubEntity.path, hubEntity);
        }
      }
    } else {
      entityFiles.push(file);
    }
  }

  // Pass 2: resolve entities with the complete type map available.
  for (const file of entityFiles) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (isIgnoredByFrontmatter(frontmatter ?? {}, settings)) {
      continue;
    }
    const entity = resolveEntityFromFile(file.path, frontmatter ?? {}, typeFields, index);
    if (entity) {
      index.entities.set(entity.path, entity);
    }
  }

  return recomputeOntologyDerivedState(index);
}
