import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  parseYaml: (source: string) => {
    if (source.includes('wikilink|string')) {
      return {
        'must-have': {
          up: {
            type: 'wikilink|string',
          },
        },
      };
    }
    if (source.includes('insert:') && source.includes('up:')) {
      return {
        'must-have': {
          up: {
            'excluded-types': ['number'],
            'included-types': ['wikilink', 'string'],
            insert: '[[Person]]',
          },
        },
      };
    }
    if (source.includes('possible-values:')) {
      return {
        'can-have': {
          descriptor: {
            'possible-values': ['happy', 'sad', 'weird'],
            type: 'string',
          },
        },
      };
    }
    if (source.includes('values:') && source.includes('descriptor:')) {
      return {
        'can-have': {
          descriptor: {
            type: 'string',
            values: ['happy', 'sad', 'weird'],
          },
        },
      };
    }
    if (source.includes('fields:') && source.includes('birth-year:')) {
      return {
        fields: {
          'birth-year': {
            cardinality: 'one',
            'frontmatter-key': 'birth_year',
            type: 'number',
          },
        },
        'must-have': {
          born: {
            uses: 'birth-year',
          },
        },
        type: 'field-definitions',
      };
    }
    if (source.includes('new-value:')) {
      return {
        replaces: [{
          field: 'relationship',
          'new-field': 'connection',
          'new-value': '[[Friend]]',
          value: '[[Colleague]]',
        }],
      };
    }
    if (source.includes('abstract: true')) {
      return { abstract: true };
    }
    if (source.includes('ontologize.must-have')) {
      return {
        'must-have': {
          'note-owned-field': 'string',
        },
        'ontologize.extends': ['[[person]]'],
        'ontologize.must-have': {
          school: {
            type: 'string',
          },
        },
        ontologize: true,
      };
    }
    if (source.includes('extends:')) {
      return {
        extends: ['[[Person]]'],
        lock: true,
      };
    }
    return {};
  },
}));

import { parseOntologyEntity, parseOntologySchema, parseOntologyType } from './parser.ts';

describe('ontology type parser', () => {
  it('uses frontmatter as the type definition when frontmatter is present', () => {
    const type = parseOntologyType('_types/Philosopher.md', `---
abstract: true
---

# Philosopher
extends:
  - [[Person]]
lock: true
`);

    expect(type.abstract).toBe(true);
    expect(type.extends).toEqual([]);
    expect(type.lockIntent).toBe(false);
  });

  it('uses body YAML when frontmatter is absent', () => {
    const type = parseOntologyType('_types/Philosopher.md', `# Philosopher
extends:
  - [[Person]]
lock: true
`);

    expect(type.extends).toEqual(['Person']);
    expect(type.lockIntent).toBe(true);
  });

  it('can require schema keys to use the ontologize prefix', () => {
    const type = parseOntologyType('_types/Philosopher.md', `---
ontologize: true
must-have:
  note-owned-field: string
ontologize.extends:
  - "[[person]]"
ontologize.must-have:
  school:
    type: string
---`, undefined, true);

    expect(type.extends).toEqual(['person']);
    expect([...type.mustHave.keys()]).toEqual(['school']);
  });

  it('uses configured entity type fields for ontology membership', () => {
    const entity = parseOntologyEntity('Ada.md', {
      ontology: ['[[Person]]'],
      type: '[[Ignored]]',
    }, ['ontology']);

    expect(entity?.instanceOf).toEqual(['Person']);
  });

  it('parses from/to replacement rules', () => {
    const type = parseOntologyType('_types/Friend.md', `---
replaces:
  - field: relationship
    value: "[[Colleague]]"
    new-field: connection
    new-value: "[[Friend]]"
---`);

    expect(type.replaces).toEqual([{
      field: 'relationship',
      newField: 'connection',
      newValue: 'Friend',
      value: 'Colleague',
    }]);
  });

  it('parses possible-values as property allowed values', () => {
    const type = parseOntologyType('_types/Mood.md', `---
can-have:
  descriptor:
    type: string
    possible-values:
      - happy
      - sad
      - weird
---`);

    expect(type.canHave.get('descriptor')).toEqual({
      cardinality: undefined,
      excludedTypes: undefined,
      frontmatterKey: undefined,
      includedTypes: undefined,
      insert: undefined,
      type: 'string',
      uses: undefined,
      values: ['happy', 'sad', 'weird'],
    });
  });

  it('does not treat property values as a possible-values alias', () => {
    const type = parseOntologyType('_types/Mood.md', `---
can-have:
  descriptor:
    type: string
    values:
      - happy
      - sad
      - weird
---`);

    expect(type.canHave.get('descriptor')).toEqual({
      cardinality: undefined,
      excludedTypes: undefined,
      frontmatterKey: undefined,
      includedTypes: undefined,
      insert: undefined,
      type: 'string',
      uses: undefined,
      values: undefined,
    });
  });

  it('parses global fields and property uses', () => {
    const type = parseOntologyType('_types/_fields.md', `---
type: field-definitions
fields:
  birth-year:
    type: number
    cardinality: one
    frontmatter-key: birth_year
must-have:
  born:
    uses: birth-year
---`);

    expect(type.fields.get('birth-year')).toEqual({
      cardinality: 'one',
      excludedTypes: undefined,
      frontmatterKey: 'birth_year',
      includedTypes: undefined,
      insert: undefined,
      type: 'number',
      uses: undefined,
      values: undefined,
    });
    expect(type.mustHave.get('born')).toEqual({
      cardinality: undefined,
      excludedTypes: undefined,
      frontmatterKey: undefined,
      includedTypes: undefined,
      insert: undefined,
      type: undefined,
      uses: 'birth-year',
      values: undefined,
    });
  });

  it('parses inserted values and included/excluded property types', () => {
    const type = parseOntologyType('_types/Philosopher.md', `---
must-have:
  up:
    insert: "[[Person]]"
    included-types:
      - wikilink
      - string
    excluded-types:
      - number
---`);

    expect(type.mustHave.get('up')).toEqual({
      cardinality: undefined,
      excludedTypes: ['number'],
      frontmatterKey: undefined,
      includedTypes: ['wikilink', 'string'],
      insert: '[[Person]]',
      type: undefined,
      uses: undefined,
      values: undefined,
    });
  });

  it('normalizes property type unions', () => {
    const type = parseOntologyType('_types/Linked.md', `---
must-have:
  up:
    type: wikilink|string
---`);

    expect(type.mustHave.get('up')?.type).toBe('wikilink | string');
  });

  it('parses top-level schema fields as a field registry', () => {
    const types = parseOntologySchema('_types/ontology.schema.json', JSON.stringify({
      fields: {
        'birth-year': {
          type: 'number',
        },
      },
    }));

    expect(types[0]?.typeKind).toBe('field-definitions');
    expect(types[0]?.fields.get('birth-year')?.type).toBe('number');
  });
});
