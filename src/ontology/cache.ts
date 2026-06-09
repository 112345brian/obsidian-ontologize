import type { App } from 'obsidian';

import type { EffectiveLockState, FrontmatterIgnoreRule, OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

function mapToObject<T>(map: Map<string, T>, mapper: (value: T) => unknown): Record<string, unknown> {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, mapper(value)]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function frontmatterIgnoreRulesValue(value: unknown): FrontmatterIgnoreRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    const key = stringValue(record['key']).trim();
    if (!key) {
      return [];
    }
    const valueString = stringValue(record['value']).trim();
    return [{
      key,
      ...(valueString ? { value: valueString } : {}),
    }];
  });
}

function hydrateMap<T>(value: unknown, mapper: (value: unknown) => T): Map<string, T> {
  return new Map(Object.entries(asRecord(value)).map(([key, item]) => [key, mapper(item)]));
}

function hydrateType(value: unknown): OntologyType {
  const record = asRecord(value);
  return {
    abstract: record['abstract'] === true,
    canHave: hydrateMap<PropertyDefinition>(record['canHave'], (item) => item as PropertyDefinition),
    cannotHave: new Set(Array.isArray(record['cannotHave']) ? record['cannotHave'].map(String) : []),
    disjoint: Array.isArray(record['disjoint']) ? record['disjoint'].map(String) : [],
    extends: Array.isArray(record['extends']) ? record['extends'].map(String) : [],
    implements: Array.isArray(record['implements']) ? record['implements'].map(String) : [],
    isInterface: record['isInterface'] === true,
    lockIntent: record['lockIntent'] === true,
    mustHave: hydrateMap<PropertyDefinition>(record['mustHave'], (item) => item as PropertyDefinition),
    name: stringValue(record['name']),
    path: stringValue(record['path']),
    relations: hydrateMap<RelationDefinition>(record['relations'], (item) => item as RelationDefinition),
    typeKind: typeof record['typeKind'] === 'string' ? record['typeKind'] : undefined,
    values: Array.isArray(record['values']) ? record['values'].map(String) : [],
  };
}

function hydrateEntity(value: unknown): OntologyEntity {
  const record = asRecord(value);
  return {
    frontmatter: asRecord(record['frontmatter']),
    instanceOf: Array.isArray(record['instanceOf']) ? record['instanceOf'].map(String) : [],
    lockIntent: record['lockIntent'] === true,
    name: stringValue(record['name']),
    path: stringValue(record['path']),
  };
}

export async function readOntologyCache(app: App, cachePath: string): Promise<OntologyIndex | null> {
  try {
    if (!(await app.vault.adapter.exists(cachePath))) {
      return null;
    }
    const payload = asRecord(JSON.parse(await app.vault.adapter.read(cachePath)) as unknown);
    if (payload['cacheVersion'] !== 1) {
      return null;
    }

    const entities = hydrateMap<OntologyEntity>(payload['entities'], hydrateEntity);
    const settings = asRecord(payload['settings']);
    return {
      ancestorsByType: hydrateMap<Set<string>>(payload['ancestorsByType'], (item) => new Set(Array.isArray(item) ? item.map(String) : [])),
      cacheVersion: 1,
      effectiveEntityLocks: hydrateMap<EffectiveLockState>(payload['effectiveEntityLocks'], (item) => item as EffectiveLockState),
      effectiveTypeLocks: hydrateMap<EffectiveLockState>(payload['effectiveTypeLocks'], (item) => item as EffectiveLockState),
      entities,
      entitiesByName: new Map([...entities.values()].map((entity) => [entity.name, entity])),
      generatedAt: stringValue(payload['generatedAt']),
      issues: Array.isArray(payload['issues']) ? payload['issues'] as OntologyIssue[] : [],
      relationDefinitions: hydrateMap<RelationDefinition>(payload['relationDefinitions'], (item) => item as RelationDefinition),
      settings: {
        filesToIgnore: stringArrayValue(settings['filesToIgnore']),
        foldersToIgnore: stringArrayValue(settings['foldersToIgnore']),
        frontmatterIgnoreRules: frontmatterIgnoreRulesValue(settings['frontmatterIgnoreRules']),
        typeFolder: stringValue(settings['typeFolder'], '_types'),
      },
      types: hydrateMap<OntologyType>(payload['types'], hydrateType),
    };
  } catch {
    return null;
  }
}

export async function writeOntologyCache(app: App, cachePath: string, index: OntologyIndex): Promise<void> {
  const payload = {
    ancestorsByType: mapToObject(index.ancestorsByType, (value) => [...value]),
    cacheVersion: index.cacheVersion,
    effectiveEntityLocks: mapToObject(index.effectiveEntityLocks, (value) => value),
    effectiveTypeLocks: mapToObject(index.effectiveTypeLocks, (value) => value),
    entities: mapToObject(index.entities, (value) => value),
    generatedAt: index.generatedAt,
    issues: index.issues,
    relationDefinitions: mapToObject(index.relationDefinitions, (value) => value),
    settings: index.settings,
    types: mapToObject(index.types, (value) => ({
      ...value,
      canHave: Object.fromEntries(value.canHave),
      cannotHave: [...value.cannotHave],
      implements: value.implements,
      isInterface: value.isInterface,
      mustHave: Object.fromEntries(value.mustHave),
      relations: Object.fromEntries(value.relations),
    })),
  };

  const parent = cachePath.split('/').slice(0, -1).join('/');
  if (parent && !(await app.vault.adapter.exists(parent))) {
    await app.vault.adapter.mkdir(parent);
  }
  await app.vault.adapter.write(cachePath, JSON.stringify(payload, null, 2));
}
