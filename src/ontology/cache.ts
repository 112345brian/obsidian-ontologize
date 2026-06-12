import type { App } from 'obsidian';

import type { AutoApplyBlock, EffectiveLockState, FrontmatterIgnoreRule, OntologyEntity, OntologyIndex, OntologyIssue, OntologyType, PropertyDefinition, RelationDefinition, Scale, TypeReplacement } from './types.ts';

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

function hydrateAutoApply(value: unknown): OntologyType['autoApply'] {
  if (value === true) {
    return true;
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AutoApplyBlock : undefined;
}

function hydrateType(value: unknown): OntologyType {
  const record = asRecord(value);
  return {
    abstract: record['abstract'] === true,
    autoApply: hydrateAutoApply(record['autoApply']),
    canHave: hydrateMap<PropertyDefinition>(record['canHave'], (item) => item as PropertyDefinition),
    cannotHave: new Set(Array.isArray(record['cannotHave']) ? record['cannotHave'].map(String) : []),
    disjoint: Array.isArray(record['disjoint']) ? record['disjoint'].map(String) : [],
    excludes: Array.isArray(record['excludes']) ? record['excludes'].map(String) : [],
    extends: Array.isArray(record['extends']) ? record['extends'].map(String) : [],
    fields: hydrateMap<PropertyDefinition>(record['fields'], (item) => item as PropertyDefinition),
    implementableBy: Array.isArray(record['implementableBy']) ? record['implementableBy'].map(String) : [],
    implements: Array.isArray(record['implements']) ? record['implements'].map(String) : [],
    replaces: Array.isArray(record['replaces']) ? record['replaces'].flatMap((r: unknown): TypeReplacement[] => {
      if (typeof r === 'string') {
        return r ? [{ value: r }] : [];
      }
      const rec = r && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : {};
      const value = typeof rec['value'] === 'string' ? rec['value'] : '';
      return value ? [{ value, ...(typeof rec['field'] === 'string' ? { field: rec['field'] } : {}) }] : [];
    }) : [],
    requires: Array.isArray(record['requires']) ? record['requires'].map(String) : [],
    isInterface: record['isInterface'] === true,
    lockIntent: record['lockIntent'] === true,
    mustHave: hydrateMap<PropertyDefinition>(record['mustHave'], (item) => item as PropertyDefinition),
    name: stringValue(record['name']),
    path: stringValue(record['path']),
    relations: hydrateMap<RelationDefinition>(record['relations'], (item) => item as RelationDefinition),
    scales: hydrateMap<Scale>(record['scales'], (item) => {
      const raw = asRecord(item);
      const stepsRaw = asRecord(raw['steps']);
      const steps: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(stepsRaw)) {
        steps[k] = Array.isArray(v) ? v.map(String) : [String(v)];
      }
      const scale: Scale = { steps };
      if (typeof raw['min'] === 'number') scale.min = raw['min'];
      if (typeof raw['max'] === 'number') scale.max = raw['max'];
      if (typeof raw['neutral'] === 'number') scale.neutral = raw['neutral'];
      if (Array.isArray(raw['normalize'])) scale.normalize = raw['normalize'].map(String);
      return scale;
    }),
    template: typeof record['template'] === 'string' ? record['template'] : undefined,
    typeKind: typeof record['typeKind'] === 'string' ? record['typeKind'] : undefined,
    values: Array.isArray(record['values']) ? record['values'].map(String) : [],
  };
}

