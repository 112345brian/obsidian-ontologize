import { describe, expect, it } from 'vitest';

import type { App } from 'obsidian';
import type { OntologyIndex } from './types.ts';

import { readOntologyCache, writeOntologyCache } from './cache.ts';

function makeFakeApp(files: Map<string, string>): App {
  return {
    vault: {
      adapter: {
        exists: (path: string) => Promise.resolve(files.has(path)),
        mkdir: () => Promise.resolve(),
        read: (path: string) => Promise.resolve(files.get(path) ?? ''),
        write: (path: string, data: string) => {
          files.set(path, data);
          return Promise.resolve();
        },
      },
    },
  } as unknown as App;
}

function makeIndex(): OntologyIndex {
  return {
    ambiguousEntityNames: new Set(['Smith']),
    ancestorsByType: new Map([
      ['Philosopher', new Set(['Person'])],
      ['Person', new Set<string>()],
    ]),
    cacheVersion: 1,
    circularTypes: new Set(['Loop']),
    effectiveEntityLocks: new Map([
      ['Ada.md', { state: 'locked' as const }],
    ]),
    effectiveTypeLocks: new Map([
      ['Person', { state: 'locked' as const }],
      ['Philosopher', { reason: 'ancestor Person is not locked', state: 'incomplete' as const }],
    ]),
    entities: new Map([
      ['Ada.md', {
        frontmatter: { 'birth-year': 1815, instance_of: '[[Philosopher]]', lock: true },
        ignored: false,
        instanceOf: ['Philosopher'],
        lockIntent: true,
        name: 'Ada',
        path: 'Ada.md',
      }],
    ]),
    entitiesByName: new Map(),
    fieldDefinitions: new Map([
      ['birth-year', { cardinality: 'one', frontmatterKey: 'birth_year', type: 'number' }],
    ]),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [
      { file: 'Ada.md', message: 'Missing required property species', property: 'species', severity: 'error' as const },
    ],
    relationDefinitions: new Map([
      ['influenced_by', { autoUpdate: true, inverse: 'influenced', range: 'Person', valueType: 'wikilink' }],
    ]),
    scales: new Map(),
    schemaIssues: [
      { file: '_types/Broken.md', message: 'Unknown type field typo', severity: 'warning' as const },
    ],
    settings: {
      autoApplyBlockPrefix: 'condition-',
      entityTypeFields: ['instance_of', 'type'],
      filesToIgnore: ['\\.canvas\\.md$'],
      foldersToIgnore: ['Archive'],
      frontmatterIgnoreRules: [{ key: 'status', value: 'private' }],
      globalTypePath: '',
      requireOntologizePrefix: false,
      schemaPath: '_types/ontology.schema.yaml',
      typeFolder: '_types',
    },
    types: new Map([
      ['Philosopher', {
        abstract: false,
        alsoApply: [],
        autoApply: { blocks: {}, conditions: { era: 'modern' }, match: 'all' as const },
        canHave: new Map([['magnum-opus', { type: 'Work' }]]),
        cannotHave: new Set(['tag']),
        disjoint: ['Musician'],
        excludes: ['Sophist'],
        extends: ['Person'],
        replaces: [{ value: 'Thinker' }, { field: 'category', newField: 'role', newValue: 'Philosopher', value: 'Sage' }],
        requires: ['Person'],
        template: 'Templates/Philosopher',
        fields: new Map([['birth-year', { frontmatterKey: 'birth_year', type: 'number' }]]),
        implementableBy: [],
        implements: ['Influenceable'],
        ingestFrom: new Map(),
        isInterface: false,
        lockIntent: true,
        mustHave: new Map([['species', { type: 'string' }]]),
        name: 'Philosopher',
        path: '_types/Philosopher.md',
        relations: new Map([['influenced_by', { uses: 'influenced_by' }]]),
        scales: new Map(),
        typeKind: undefined,
        values: [],
      }],
    ]),
  };
}

describe('ontology cache round trip', () => {
  it('hydrates every derived field exactly as written', async () => {
    const files = new Map<string, string>();
    const app = makeFakeApp(files);
    const original = makeIndex();

    await writeOntologyCache(app, '.obsidian/ontology-cache.json', original);
    const hydrated = await readOntologyCache(app, '.obsidian/ontology-cache.json');

    expect(hydrated).not.toBeNull();
    expect(hydrated!.ambiguousEntityNames).toEqual(original.ambiguousEntityNames);
    expect(hydrated!.ancestorsByType).toEqual(original.ancestorsByType);
    expect(hydrated!.circularTypes).toEqual(original.circularTypes);
    expect(hydrated!.effectiveEntityLocks).toEqual(original.effectiveEntityLocks);
    expect(hydrated!.effectiveTypeLocks).toEqual(original.effectiveTypeLocks);
    expect(hydrated!.entities).toEqual(original.entities);
    expect(hydrated!.fieldDefinitions).toEqual(original.fieldDefinitions);
    expect(hydrated!.generatedAt).toBe(original.generatedAt);
    expect(hydrated!.issues).toEqual(original.issues);
    expect(hydrated!.relationDefinitions).toEqual(original.relationDefinitions);
    expect(hydrated!.schemaIssues).toEqual(original.schemaIssues);
    expect(hydrated!.settings).toEqual(original.settings);
    expect(hydrated!.types).toEqual(original.types);
    expect(hydrated!.entitiesByName.get('Ada')?.path).toBe('Ada.md');
  });

  it('rejects malformed and version-mismatched caches', async () => {
    const files = new Map<string, string>([
      ['bad.json', '{not json'],
      ['old.json', JSON.stringify({ cacheVersion: 0 })],
    ]);
    const app = makeFakeApp(files);

    expect(await readOntologyCache(app, 'missing.json')).toBeNull();
    expect(await readOntologyCache(app, 'bad.json')).toBeNull();
    expect(await readOntologyCache(app, 'old.json')).toBeNull();
  });
});
