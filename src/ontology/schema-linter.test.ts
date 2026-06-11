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
});
