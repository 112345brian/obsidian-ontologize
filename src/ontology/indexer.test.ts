import { describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';
import type { OntologyIndex, OntologyType, RelationDefinition } from './types.ts';

vi.mock('obsidian', () => ({
  parseYaml: () => ({}),
}));

import { buildOntologyIndex, isIgnoredByFrontmatter, recomputeOntologyDerivedState, removeOntologyFile } from './indexer.ts';

function makeType(
  name: string,
  path: string,
  lockIntent: boolean,
  extendsTypes: string[] = [],
  options: {
    implementsTypes?: string[];
    isInterface?: boolean;
    relations?: Map<string, RelationDefinition>;
    typeKind?: string;
  } = {}
): OntologyType {
  return {
    abstract: false,
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    extends: extendsTypes,
    implements: options.implementsTypes ?? [],
    isInterface: options.isInterface === true,
    lockIntent,
    mustHave: new Map(),
    name,
    path,
    relations: options.relations ?? new Map<string, RelationDefinition>(),
    typeKind: options.typeKind,
    values: [],
  };
}

function makeIndex(): OntologyIndex {
  return {
    ancestorsByType: new Map(),
    cacheVersion: 1,
    effectiveEntityLocks: new Map(),
    effectiveTypeLocks: new Map(),
    entities: new Map([
      ['Ada.md', {
        frontmatter: {
          instance_of: '[[Philosopher]]',
          lock: true,
        },
        instanceOf: ['Philosopher'],
        lockIntent: true,
        name: 'Ada',
        path: 'Ada.md',
      }],
    ]),
    entitiesByName: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [],
    relationDefinitions: new Map(),
    settings: {
      filesToIgnore: [],
      foldersToIgnore: [],
      frontmatterIgnoreRules: [],
      schemaPath: '',
      typeFolder: '_types',
    },
    types: new Map([
      ['Person', makeType('Person', '_types/Person.md', true)],
      ['Philosopher', makeType('Philosopher', '_types/Philosopher.md', true, ['Person'])],
    ]),
  };
}

describe('incremental ontology index state', () => {
  it('recomputes derived lock validity from already parsed type state', () => {
    const index = recomputeOntologyDerivedState(makeIndex());
    expect(index.effectiveEntityLocks.get('Ada.md')?.state).toBe('locked');

    index.types.set('Person', makeType('Person', '_types/Person.md', false));
    recomputeOntologyDerivedState(index);
    expect(index.effectiveTypeLocks.get('Philosopher')?.state).toBe('incomplete');
    expect(index.effectiveEntityLocks.get('Ada.md')?.state).toBe('incomplete');
  });

  it('removes stale file nodes and refreshes validation', () => {
    const index = recomputeOntologyDerivedState(makeIndex());
    expect(index.entitiesByName.has('Ada')).toBe(true);

    removeOntologyFile(index, 'Ada.md');
    expect(index.entities.has('Ada.md')).toBe(false);
    expect(index.entitiesByName.has('Ada')).toBe(false);
    expect(index.issues).toEqual([]);
  });

  it('can ignore folder paths before validation', () => {
    const index = makeIndex();
    index.settings.foldersToIgnore = ['Archive'];
    index.entities.set('Archive/Draft.md', {
      frontmatter: {
        instance_of: '[[UnknownType]]',
        lock: true,
      },
      instanceOf: ['UnknownType'],
      lockIntent: true,
      name: 'Draft',
      path: 'Archive/Draft.md',
    });

    removeOntologyFile(index, 'Archive');
    expect(index.entities.has('Archive/Draft.md')).toBe(false);
    expect(index.issues.some((issue) => issue.file === 'Archive/Draft.md')).toBe(false);
  });

  it('matches frontmatter ignore rules by presence or value', () => {
    expect(isIgnoredByFrontmatter(
      { ontology_ignore: true },
      { frontmatterIgnoreRules: [{ key: 'ontology_ignore' }], typeFolder: '_types' }
    )).toBe(true);

    expect(isIgnoredByFrontmatter(
      { status: ['draft', 'private'] },
      { frontmatterIgnoreRules: [{ key: 'status', value: 'private' }], typeFolder: '_types' }
    )).toBe(true);

    expect(isIgnoredByFrontmatter(
      { status: 'public' },
      { frontmatterIgnoreRules: [{ key: 'status', value: 'private' }], typeFolder: '_types' }
    )).toBe(false);

    expect(isIgnoredByFrontmatter(
      { up: '[[Philosopher]]' },
      { frontmatterIgnoreRules: [{ key: 'up', value: 'Philosopher' }], typeFolder: '_types' }
    )).toBe(true);
  });

  it('validates relation contracts composed through implemented interfaces', () => {
    const index = makeIndex();
    index.types.set('_relations', makeType('_relations', '_types/_relations.md', false, [], {
      relations: new Map([
        ['influenced_by', {
          inverse: 'influenced',
          range: 'Person',
          valueType: 'wikilink',
        }],
        ['influenced', {
          inverse: 'influenced_by',
          range: 'Person',
          valueType: 'wikilink',
        }],
      ]),
      typeKind: 'relation-definitions',
    }));
    index.types.set('Influenceable', makeType('Influenceable', '_types/Influenceable.md', true, [], {
      isInterface: true,
      relations: new Map([
        ['influenced_by', { uses: 'influenced_by' }],
      ]),
    }));
    index.types.set('Philosopher', makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
      implementsTypes: ['Influenceable'],
    }));
    index.entities.set('Spinoza.md', {
      frontmatter: {
        influenced_by: '[[Ada]]',
        instance_of: '[[Philosopher]]',
        lock: true,
      },
      instanceOf: ['Philosopher'],
      lockIntent: true,
      name: 'Spinoza',
      path: 'Spinoza.md',
    });

    recomputeOntologyDerivedState(index);

    expect(index.relationDefinitions.get('influenced_by')?.inverse).toBe('influenced');
    expect(index.issues).toContainEqual(expect.objectContaining({
      autofixable: true,
      file: 'Spinoza.md',
      property: 'influenced_by',
      target: 'Ada',
    }));
  });

  it('never reports circular types as effectively locked', () => {
    const index = makeIndex();
    index.types.set('A', makeType('A', '_types/A.md', true, ['B']));
    index.types.set('B', makeType('B', '_types/B.md', true, ['A']));
    index.entities.set('Cyclic.md', {
      frontmatter: {
        instance_of: '[[A]]',
        lock: true,
      },
      instanceOf: ['A'],
      lockIntent: true,
      name: 'Cyclic',
      path: 'Cyclic.md',
    });

    recomputeOntologyDerivedState(index);

    expect(index.issues.some((issue) => issue.message.startsWith('Circular inheritance detected'))).toBe(true);
    expect(index.circularTypes?.has('A')).toBe(true);
    expect(index.circularTypes?.has('B')).toBe(true);
    expect(index.effectiveTypeLocks.get('A')?.state).toBe('incomplete');
    expect(index.effectiveTypeLocks.get('B')?.state).toBe('incomplete');
    expect(index.effectiveEntityLocks.get('Cyclic.md')?.state).toBe('incomplete');
  });

  it('flags duplicate entity names instead of resolving them arbitrarily', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.relations.set('influenced_by', {
      inverse: 'influenced',
      range: 'Person',
    });
    index.entities.set('people/Smith.md', {
      frontmatter: { instance_of: '[[Person]]' },
      instanceOf: ['Person'],
      lockIntent: false,
      name: 'Smith',
      path: 'people/Smith.md',
    });
    index.entities.set('works/Smith.md', {
      frontmatter: { instance_of: '[[Person]]' },
      instanceOf: ['Person'],
      lockIntent: false,
      name: 'Smith',
      path: 'works/Smith.md',
    });
    index.entities.get('Ada.md')!.frontmatter['influenced_by'] = '[[Smith]]';

    recomputeOntologyDerivedState(index);

    expect(index.ambiguousEntityNames?.has('Smith')).toBe(true);
    expect(index.issues.some((issue) => issue.severity === 'warning' && issue.message.startsWith('Duplicate entity name Smith'))).toBe(true);
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.property === 'influenced_by' && issue.message.includes('ambiguous'))).toBe(true);
    // No range error and no autofixable inverse issue may be raised against an arbitrary Smith.
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.autofixable)).toBe(false);
  });

  it('rejects direct instantiation of interfaces', () => {
    const index = makeIndex();
    index.types.set('Influenceable', makeType('Influenceable', '_types/Influenceable.md', true, [], {
      isInterface: true,
    }));
    index.entities.set('Trait.md', {
      frontmatter: {
        instance_of: '[[Influenceable]]',
      },
      instanceOf: ['Influenceable'],
      lockIntent: false,
      name: 'Trait',
      path: 'Trait.md',
    });

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Trait.md',
      message: 'Cannot instantiate interface Influenceable',
      severity: 'error',
    }));
  });

  it('loads a single JSON schema file as ontology constructors', async () => {
    const schema = JSON.stringify({
      interfaces: {
        Influenceable: {
          lock: true,
          relations: ['influenced_by'],
        },
      },
      relations: {
        influenced_by: {
          inverse: 'influenced',
          range: 'Person',
          'value-type': 'wikilink',
        },
      },
      types: {
        Person: {
          lock: true,
        },
        Philosopher: {
          extends: ['[[Person]]'],
          implements: ['[[Influenceable]]'],
          lock: true,
        },
      },
    });
    const file = {
      extension: 'md',
      path: 'Spinoza.md',
    } as TFile;
    const app = {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            influenced_by: '[[Descartes]]',
            instance_of: '[[Philosopher]]',
            lock: true,
          },
        }),
      },
      vault: {
        adapter: {
          exists: (path: string) => Promise.resolve(path === '_types/ontology.schema.json'),
          read: () => Promise.resolve(schema),
        },
        getMarkdownFiles: () => [file],
      },
    } as unknown as App;

    const index = await buildOntologyIndex(app, {
      schemaPath: '_types/ontology.schema.json',
      typeFolder: '_types',
    });

    expect(index.types.get('Influenceable')?.isInterface).toBe(true);
    expect(index.types.get('Philosopher')?.implements).toEqual(['Influenceable']);
    expect(index.relationDefinitions.get('influenced_by')?.inverse).toBe('influenced');
    expect(index.effectiveEntityLocks.get('Spinoza.md')?.state).toBe('locked');
    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Spinoza.md',
      property: 'influenced_by',
      target: 'Descartes',
    }));
  });
});
