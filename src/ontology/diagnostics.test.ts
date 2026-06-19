import { describe, expect, it } from 'vitest';

import type { OntologyIndex, OntologyType } from './types.ts';

import { buildSchemaDiagnostics, isSchemaIssue } from './diagnostics.ts';
import { makeIndexSettings, makeOntologyType } from './test-support.ts';

function makeType(name: string, path = `_types/${name}.md`): OntologyType {
  return makeOntologyType({ lockIntent: true, name, path });
}

function makeIndex(): OntologyIndex {
  return {
    ancestorsByType: new Map(),
    cacheVersion: 1,
    circularTypes: new Set(['Loop']),
    effectiveEntityLocks: new Map(),
    effectiveTypeLocks: new Map(),
    entities: new Map(),
    entitiesByName: new Map(),
    fieldDefinitions: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [
      { file: '_types/Person.md', message: 'Unknown parent type Agent', severity: 'error' },
      { file: 'Notes/Spinoza.md', message: 'Missing required property school', severity: 'error' },
    ],
    relationDefinitions: new Map([
      ['influenced_by', { inverse: 'influenced' }],
    ]),
    scales: new Map(),
    settings: makeIndexSettings({
      entityTypeFields: ['instance_of'],
      schemaPath: '_types/ontology.schema.yaml',
    }),
    types: new Map([
      ['Person', makeType('Person')],
      ['Thinker', { ...makeType('Thinker'), isInterface: true }],
      ['AbstractThing', { ...makeType('AbstractThing'), abstract: true }],
    ]),
  };
}

describe('schema diagnostics', () => {
  it('filters schema issues separately from entity validation issues', () => {
    const index = makeIndex();

    expect(isSchemaIssue(index, index.issues[0]!)).toBe(true);
    expect(isSchemaIssue(index, index.issues[1]!)).toBe(false);
  });

  it('summarizes schema shape and schema issues', () => {
    expect(buildSchemaDiagnostics(makeIndex())).toEqual({
      abstractTypes: 1,
      concreteTypes: 1,
      circularTypes: ['Loop'],
      fieldDefinitions: 0,
      interfaces: 1,
      issues: [
        { file: '_types/Person.md', message: 'Unknown parent type Agent', severity: 'error' },
      ],
      relationDefinitions: 1,
      typeFiles: 3,
    });
  });
});
