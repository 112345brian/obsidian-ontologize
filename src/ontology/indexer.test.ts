import { describe, expect, it, vi } from 'vitest';

import type { OntologyIndex, OntologyType } from './types.ts';

vi.mock('obsidian', () => ({
  parseYaml: () => ({}),
}));

import { isIgnoredByFrontmatter, recomputeOntologyDerivedState, removeOntologyFile } from './indexer.ts';

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
    settings: {
      filesToIgnore: [],
      foldersToIgnore: [],
      frontmatterIgnoreRules: [],
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
  });
});
