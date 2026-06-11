import { describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';
import type { OntologyIndex, OntologyType } from './types.ts';

vi.mock('obsidian', () => ({
  Notice: vi.fn(),
}));

import { applyScaffoldPlan, planMissingInverses, planScaffoldEntity } from './mutations.ts';

function makeType(): OntologyType {
  return {
    abstract: false,
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    extends: [],
    fields: new Map(),
    implements: [],
    isInterface: false,
    lockIntent: true,
    mustHave: new Map(),
    name: 'Philosopher',
    path: '_types/Philosopher.md',
    relations: new Map([
      ['influenced', {
        autoUpdate: true,
        inverse: 'influenced_by',
        range: 'Philosopher',
      }],
    ]),
    values: [],
  };
}

function makeInterfaceRelationIndex(): OntologyIndex {
  const index = makeIndex();
  index.types.set('_relations', {
    abstract: false,
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    extends: [],
    fields: new Map(),
    implements: [],
    isInterface: false,
    lockIntent: false,
    mustHave: new Map(),
    name: '_relations',
    path: '_types/_relations.md',
    relations: new Map([
      ['influenced_by', {
        inverse: 'influenced',
        range: 'Philosopher',
        valueType: 'wikilink',
      }],
    ]),
    typeKind: 'relation-definitions',
    values: [],
  });
  index.types.set('Influenceable', {
    abstract: false,
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    extends: [],
    fields: new Map(),
    implements: [],
    isInterface: true,
    lockIntent: true,
    mustHave: new Map(),
    name: 'Influenceable',
    path: '_types/Influenceable.md',
    relations: new Map([
      ['influenced_by', { uses: 'influenced_by' }],
    ]),
    values: [],
  });
  index.relationDefinitions.set('influenced_by', {
    inverse: 'influenced',
    range: 'Philosopher',
    valueType: 'wikilink',
  });
  index.types.set('Philosopher', {
    ...makeType(),
    implements: ['Influenceable'],
  });
  index.issues[0] = {
    autoUpdate: false,
    autofixable: true,
    file: 'Spinoza.md',
    message: 'Missing inverse relation influenced on Leibniz.',
    property: 'influenced_by',
    severity: 'warning',
    target: 'Leibniz',
  };
  index.entities.get('Spinoza.md')!.frontmatter = {
    influenced_by: ['[[Leibniz]]'],
    instance_of: '[[Philosopher]]',
  };
  return index;
}

function makeIndex(): OntologyIndex {
  const source = {
    frontmatter: {
      influenced: ['[[Leibniz]]'],
      instance_of: '[[Philosopher]]',
    },
    instanceOf: ['Philosopher'],
    lockIntent: true,
    name: 'Spinoza',
    path: 'Spinoza.md',
  };
  const target = {
    frontmatter: {
      instance_of: '[[Philosopher]]',
    },
    instanceOf: ['Philosopher'],
    lockIntent: true,
    name: 'Leibniz',
    path: 'Leibniz.md',
  };

  return {
    ancestorsByType: new Map([
      ['Philosopher', new Set()],
    ]),
    cacheVersion: 1,
    effectiveEntityLocks: new Map(),
    effectiveTypeLocks: new Map(),
    entities: new Map([
      [source.path, source],
      [target.path, target],
    ]),
    entitiesByName: new Map([
      [source.name, source],
      [target.name, target],
    ]),
    fieldDefinitions: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [
      {
        autoUpdate: true,
        autofixable: true,
        file: source.path,
        message: 'Missing inverse relation influenced_by on Leibniz.',
        property: 'influenced',
        severity: 'warning',
        target: target.name,
      },
    ],
    relationDefinitions: new Map(),
    settings: {
      entityTypeFields: ['instance_of', 'type'],
      filesToIgnore: [],
      foldersToIgnore: [],
      frontmatterIgnoreRules: [],
      schemaPath: '',
      typeFolder: '_types',
    },
    types: new Map([
      ['Philosopher', makeType()],
    ]),
  };
}

describe('ontology frontmatter mutations', () => {
  it('plans missing inverse relation frontmatter changes without writing', () => {
    expect(planMissingInverses(makeIndex())).toEqual([
      {
        autoUpdate: true,
        inverseProperty: 'influenced_by',
        message: 'Missing inverse relation influenced_by on Leibniz.',
        sourceName: 'Spinoza',
        sourcePath: 'Spinoza.md',
        sourceProperty: 'influenced',
        targetName: 'Leibniz',
        targetPath: 'Leibniz.md',
        value: '[[Spinoza]]',
      },
    ]);
  });

  it('can limit plans to auto-update relation issues', () => {
    const index = makeIndex();
    index.issues[0]!.autoUpdate = false;
    expect(planMissingInverses(index, { onlyAutoUpdate: true })).toEqual([]);
  });

  it('plans fixes for relations inherited from implemented interfaces', () => {
    expect(planMissingInverses(makeInterfaceRelationIndex())).toEqual([
      expect.objectContaining({
        inverseProperty: 'influenced',
        sourceProperty: 'influenced_by',
        value: '[[Spinoza]]',
      }),
    ]);
  });

  it('skips plans whose target name is ambiguous across multiple notes', () => {
    const index = makeIndex();
    index.ambiguousEntityNames = new Set(['Leibniz']);
    expect(planMissingInverses(index)).toEqual([]);
  });

  it('resolves the inverse from the most derived type, matching validation', () => {
    const index = makeIndex();
    const parent = makeType();
    parent.name = 'Person';
    parent.path = '_types/Person.md';
    parent.relations = new Map([
      ['influenced', {
        inverse: 'known_by',
        range: 'Person',
      }],
    ]);
    index.types.set('Person', parent);
    index.ancestorsByType.set('Philosopher', new Set(['Person']));
    index.ancestorsByType.set('Person', new Set());

    // Philosopher (the entity's direct type) overrides the inverse; the fix must
    // write the property validation reported, not the ancestor's.
    expect(planMissingInverses(index)).toEqual([
      expect.objectContaining({
        inverseProperty: 'influenced_by',
        sourceProperty: 'influenced',
      }),
    ]);
  });

  it('scaffolds inherited properties and relation fields', async () => {
    const index = makeIndex();
    const philosopher = index.types.get('Philosopher')!;
    philosopher.mustHave.set('school', { type: 'string' });
    philosopher.canHave.set('birth_year', { type: 'number' });
    index.entities.get('Spinoza.md')!.frontmatter = {
      birth_year: 1632,
      instance_of: '[[Philosopher]]',
    };
    const frontmatter = { ...index.entities.get('Spinoza.md')!.frontmatter };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    const added = await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, planScaffoldEntity(index, 'Spinoza.md'));

    expect(added).toBe(2);
    expect(frontmatter).toEqual({
      birth_year: 1632,
      influenced: null,
      instance_of: '[[Philosopher]]',
      school: null,
    });
  });

  it('plans scaffold fields before writing frontmatter', () => {
    const index = makeIndex();
    const philosopher = index.types.get('Philosopher')!;
    philosopher.mustHave.set('school', { type: 'string' });
    philosopher.canHave.set('birth_year', { type: 'number' });
    index.entities.get('Spinoza.md')!.frontmatter = {
      birth_year: 1632,
      instance_of: '[[Philosopher]]',
    };

    expect(planScaffoldEntity(index, 'Spinoza.md')).toEqual([
      { kind: 'required', property: 'school' },
      { kind: 'relation', property: 'influenced' },
    ]);
  });

  it('inserts required values without overwriting existing frontmatter', async () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('up', {
      acceptedTypes: ['wikilink', 'string'],
      insert: '[[Person]]',
    });
    index.entities.get('Spinoza.md')!.frontmatter = {
      instance_of: '[[Philosopher]]',
      up: '[[Thinker]]',
    };
    const frontmatter = { ...index.entities.get('Spinoza.md')!.frontmatter };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    const plans = planScaffoldEntity(index, 'Spinoza.md');
    expect(plans).toContainEqual({ kind: 'required', property: 'up', insert: '[[Person]]' });

    await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, plans);
    expect(frontmatter['up']).toEqual(['[[Thinker]]', '[[Person]]']);
  });
});
