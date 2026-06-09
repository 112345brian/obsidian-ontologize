import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  parseYaml: (source: string) => {
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
    if (source.includes('abstract: true')) {
      return { abstract: true };
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

  it('uses configured entity type fields for ontology membership', () => {
    const entity = parseOntologyEntity('Ada.md', {
      ontology: ['[[Person]]'],
      type: '[[Ignored]]',
    }, ['ontology']);

    expect(entity?.instanceOf).toEqual(['Person']);
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
      frontmatterKey: undefined,
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
      frontmatterKey: undefined,
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
      frontmatterKey: 'birth_year',
      type: 'number',
      uses: undefined,
      values: undefined,
    });
    expect(type.mustHave.get('born')).toEqual({
      cardinality: undefined,
      frontmatterKey: undefined,
      type: undefined,
      uses: 'birth-year',
      values: undefined,
    });
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
