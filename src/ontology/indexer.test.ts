import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  App,
  TFile
} from 'obsidian';
import type {
  OntologyIndex,
  OntologyType,
  RelationDefinition
} from './types.ts';

vi.mock('obsidian', () => ({
  parseYaml: () => ({})
}));

import {
  buildOntologyIndex,
  isIgnoredByFrontmatter,
  recomputeOntologyDerivedState,
  removeOntologyFile,
  revalidateEntityBatch,
  upsertOntologyFile
} from './indexer.ts';
import { makeIndexSettings } from './test-support.ts';

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
    excludes: [],
    extends: extendsTypes,
    replaces: [],
    requires: [],
    fields: new Map(),
    implements: options.implementsTypes ?? [],
    isInterface: options.isInterface === true,
    lockIntent,
    mustHave: new Map(),
    name,
    path,
    implementableBy: [],
    ingestFrom: new Map(),
    relations: options.relations ?? new Map<string, RelationDefinition>(),
    scales: new Map(),
    typeKind: options.typeKind,
    values: []
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
          'instance-of': '[[Philosopher]]',
          lock: true
        },
        instanceOf: ['Philosopher'],
        lockIntent: true,
        name: 'Ada',
        path: 'Ada.md'
      }]
    ]),
    entitiesByName: new Map(),
    fieldDefinitions: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [],
    relationDefinitions: new Map(),
    scales: new Map(),
    settings: makeIndexSettings({ entityTypeFields: ['instance_of', 'type'] }),
    types: new Map([
      ['Person', makeType('Person', '_types/Person.md', true)],
      ['Philosopher', makeType('Philosopher', '_types/Philosopher.md', true, ['Person'])]
    ])
  };
}

