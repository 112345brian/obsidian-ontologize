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
      relations: { up: { uses: 'up' } },
    });
  });

  it('hydrates lock and composition controls from a parsed type', () => {
    const type: OntologyType = {
      abstract: false,
      canHave: new Map(),
      cannotHave: new Set(),
      disjoint: [],
      excludes: [],
      extends: [],
      replaces: [],
      fields: new Map(),
      implements: [],
      isInterface: false,
      lockIntent: true,
      mustHave: new Map(),
      name: 'person',
      path: '_types/person.md',
      relations: new Map(),
      requires: [],
      values: [],
    };

    expect(typeEditorModelFromType(type)).toMatchObject({
      lock: true,
      extends: [],
      implements: [],
    });
  });
});
