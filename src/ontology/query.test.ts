import { describe, expect, it } from 'vitest';

import type { OntologyIndex, OntologyType } from './types.ts';

import { runOntologyQuery, runOntologyQueryDetailed } from './query.ts';
import { makeIndexSettings, makeOntologyType } from './test-support.ts';

function makeType(name: string, implementsTypes: string[] = []): OntologyType {
  return makeOntologyType({ implements: implementsTypes, lockIntent: true, name });
}

function makeIndex(): OntologyIndex {
  return {
    ancestorsByType: new Map([
      ['Philosopher', new Set(['Person'])],
      ['Rationalist', new Set(['Philosopher', 'Person'])],
      ['Person', new Set()],
    ]),
    cacheVersion: 1,
    effectiveEntityLocks: new Map([
      ['Ada.md', { state: 'locked' }],
      ['Spinoza.md', { state: 'locked' }],
      ['Draft.md', { state: 'incomplete' }],
    ]),
    effectiveTypeLocks: new Map(),
    entities: new Map([
      ['Ada.md', {
        frontmatter: {
          influenced: ['NOT [[Nietzsche]]'],
          instance_of: '[[Person]]',
          lock: true,
        },
        instanceOf: ['Person'],
        lockIntent: true,
        name: 'Ada',
        path: 'Ada.md',
      }],
      ['Spinoza.md', {
        frontmatter: {
          influenced_by: ['[[Descartes]]'],
          instance_of: '[[Rationalist]]',
          lock: true,
        },
        instanceOf: ['Rationalist'],
        lockIntent: true,
        name: 'Spinoza',
        path: 'Spinoza.md',
      }],
      ['Draft.md', {
        frontmatter: {
          instance_of: '[[Philosopher]]',
          lock: true,
        },
        instanceOf: ['Philosopher'],
        lockIntent: true,
        name: 'Draft',
        path: 'Draft.md',
      }],
    ]),
    entitiesByName: new Map(),
    fieldDefinitions: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [],
    relationDefinitions: new Map(),
    settings: makeIndexSettings({ entityTypeFields: ['instance_of', 'type'] }),
    types: new Map([
      ['Person', makeType('Person')],
      ['Philosopher', makeType('Philosopher')],
      ['Rationalist', makeType('Rationalist', ['Influenceable'])],
      ['Influenceable', {
        ...makeType('Influenceable'),
        isInterface: true,
      }],
    ]),
  };
}

describe('runOntologyQuery', () => {
  it('matches inherited type chains for locked entities by default', () => {
    const results = runOntologyQuery(makeIndex(), 'type: Person');
    expect(results.map((entity) => entity.name)).toEqual(['Ada', 'Spinoza']);
  });

  it('supports relation filters and include widening', () => {
    const relationResults = runOntologyQuery(makeIndex(), 'type: Philosopher AND influenced_by: [[Descartes]]');
    expect(relationResults.map((entity) => entity.name)).toEqual(['Spinoza']);

    const widenedResults = runOntologyQuery(makeIndex(), 'type: Philosopher AND include: incomplete');
    expect(widenedResults.map((entity) => entity.name)).toEqual(['Draft', 'Spinoza']);
  });

  it('treats configured entity membership fields as inheritance-aware type predicates', () => {
    const index = makeIndex();
    index.settings.entityTypeFields = ['is'];

    const results = runOntologyQuery(index, 'is: Person');
    expect(results.map((entity) => entity.name)).toEqual(['Ada', 'Spinoza']);
  });

  it('honors the configured default include mode while explicit include still wins', () => {
    const allByDefault = runOntologyQuery(makeIndex(), 'type: Philosopher', { defaultInclude: 'all' });
    expect(allByDefault.map((entity) => entity.name)).toEqual(['Draft', 'Spinoza']);

    const explicitOverride = runOntologyQuery(makeIndex(), 'type: Philosopher AND include: locked', { defaultInclude: 'all' });
    expect(explicitOverride.map((entity) => entity.name)).toEqual(['Spinoza']);
  });

  it('matches implemented interfaces in type predicates', () => {
    const results = runOntologyQuery(makeIndex(), 'type: Influenceable');
    expect(results.map((entity) => entity.name)).toEqual(['Spinoza']);
  });

  it('supports OR groups and explicit negated relation facts', () => {
    const orResults = runOntologyQuery(makeIndex(), '(type: Rationalist OR type: Person) AND NOT influenced_by: [[Kant]]');
    expect(orResults.map((entity) => entity.name)).toEqual(['Ada', 'Spinoza']);

    const negatedRelationResults = runOntologyQuery(makeIndex(), 'type: Person AND NOT influenced: [[Nietzsche]]');
    expect(negatedRelationResults.map((entity) => entity.name)).toEqual(['Ada', 'Spinoza']);
  });

  it('warns when query content cannot be parsed instead of silently ignoring it', () => {
    const bareWord = runOntologyQueryDetailed(makeIndex(), 'Philosopher');
    expect(bareWord.warnings).toEqual([
      'Ignored query content starting at "Philosopher": clauses must look like "key: value".',
    ]);

    const trailingGarbage = runOntologyQueryDetailed(makeIndex(), 'type: Person stray-token');
    expect(trailingGarbage.warnings).toHaveLength(1);
    expect(trailingGarbage.warnings[0]).toContain('stray-token');
    // The valid prefix still evaluates.
    expect(trailingGarbage.entities.map((entity) => entity.name)).toEqual(['Ada', 'Spinoza']);
  });

  it('reports no warnings for well-formed queries', () => {
    const result = runOntologyQueryDetailed(makeIndex(), '(type: Rationalist OR type: Person) AND NOT influenced_by: [[Kant]] AND include: all');
    expect(result.warnings).toEqual([]);
  });
});