describe('incremental ontology index state', () => {
  it('reports each entity problem once even when declared types share ancestors', () => {
    const index = makeIndex();
    const animal = makeType('Animal', '_types/Animal.md', true);
    animal.mustHave.set('species', { type: 'string' });
    animal.relations.set('parent-of', { inverse: 'child-of', range: 'Animal' });
    index.types.set('Animal', animal);
    index.types.set('Dog', makeType('Dog', '_types/Dog.md', true, ['Animal']));
    index.types.set('Pet', makeType('Pet', '_types/Pet.md', true, ['Animal']));
    index.entities.set('Rex.md', {
      frontmatter: {
        instance_of: ['[[Dog]]', '[[Pet]]'],
        'parent-of': '[[Missing]]'
      },
      instanceOf: ['Dog', 'Pet'],
      lockIntent: false,
      name: 'Rex',
      path: 'Rex.md'
    });

    recomputeOntologyDerivedState(index);

    const missingSpecies = index.issues.filter((issue) => issue.file === 'Rex.md' && issue.message === 'Missing required property species');
    expect(missingSpecies).toHaveLength(1);
    const unknownTarget = index.issues.filter((issue) => issue.file === 'Rex.md' && issue.target === 'Missing');
    expect(unknownTarget).toHaveLength(1);
  });

  it('forbids the aliased frontmatter key when cannot-have names a global field', () => {
    const index = makeIndex();
    index.types.set('_fields', makeType('_fields', '_types/_fields.md', false, [], { typeKind: 'field-definitions' }));
    index.types.get('_fields')!.fields.set('birth-year', { frontmatterKey: 'birth_year', type: 'number' });
    index.types.get('Philosopher')!.cannotHave.add('birth-year');
    index.entities.get('Ada.md')!.frontmatter['birth_year'] = 1815;

    recomputeOntologyDerivedState(index);

    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.message === 'Forbidden property birth_year is present')).toBe(true);
  });

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
        lock: true
      },
      instanceOf: ['UnknownType'],
      lockIntent: true,
      name: 'Draft',
      path: 'Archive/Draft.md'
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
    index.types.set(
      '_relations',
      makeType('_relations', '_types/_relations.md', false, [], {
        relations: new Map([
          ['influenced_by', {
            inverse: 'influenced',
            range: 'Person',
            valueType: 'wikilink'
          }],
          ['influenced', {
            inverse: 'influenced_by',
            range: 'Person',
            valueType: 'wikilink'
          }]
        ]),
        typeKind: 'relation-definitions'
      })
    );
    index.types.set(
      'Influenceable',
      makeType('Influenceable', '_types/Influenceable.md', true, [], {
        isInterface: true,
        relations: new Map([
          ['influenced_by', { uses: 'influenced_by' }]
        ])
      })
    );
    index.types.set(
      'Philosopher',
      makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
        implementsTypes: ['Influenceable']
      })
    );
    index.entities.set('Spinoza.md', {
      frontmatter: {
        influenced_by: '[[Ada]]',
        instance_of: '[[Philosopher]]',
        lock: true
      },
      instanceOf: ['Philosopher'],
      lockIntent: true,
      name: 'Spinoza',
      path: 'Spinoza.md'
    });

    recomputeOntologyDerivedState(index);

    expect(index.relationDefinitions.get('influenced_by')?.inverse).toBe('influenced');
    expect(index.issues).toContainEqual(expect.objectContaining({
      autofixable: true,
      file: 'Spinoza.md',
      property: 'influenced_by',
      target: 'Ada'
    }));
  });

  it('never reports circular types as effectively locked', () => {
    const index = makeIndex();
    index.types.set('A', makeType('A', '_types/A.md', true, ['B']));
    index.types.set('B', makeType('B', '_types/B.md', true, ['A']));
    index.entities.set('Cyclic.md', {
      frontmatter: {
        instance_of: '[[A]]',
        lock: true
      },
      instanceOf: ['A'],
      lockIntent: true,
      name: 'Cyclic',
      path: 'Cyclic.md'
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
      range: 'Person'
    });
    index.entities.set('people/Smith.md', {
      frontmatter: { instance_of: '[[Person]]' },
      instanceOf: ['Person'],
      lockIntent: false,
      name: 'Smith',
      path: 'people/Smith.md'
    });
    index.entities.set('works/Smith.md', {
      frontmatter: { instance_of: '[[Person]]' },
      instanceOf: ['Person'],
      lockIntent: false,
      name: 'Smith',
      path: 'works/Smith.md'
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
    index.types.set(
      'Influenceable',
      makeType('Influenceable', '_types/Influenceable.md', true, [], {
        isInterface: true
      })
    );
    index.entities.set('Trait.md', {
      frontmatter: {
        instance_of: '[[Influenceable]]'
      },
      instanceOf: ['Influenceable'],
      lockIntent: false,
      name: 'Trait',
      path: 'Trait.md'
    });

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Trait.md',
      message: 'Cannot instantiate interface Influenceable',
      severity: 'error'
    }));
  });

  it('validates inline possible property values', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.canHave.set('descriptor', {
      type: 'string',
      values: ['happy', 'sad', 'weird']
    });
    index.entities.get('Ada.md')!.frontmatter['descriptor'] = 'angry';

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Ada.md',
      message: 'descriptor value angry is outside allowed values: happy, sad, weird',
      property: 'descriptor',
      severity: 'error'
    }));
  });

  it('validates required inserted members and included property types', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('up', {
      includedTypes: ['wikilink', 'string'],
      insert: '[[Person]]'
    });
    index.entities.get('Ada.md')!.frontmatter['up'] = '[[Thinker]]';

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Ada.md',
      message: 'up must include [[Person]]',
      property: 'up',
      severity: 'error'
    }));
    expect(index.issues.some((issue) => issue.message.startsWith('up must be'))).toBe(false);

    index.entities.get('Ada.md')!.frontmatter['up'] = ['[[Thinker]]', '[[Person]]'];
    recomputeOntologyDerivedState(index);
    expect(index.issues.some((issue) => issue.property === 'up')).toBe(false);
  });

  it('validates generated inserts by field type without requiring the template literal', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('date-start', {
      insert: 'date.now()',
      type: 'date'
    });
    index.entities.get('Ada.md')!.frontmatter['date-start'] = '2020-01-01';

    recomputeOntologyDerivedState(index);

    expect(index.issues.some((issue) => issue.property === 'date-start')).toBe(false);
  });

  it('warns when values do not match included types', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.canHave.set('reference', {
      includedTypes: ['wikilink', 'string']
    });
    index.entities.get('Ada.md')!.frontmatter['reference'] = 42;

    recomputeOntologyDerivedState(index);
    expect(index.issues).toContainEqual(expect.objectContaining({
      message: 'reference does not match included types: wikilink, string',
      property: 'reference',
      severity: 'warning'
    }));

    index.entities.get('Ada.md')!.frontmatter['reference'] = 'plain text';
    recomputeOntologyDerivedState(index);
    expect(index.issues.some((issue) => issue.property === 'reference')).toBe(false);
  });

  it('accepts strict property type unions when any branch matches', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.canHave.set('reference', {
      type: 'number | string'
    });

    index.entities.get('Ada.md')!.frontmatter['reference'] = 42;
    recomputeOntologyDerivedState(index);
    expect(index.issues.some((issue) => issue.property === 'reference')).toBe(false);

    index.entities.get('Ada.md')!.frontmatter['reference'] = true;
    recomputeOntologyDerivedState(index);
    expect(index.issues).toContainEqual(expect.objectContaining({
      message: 'reference must be number | string',
      property: 'reference',
      severity: 'error'
    }));
  });

  it('accepts relation range unions when the target matches any branch', () => {
    const index = makeIndex();
    index.types.set('Organization', makeType('Organization', '_types/Organization.md', true));
    index.types.get('Philosopher')!.relations.set('member-of', {
      range: 'Person | Organization',
      valueType: 'wikilink'
    });
    index.entities.set('Academy.md', {
      frontmatter: { instance_of: '[[Organization]]' },
      instanceOf: ['Organization'],
      lockIntent: false,
      name: 'Academy',
      path: 'Academy.md'
    });
    index.entities.get('Ada.md')!.frontmatter['member-of'] = '[[Academy]]';

    recomputeOntologyDerivedState(index);
    expect(index.issues.some((issue) => issue.property === 'member-of')).toBe(false);
  });

  it('errors when values match excluded types', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.canHave.set('reference', {
      excludedTypes: ['number', 'boolean']
    });
    index.entities.get('Ada.md')!.frontmatter['reference'] = 42;

    recomputeOntologyDerivedState(index);
    expect(index.issues).toContainEqual(expect.objectContaining({
      message: 'reference matches excluded types: number',
      property: 'reference',
      severity: 'error'
    }));
  });

  it('allows shared global fields and lets required beat optional', () => {
    const index = makeIndex();
    index.types.set(
      '_fields',
      makeType('_fields', '_types/_fields.md', false, [], {
        typeKind: 'field-definitions'
      })
    );
    index.types.get('_fields')!.fields.set('label', { type: 'string' });
    index.types.set(
      'Named',
      makeType('Named', '_types/Named.md', true, [], {
        isInterface: true
      })
    );
    index.types.set(
      'Cataloged',
      makeType('Cataloged', '_types/Cataloged.md', true, [], {
        isInterface: true
      })
    );
    index.types.get('Named')!.canHave.set('label', { uses: 'label' });
    index.types.get('Cataloged')!.mustHave.set('label', { uses: 'label' });
    index.types.set(
      'Philosopher',
      makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
        implementsTypes: ['Named', 'Cataloged']
      })
    );
    index.entities.get('Ada.md')!.frontmatter['label'] = 'Ada';

    recomputeOntologyDerivedState(index);

    expect(index.issues.some((issue) => issue.message.includes('Schema conflict on Philosopher.label'))).toBe(false);
    expect(index.fieldDefinitions.get('label')?.type).toBe('string');
  });

  it('flags local same-key interface fields as semantic schema conflicts', () => {
    const index = makeIndex();
    index.types.set(
      'Named',
      makeType('Named', '_types/Named.md', true, [], {
        isInterface: true
      })
    );
    index.types.set(
      'Cataloged',
      makeType('Cataloged', '_types/Cataloged.md', true, [], {
        isInterface: true
      })
    );
    index.types.get('Named')!.canHave.set('label', { type: 'string' });
    index.types.get('Cataloged')!.canHave.set('label', { type: 'number' });
    index.types.set(
      'Philosopher',
      makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
        implementsTypes: ['Named', 'Cataloged']
      })
    );

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: '_types/Philosopher.md',
      message: 'Schema conflict on Philosopher.label: Named uses semantic field Named.label but Cataloged uses semantic field Cataloged.label',
      property: 'label',
      severity: 'error'
    }));
  });

  it('flags incompatible overrides of the same global field', () => {
    const index = makeIndex();
    index.types.set(
      '_fields',
      makeType('_fields', '_types/_fields.md', false, [], {
        typeKind: 'field-definitions'
      })
    );
    index.types.get('_fields')!.fields.set('label', { type: 'string' });
    index.types.set(
      'Named',
      makeType('Named', '_types/Named.md', true, [], {
        isInterface: true
      })
    );
    index.types.set(
      'Cataloged',
      makeType('Cataloged', '_types/Cataloged.md', true, [], {
        isInterface: true
      })
    );
    index.types.get('Named')!.canHave.set('label', { uses: 'label' });
    index.types.get('Cataloged')!.canHave.set('label', { type: 'number', uses: 'label' });
    index.types.set(
      'Philosopher',
      makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
        implementsTypes: ['Named', 'Cataloged']
      })
    );

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: '_types/Philosopher.md',
      message: 'Schema conflict on Philosopher.label: Named declares can-have (type string) but Cataloged declares can-have (type number)',
      property: 'label',
      severity: 'error'
    }));
  });

  it('validates and scaffolds global fields using frontmatter aliases', () => {
    const index = makeIndex();
    index.types.set(
      '_fields',
      makeType('_fields', '_types/_fields.md', false, [], {
        typeKind: 'field-definitions'
      })
    );
    index.types.get('_fields')!.fields.set('birth-year', {
      frontmatterKey: 'birth_year',
      type: 'number'
    });
    index.types.get('Philosopher')!.mustHave.set('birth-year', { uses: 'birth-year' });
    index.entities.get('Ada.md')!.frontmatter['birth_year'] = '1815';

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Ada.md',
      message: 'birth_year must be number',
      property: 'birth_year',
      severity: 'error'
    }));
  });

  it('does not erase global field constraints with undefined uses overrides', () => {
    const index = makeIndex();
    index.types.set(
      '_fields',
      makeType('_fields', '_types/_fields.md', false, [], {
        typeKind: 'field-definitions'
      })
    );
    index.types.get('_fields')!.fields.set('common-name', {
      frontmatterKey: 'common_name',
      type: 'string'
    });
    index.types.get('Philosopher')!.mustHave.set('common-name', {
      frontmatterKey: undefined,
      type: undefined,
      uses: 'common-name'
    });
    index.entities.get('Ada.md')!.frontmatter['common_name'] = 'Ada';

    recomputeOntologyDerivedState(index);

    expect(index.issues.some((issue) => issue.property === 'common-name' || issue.property === 'common_name')).toBe(false);
  });

  it('flags cannot-have collisions in composed schemas', () => {
    const index = makeIndex();
    index.types.set(
      'Named',
      makeType('Named', '_types/Named.md', true, [], {
        isInterface: true
      })
    );
    index.types.set(
      'Anonymous',
      makeType('Anonymous', '_types/Anonymous.md', true, [], {
        isInterface: true
      })
    );
    index.types.get('Named')!.mustHave.set('label', { type: 'string' });
    index.types.get('Anonymous')!.cannotHave.add('label');
    index.types.set(
      'Philosopher',
      makeType('Philosopher', '_types/Philosopher.md', true, ['Person'], {
        implementsTypes: ['Named', 'Anonymous']
      })
    );

    recomputeOntologyDerivedState(index);

    expect(index.issues).toContainEqual(expect.objectContaining({
      file: '_types/Philosopher.md',
      message: 'Schema conflict on Philosopher.label: Anonymous declares cannot-have but Named declares must-have',
      property: 'label',
      severity: 'error'
    }));
  });

  it('loads a single JSON schema file as ontology constructors', async () => {
    const schema = JSON.stringify({
      interfaces: {
        Influenceable: {
          lock: true,
          relations: ['influenced_by']
        }
      },
      relations: {
        influenced_by: {
          inverse: 'influenced',
          range: 'Person',
          'value-type': 'wikilink'
        }
      },
      types: {
        Person: {
          lock: true
        },
        Philosopher: {
          extends: ['[[Person]]'],
          implements: ['[[Influenceable]]'],
          lock: true
        }
      }
    });
    const file = {
      extension: 'md',
      path: 'Spinoza.md'
    } as TFile;
    const app = {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            influenced_by: '[[Descartes]]',
            instance_of: '[[Philosopher]]',
            lock: true
          }
        })
      },
      vault: {
        adapter: {
          exists: (path: string) => Promise.resolve(path === '_types/ontology.schema.json'),
          read: () => Promise.resolve(schema)
        },
        getMarkdownFiles: () => [file]
      }
    } as unknown as App;

    const index = await buildOntologyIndex(app, {
      entityTypeFields: ['instance_of', 'type'],
      schemaPath: '_types/ontology.schema.json',
      typeFolder: '_types'
    });

    expect(index.types.get('Influenceable')?.isInterface).toBe(true);
    expect(index.types.get('Philosopher')?.implements).toEqual(['Influenceable']);
    expect(index.relationDefinitions.get('influenced-by')?.inverse).toBe('influenced');
    expect(index.effectiveEntityLocks.get('Spinoza.md')?.state).toBe('locked');
    expect(index.issues).toContainEqual(expect.objectContaining({
      file: 'Spinoza.md',
      property: 'influenced-by',
      target: 'Descartes'
    }));
  });

  it('persists schema lint errors and blocks malformed schema constructors', async () => {
    const app = {
      vault: {
        adapter: {
          exists: () => Promise.resolve(true),
          read: () =>
            Promise.resolve(JSON.stringify({
              types: []
            }))
        },
        getMarkdownFiles: () => []
      }
    } as unknown as App;

    const index = await buildOntologyIndex(app, {
      schemaPath: '_types/ontology.schema.json',
      typeFolder: '_types'
    });

    expect(index.types.size).toBe(0);
    expect(index.schemaIssues).toContainEqual(expect.objectContaining({
      file: '_types/ontology.schema.json',
      message: 'types must be a map of named definitions',
      severity: 'error'
    }));
    expect(index.issues).toContainEqual(expect.objectContaining({
      message: 'types must be a map of named definitions'
    }));

    recomputeOntologyDerivedState(index);
    expect(index.issues).toContainEqual(expect.objectContaining({
      message: 'types must be a map of named definitions'
    }));
  });

  it('background sweep clears stale validation issues without a full rebuild', () => {
    // Ada has `influenced_by: [[Leibniz]]`. Leibniz is missing the inverse
    // `influenced: [[Ada]]`, so an autofixable issue is raised against Ada.
    // A live event later writes the inverse to Leibniz and updates the in-memory
    // index. The sweep should re-validate Ada and clear the now-stale issue.
    const index = makeIndex();
    const philType = index.types.get('Philosopher')!;
    philType.relations.set('influenced-by', { autoUpdate: true, inverse: 'influenced', range: 'Person' });
    index.entities.set('Leibniz.md', {
      frontmatter: { instance_of: '[[Philosopher]]' }, // no inverse yet
      instanceOf: ['Philosopher'],
      lockIntent: true,
      name: 'Leibniz',
      path: 'Leibniz.md'
    });
    index.entities.get('Ada.md')!.frontmatter['influenced-by'] = ['[[Leibniz]]'];

    recomputeOntologyDerivedState(index);

    // Sanity: Ada should have a missing-inverse issue against Leibniz.
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.autofixable && issue.target === 'Leibniz')).toBe(true);

    // Simulate the live event that wrote the inverse onto Leibniz — update the
    // in-memory entity to include it.
    index.entities.get('Leibniz.md')!.frontmatter['influenced'] = ['[[Ada]]'];

    // metadataCache reflects the already-updated in-memory state.
    const app = {
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: index.entities.get(file.path)?.frontmatter ?? {}
        })
      },
      vault: {
        getAbstractFileByPath: (path: string) => {
          if (index.entities.has(path)) {
            return { extension: 'md', path } as TFile;
          }
          return null;
        }
      }
    } as unknown as App;

    const result = revalidateEntityBatch(app, index, ['Ada.md']);

    expect(result.staleCount).toBe(0); // Ada's own frontmatter didn't change
    expect(result.removedCount).toBe(0);
    // The issue on Ada should have been cleared: Leibniz now has the inverse.
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.autofixable && issue.target === 'Leibniz')).toBe(false);
  });

  it('background sweep detects frontmatter drift and updates stale records', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('school', { type: 'string' });
    recomputeOntologyDerivedState(index);
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.property === 'school')).toBe(true);

    // metadataCache now reflects that Ada has the property filled in.
    const freshFm = { ...index.entities.get('Ada.md')!.frontmatter, school: 'Empiricism' };
    const app = {
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: file.path === 'Ada.md' ? freshFm : index.entities.get(file.path)?.frontmatter ?? {}
        })
      },
      vault: {
        getAbstractFileByPath: (path: string) => {
          if (index.entities.has(path)) {
            return { extension: 'md', path } as TFile;
          }
          return null;
        }
      }
    } as unknown as App;

    const result = revalidateEntityBatch(app, index, ['Ada.md']);

    expect(result.staleCount).toBe(1);
    expect(index.entities.get('Ada.md')!.frontmatter['school']).toBe('Empiricism');
    expect(index.issues.some((issue) => issue.file === 'Ada.md' && issue.property === 'school')).toBe(false);
  });

  it('background sweep removes entities whose files were silently deleted', () => {
    const index = makeIndex();
    recomputeOntologyDerivedState(index);

    const app = {
      metadataCache: { getFileCache: () => null },
      vault: { getAbstractFileByPath: () => null }
    } as unknown as App;

    expect(index.entities.has('Ada.md')).toBe(true);
    const result = revalidateEntityBatch(app, index, ['Ada.md']);

    expect(result.removedCount).toBe(1);
    expect(index.entities.has('Ada.md')).toBe(false);
  });

  it('uses configured entity type frontmatter fields', async () => {
    const file = {
      extension: 'md',
      path: 'Ada.md'
    } as TFile;
    const app = {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            ontology: '[[Person]]'
          }
        })
      },
      vault: {
        adapter: {
          exists: () => Promise.resolve(false)
        },
        getMarkdownFiles: () => [file],
        read: () => Promise.resolve('lock: true')
      }
    } as unknown as App;

    const index = await buildOntologyIndex(app, {
      entityTypeFields: ['ontology'],
      typeFolder: '_types'
    });
    index.types.set('Person', makeType('Person', '_types/Person.md', true));
    recomputeOntologyDerivedState(index);

    expect(index.entities.get('Ada.md')?.instanceOf).toEqual(['Person']);
    expect(index.settings.entityTypeFields).toEqual(['ontology']);
  });

  it('indexes ontologize-marked type notes outside the configured type folder', async () => {
    const typeFile = { extension: 'md', path: 'Concepts/philosopher.md', basename: 'philosopher' } as TFile;
    const entityFile = { extension: 'md', path: 'Notes/Marx.md', basename: 'Marx' } as TFile;
    const frontmatterByPath = new Map<string, Record<string, unknown>>([
      ['Concepts/philosopher.md', { ontologize: true, up: '[[person]]', lock: true }],
      ['Notes/Marx.md', { 'is-instance': '[[philosopher]]', up: '[[philosopher]]' }]
    ]);
    const sourceByPath = new Map<string, string>([
      ['Concepts/philosopher.md', '{"ontologize":true,"up":"[[person]]","lock":true}'],
      ['Notes/Marx.md', '']
    ]);
    const app = {
      metadataCache: {
        getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath.get(file.path) ?? {} })
      },
      vault: {
        adapter: {
          exists: () => Promise.resolve(false)
        },
        getMarkdownFiles: () => [typeFile, entityFile],
        read: (file: TFile) => Promise.resolve(sourceByPath.get(file.path) ?? '')
      }
    } as unknown as App;

    const index = await buildOntologyIndex(app, { typeFolder: '_types' });

    expect(index.types.get('philosopher')?.path).toBe('Concepts/philosopher.md');
    expect(index.entities.get('Notes/Marx.md')?.instanceOf).toEqual(['philosopher']);
  });

  it('incrementally upserts ontologize-marked type notes outside the configured type folder', async () => {
    const file = { extension: 'md', path: 'Concepts/philosopher.md', basename: 'philosopher' } as TFile;
    const index = recomputeOntologyDerivedState(makeIndex());
    const app = {
      metadataCache: {
        getFileCache: () => ({ frontmatter: { ontologize: true, up: '[[person]]', lock: true } })
      },
      vault: {
        read: () => Promise.resolve('{"ontologize":true,"up":"[[person]]","lock":true}')
      }
    } as unknown as App;

    const updated = await upsertOntologyFile(app, index, file, { typeFolder: '_types' });

    expect(updated.types.get('philosopher')?.path).toBe('Concepts/philosopher.md');
    expect(updated.entities.has('Concepts/philosopher.md')).toBe(false);
  });
});
