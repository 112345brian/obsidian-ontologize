import { describe, expect, it, vi } from 'vitest';

import type { OntologyIndex, OntologyType } from './types.ts';

vi.mock('obsidian', () => ({
  parseYaml: () => ({}),
}));

import { recomputeOntologyDerivedState, removeOntologyFile } from './indexer.ts';

function makeType(name: string, path: string, lockIntent: boolean, extendsTypes: string[] = []): OntologyType {
  return {
    abstract: false,
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    extends: extendsTypes,
    lockIntent,
    mustHave: new Map(),
    name,
    path,
    relations: new Map(),
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
    settings: { typeFolder: '_types' },
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
});
