import { describe, expect, it } from 'vitest';

import type { OntologyType } from './types.ts';

import { emptyTypeEditorModel, typeEditorFrontmatter, typeEditorModelFromType } from './type-editor.ts';

describe('type editor frontmatter', () => {
  it('serializes structured type controls', () => {
    const model = emptyTypeEditorModel();
    model.name = 'journal-entry';
    model.lock = true;
    model.extends = ['entry'];
    model.implements = ['dated'];
    model.rules = [
      { kind: 'requires', value: 'person' },
      { kind: 'excludes', value: 'archived' },
      { kind: 'replaces', value: 'draft' },
      { field: 'status', kind: 'replaces', newField: 'state', newValue: 'approved', value: 'proposed' },
    ];
    model.mustHave.push({
      cardinality: 'one',
      excludedTypes: [],
      frontmatterKey: '',
      includedTypes: [],
      insert: 'date.now()',
      name: 'date-start',
      possibleValues: [],
      type: 'date | string',
      uses: '',
    });
    model.canHave.push({
      cardinality: '',
      excludedTypes: [],
      frontmatterKey: '',
      includedTypes: [],
      insert: '',
      name: 'descriptor',
      possibleValues: [],
      type: '',
      uses: 'descriptor',
    });
    model.relations = [{
      autoUpdate: false,
      cardinality: '',
      inverse: '',
      name: 'up',
      range: '',
      symmetric: false,
      transitive: false,
      uses: 'up',
      valueType: '',
    }];
    expect(typeEditorFrontmatter(model)).toEqual({
      lock: true,
      extends: ['[[entry]]'],
      implements: ['[[dated]]'],
      'must-have': {
        'date-start': {
          cardinality: 'one',
          insert: 'date.now()',
          type: 'date | string',
        },
      },
      'can-have': {
        descriptor: { uses: 'descriptor' },
      },
      excludes: ['[[archived]]'],
      replaces: [
        '[[draft]]',
        { field: 'status', 'new-field': 'state', 'new-value': '[[approved]]', value: '[[proposed]]' },
      ],
      requires: ['[[person]]'],
      relations: { up: { uses: 'up' } },
    });
  });

  it('hydrates lock and composition controls from a parsed type', () => {
    const type: OntologyType = {
      abstract: false,
      canHave: new Map(),
      cannotHave: new Set(),
      disjoint: [],
      excludes: ['enemy'],
      extends: [],
      replaces: [
        { value: 'friend' },
        { field: 'relationship', newValue: 'friend', value: 'colleague' },
      ],
      fields: new Map(),
      implementableBy: [],
      implements: [],
      ingestFrom: new Map(),
      isInterface: false,
      lockIntent: true,
      mustHave: new Map(),
      name: 'person',
      path: '_types/person.md',
      relations: new Map(),
      requires: ['person'],
      scales: new Map(),
      values: [],
    };

    expect(typeEditorModelFromType(type)).toMatchObject({
      lock: true,
      extends: [],
      implements: [],
      rules: [
        { kind: 'requires', value: 'person' },
        { kind: 'excludes', value: 'enemy' },
        { kind: 'replaces', value: 'friend' },
        { field: 'relationship', kind: 'replaces', newValue: 'friend', value: 'colleague' },
      ],
    });
  });
});
