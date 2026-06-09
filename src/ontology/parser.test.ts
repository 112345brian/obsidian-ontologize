import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  parseYaml: (source: string) => {
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

import { parseOntologyEntity, parseOntologyType } from './parser.ts';

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
});