function hydrateEntity(value: unknown): OntologyEntity {
  const record = asRecord(value);
  return {
    frontmatter: asRecord(record['frontmatter']),
    ignored: record['ignored'] === true,
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
    const types = hydrateMap<OntologyType>(payload['types'], hydrateType);
    const scales = new Map<string, Scale>();
    for (const type of types.values()) {
      for (const [name, scale] of type.scales) {
        scales.set(name, scale);
      }
    }
    return {
      ambiguousEntityNames: new Set(Array.isArray(payload['ambiguousEntityNames']) ? payload['ambiguousEntityNames'].map(String) : []),
      ancestorsByType: hydrateMap<Set<string>>(payload['ancestorsByType'], (item) => new Set(Array.isArray(item) ? item.map(String) : [])),
      cacheVersion: 1,
      circularTypes: new Set(Array.isArray(payload['circularTypes']) ? payload['circularTypes'].map(String) : []),
      effectiveEntityLocks: hydrateMap<EffectiveLockState>(payload['effectiveEntityLocks'], (item) => item as EffectiveLockState),
      effectiveTypeLocks: hydrateMap<EffectiveLockState>(payload['effectiveTypeLocks'], (item) => item as EffectiveLockState),
      entities,
      entitiesByName: new Map([...entities.values()].map((entity) => [entity.name, entity])),
      fieldDefinitions: hydrateMap<PropertyDefinition>(payload['fieldDefinitions'], (item) => item as PropertyDefinition),
      generatedAt: stringValue(payload['generatedAt']),
      issues: Array.isArray(payload['issues']) ? payload['issues'] as OntologyIssue[] : [],
      relationDefinitions: hydrateMap<RelationDefinition>(payload['relationDefinitions'], (item) => item as RelationDefinition),
      scales,
      schemaIssues: Array.isArray(payload['schemaIssues']) ? payload['schemaIssues'] as OntologyIssue[] : [],
      settings: {
        autoApplyBlockPrefix: stringValue(settings['autoApplyBlockPrefix'], 'condition-'),
        entityTypeFields: stringArrayValue(settings['entityTypeFields']).length > 0 ? stringArrayValue(settings['entityTypeFields']) : ['is-instance', 'type'],
        filesToIgnore: stringArrayValue(settings['filesToIgnore']),
        foldersToIgnore: stringArrayValue(settings['foldersToIgnore']),
        frontmatterIgnoreRules: frontmatterIgnoreRulesValue(settings['frontmatterIgnoreRules']),
        schemaPath: stringValue(settings['schemaPath']),
        typeFolder: stringValue(settings['typeFolder'], '_types'),
      },
      types,
    };
  } catch {
    return null;
  }
}

export async function writeOntologyCache(app: App, cachePath: string, index: OntologyIndex): Promise<void> {
  const payload = {
    ambiguousEntityNames: [...index.ambiguousEntityNames ?? []],
    ancestorsByType: mapToObject(index.ancestorsByType, (value) => [...value]),
    cacheVersion: index.cacheVersion,
    circularTypes: [...index.circularTypes ?? []],
    effectiveEntityLocks: mapToObject(index.effectiveEntityLocks, (value) => value),
    effectiveTypeLocks: mapToObject(index.effectiveTypeLocks, (value) => value),
    entities: mapToObject(index.entities, (value) => value),
    fieldDefinitions: mapToObject(index.fieldDefinitions, (value) => value),
    generatedAt: index.generatedAt,
    issues: index.issues,
    relationDefinitions: mapToObject(index.relationDefinitions, (value) => value),
    schemaIssues: index.schemaIssues ?? [],
    settings: index.settings,
    types: mapToObject(index.types, (value) => ({
      ...value,
      canHave: Object.fromEntries(value.canHave),
      cannotHave: [...value.cannotHave],
      fields: Object.fromEntries(value.fields),
      implements: value.implements,
      isInterface: value.isInterface,
      mustHave: Object.fromEntries(value.mustHave),
      relations: Object.fromEntries(value.relations),
      scales: Object.fromEntries(value.scales),
    })),
  };

  const parent = cachePath.split('/').slice(0, -1).join('/');
  if (parent && !(await app.vault.adapter.exists(parent))) {
    await app.vault.adapter.mkdir(parent);
  }
  await app.vault.adapter.write(cachePath, JSON.stringify(payload, null, 2));
}
