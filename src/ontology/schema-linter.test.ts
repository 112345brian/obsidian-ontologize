import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  parseYaml: (source: string) => {
    if (source.includes('BROKEN')) {
      throw new Error('bad indentation');
    }
    if (source.includes('unknown-template')) {
      return {
        'must-have': {
          started: {
            insert: 'clock.unknown()',
            type: ['date'],
          },
        },
        mystery: true,
      };
    }
    if (source.includes('underscore-names')) {
      return {
        fields: {
          birth_year: {
            'frontmatter-key': 'birth_year',
            type: 'number',
          },
        },
        relations: {
          influenced_by: {
            inverse: 'influences_person',
          },
        },
      };
    }
    if (source.includes('bad-union')) {
      return {
        'must-have': {
          up: {
            type: 'wikilink |',
          },
        },
      };
    }
    return {
      'must-have': {
        started: {
          insert: 'date.now()',
          type: 'date',
        },
      },
    };
  },
}));

import { lintOntologySchemaSource, lintOntologyTypeSource } from './schema-linter.ts';

describe('schema linter', () => {
  it('reports malformed YAML and missing frontmatter delimiters', () => {
    expect(lintOntologyTypeSource('_types/Broken.md', '---\nBROKEN\n---')).toContainEqual(expect.objectContaining({
      file: '_types/Broken.md',
      message: 'Schema syntax error: bad indentation',
      severity: 'error',
    }));
    expect(lintOntologyTypeSource('_types/Open.md', '---\nlock: true')).toContainEqual(expect.objectContaining({
      message: 'YAML frontmatter is missing its closing --- delimiter',
    }));
  });

  it('reports unknown keys, invalid strict type shapes, and unknown templates', () => {
    const issues = lintOntologyTypeSource('_types/Bad.md', '---\nunknown-template\n---');

    expect(issues).toContainEqual(expect.objectContaining({
      message: 'Unknown type field mystery',
      severity: 'warning',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      message: 'Property started.type must be one string',
      severity: 'error',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      message: 'Property started.insert uses unknown template clock.unknown()',
      severity: 'error',
    }));
  });

  it('accepts registered templates and validates JSON schema roots', () => {
    expect(lintOntologyTypeSource('_types/Good.md', '---\ninsert date\n---')).toEqual([]);
    expect(lintOntologySchemaSource('_types/schema.json', JSON.stringify({ types: [] }))).toContainEqual(expect.objectContaining({
      message: 'types must be a map of named definitions',
      severity: 'error',
    }));
  });

  it('warns when schema-facing frontmatter identifiers are not kebab-case', () => {
    const issues = lintOntologyTypeSource('_types/Legacy.md', '---\nunderscore-names\n---');

    expect(issues.map((entry) => entry.message)).toEqual(expect.arrayContaining([
      'Property name birth_year should use kebab-case',
      'Property birth_year.frontmatter-key birth_year should use kebab-case',
      'Relation name influenced_by should use kebab-case',
      'Relation influenced_by.inverse influences_person should use kebab-case',
    ]));
  });

  it('rejects malformed type unions', () => {
    expect(lintOntologyTypeSource('_types/BadUnion.md', '---\nbad-union\n---')).toContainEqual(expect.objectContaining({
      message: 'Property up.type has an invalid union expression',
      severity: 'error',
    }));
  });
});
