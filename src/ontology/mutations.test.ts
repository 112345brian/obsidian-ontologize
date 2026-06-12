import { describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';
import type { AutoApplyBlock, OntologyIndex, OntologyType } from './types.ts';

vi.mock('obsidian', () => ({
  Notice: vi.fn(),
}));

import { applyScaffoldPlan, applyTypeReplacements, planMissingInverses, planScaffoldEntity, shouldAutoApplyScaffold } from './mutations.ts';
import { makeIndexSettings, makeOntologyType } from './test-support.ts';

function makeType(): OntologyType {
  return makeOntologyType({
    lockIntent: true,
    name: 'Philosopher',
    relations: new Map([
      ['influenced', {
        autoUpdate: true,
        inverse: 'influenced_by',
        range: 'Philosopher',
      }],
    ]),
  });
}

function makeInterfaceRelationIndex(): OntologyIndex {
  const index = makeIndex();
  index.types.set('_relations', makeOntologyType({
    name: '_relations',
    relations: new Map([
      ['influenced_by', {
        inverse: 'influenced',
        range: 'Philosopher',
        valueType: 'wikilink',
      }],
    ]),
    typeKind: 'relation-definitions',
  }));
  index.types.set('Influenceable', makeOntologyType({
    isInterface: true,
    lockIntent: true,
    name: 'Influenceable',
    relations: new Map([
      ['influenced_by', { uses: 'influenced_by' }],
    ]),
  }));
  index.relationDefinitions.set('influenced_by', {
    inverse: 'influenced',
    range: 'Philosopher',
    valueType: 'wikilink',
  });
  index.types.set('Philosopher', {
    ...makeType(),
    implements: ['Influenceable'],
  });
  index.issues[0] = {
    autoUpdate: false,
    autofixable: true,
    file: 'Spinoza.md',
    message: 'Missing inverse relation influenced on Leibniz.',
    property: 'influenced_by',
    severity: 'warning',
    target: 'Leibniz',
  };
  index.entities.get('Spinoza.md')!.frontmatter = {
    influenced_by: ['[[Leibniz]]'],
    instance_of: '[[Philosopher]]',
  };
  return index;
}

function makeIndex(): OntologyIndex {
  const source = {
    frontmatter: {
      influenced: ['[[Leibniz]]'],
      instance_of: '[[Philosopher]]',
    },
    instanceOf: ['Philosopher'],
    lockIntent: true,
    name: 'Spinoza',
    path: 'Spinoza.md',
  };
  const target = {
    frontmatter: {
      instance_of: '[[Philosopher]]',
    },
    instanceOf: ['Philosopher'],
    lockIntent: true,
    name: 'Leibniz',
    path: 'Leibniz.md',
  };

  return {
    ancestorsByType: new Map([
      ['Philosopher', new Set()],
    ]),
    cacheVersion: 1,
    effectiveEntityLocks: new Map(),
    effectiveTypeLocks: new Map(),
    entities: new Map([
      [source.path, source],
      [target.path, target],
    ]),
    entitiesByName: new Map([
      [source.name, source],
      [target.name, target],
    ]),
    fieldDefinitions: new Map(),
    generatedAt: '2026-06-09T00:00:00.000Z',
    issues: [
      {
        autoUpdate: true,
        autofixable: true,
        file: source.path,
        message: 'Missing inverse relation influenced_by on Leibniz.',
        property: 'influenced',
        severity: 'warning',
        target: target.name,
      },
    ],
    relationDefinitions: new Map(),
    settings: makeIndexSettings({ entityTypeFields: ['instance_of', 'type'] }),
    types: new Map([
      ['Philosopher', makeType()],
    ]),
  };
}

describe('ontology frontmatter mutations', () => {
  it('plans missing inverse relation frontmatter changes without writing', () => {
    expect(planMissingInverses(makeIndex())).toEqual([
      {
        autoUpdate: true,
        inverseProperty: 'influenced_by',
        message: 'Missing inverse relation influenced_by on Leibniz.',
        sourceName: 'Spinoza',
        sourcePath: 'Spinoza.md',
        sourceProperty: 'influenced',
        targetName: 'Leibniz',
        targetPath: 'Leibniz.md',
        value: '[[Spinoza]]',
      },
    ]);
  });

  it('can limit plans to auto-update relation issues', () => {
    const index = makeIndex();
    index.issues[0]!.autoUpdate = false;
    expect(planMissingInverses(index, { onlyAutoUpdate: true })).toEqual([]);
  });

  it('plans fixes for relations inherited from implemented interfaces', () => {
    expect(planMissingInverses(makeInterfaceRelationIndex())).toEqual([
      expect.objectContaining({
        inverseProperty: 'influenced',
        sourceProperty: 'influenced_by',
        value: '[[Spinoza]]',
      }),
    ]);
  });

  it('skips plans whose target name is ambiguous across multiple notes', () => {
    const index = makeIndex();
    index.ambiguousEntityNames = new Set(['Leibniz']);
    expect(planMissingInverses(index)).toEqual([]);
  });

  it('resolves the inverse from the most derived type, matching validation', () => {
    const index = makeIndex();
    const parent = makeType();
    parent.name = 'Person';
    parent.path = '_types/Person.md';
    parent.relations = new Map([
      ['influenced', {
        inverse: 'known_by',
        range: 'Person',
      }],
    ]);
    index.types.set('Person', parent);
    index.ancestorsByType.set('Philosopher', new Set(['Person']));
    index.ancestorsByType.set('Person', new Set());

    // Philosopher (the entity's direct type) overrides the inverse; the fix must
    // write the property validation reported, not the ancestor's.
    expect(planMissingInverses(index)).toEqual([
      expect.objectContaining({
        inverseProperty: 'influenced_by',
        sourceProperty: 'influenced',
      }),
    ]);
  });

  it('scaffolds inherited properties and relation fields', async () => {
    const index = makeIndex();
    const philosopher = index.types.get('Philosopher')!;
    philosopher.mustHave.set('school', { type: 'string' });
    philosopher.canHave.set('birth_year', { type: 'number' });
    index.entities.get('Spinoza.md')!.frontmatter = {
      birth_year: 1632,
      instance_of: '[[Philosopher]]',
    };
    const frontmatter = { ...index.entities.get('Spinoza.md')!.frontmatter };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    const added = await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, planScaffoldEntity(index, 'Spinoza.md'));

    expect(added).toBe(2);
    expect(frontmatter).toEqual({
      birth_year: 1632,
      influenced: null,
      instance_of: '[[Philosopher]]',
      school: null,
    });
  });

  it('plans scaffold fields before writing frontmatter', () => {
    const index = makeIndex();
    const philosopher = index.types.get('Philosopher')!;
    philosopher.mustHave.set('school', { type: 'string' });
    philosopher.canHave.set('birth_year', { type: 'number' });
    index.entities.get('Spinoza.md')!.frontmatter = {
      birth_year: 1632,
      instance_of: '[[Philosopher]]',
    };

    const plans = planScaffoldEntity(index, 'Spinoza.md');
    expect(plans.map(({ candidates: _c, ...rest }) => rest)).toEqual([
      { kind: 'required', property: 'school' },
      { kind: 'relation', property: 'influenced' },
    ]);
  });

  it('inserts required values without overwriting existing frontmatter', async () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('up', {
      includedTypes: ['wikilink', 'string'],
      insert: '[[Person]]',
    });
    index.entities.get('Spinoza.md')!.frontmatter = {
      instance_of: '[[Philosopher]]',
      up: '[[Thinker]]',
    };
    const frontmatter = { ...index.entities.get('Spinoza.md')!.frontmatter };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    const plans = planScaffoldEntity(index, 'Spinoza.md');
    expect(plans).toContainEqual(expect.objectContaining({ kind: 'required', property: 'up', insert: '[[Person]]' }));

    await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, plans);
    expect(frontmatter['up']).toEqual(['[[Thinker]]', '[[Person]]']);
  });

  it('resolves date templates only when scaffolding a missing field', async () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('date-start', {
      insert: 'date.now()',
      type: 'date',
    });
    index.entities.get('Spinoza.md')!.frontmatter = {
      instance_of: '[[Philosopher]]',
    };
    const frontmatter = { ...index.entities.get('Spinoza.md')!.frontmatter };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    const plans = planScaffoldEntity(index, 'Spinoza.md');
    expect(plans).toContainEqual({ kind: 'required', property: 'date-start', insert: 'date.now()' });

    await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, plans, {
      now: new Date(2026, 5, 11, 14, 30, 0),
    });
    expect(frontmatter['date-start']).toBe('2026-06-11');

    index.entities.get('Spinoza.md')!.frontmatter['date-start'] = '2020-01-01';
    expect(planScaffoldEntity(index, 'Spinoza.md')).not.toContainEqual(expect.objectContaining({ property: 'date-start' }));
  });

  it('does not overwrite a field populated after template preview', async () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.mustHave.set('date-start', {
      insert: 'date.now()',
      type: 'date',
    });
    index.entities.get('Spinoza.md')!.frontmatter = {
      instance_of: '[[Philosopher]]',
    };
    const plans = planScaffoldEntity(index, 'Spinoza.md').filter((plan) => plan.property === 'date-start');
    const frontmatter: Record<string, unknown> = {
      'date-start': '2020-01-01',
      instance_of: '[[Philosopher]]',
    };
    const app = {
      fileManager: {
        processFrontMatter: (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
          callback(frontmatter);
          return Promise.resolve();
        },
      },
    } as unknown as App;

    expect(await applyScaffoldPlan(app, { path: 'Spinoza.md' } as TFile, plans, {
      now: new Date(2026, 5, 11),
    })).toBe(0);
    expect(frontmatter['date-start']).toBe('2020-01-01');
  });
});

function block(conditions: Record<string, unknown>, opts: { match?: 'any' | 'all'; blocks?: Record<string, AutoApplyBlock> } = {}): AutoApplyBlock {
  return { blocks: opts.blocks ?? {}, conditions, match: opts.match ?? 'all' };
}

describe('shouldAutoApplyScaffold', () => {
  it('returns false when type has no auto-apply', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('returns true when type has auto-apply: true', () => {
    const index = makeIndex();
    index.types.get('Philosopher')!.autoApply = true;
    const entity = index.entities.get('Spinoza.md')!;
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
  });

  it('flat all (default): all conditions must match', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Leibniz]]' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Descartes]]' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Leibniz]]', 'school-of-thought': '[[Rationalism]]' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('flat any: any matching condition is enough', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Leibniz]]', 'school-of-thought': '[[Rationalism]]' }, { match: 'any' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Descartes]]', 'school-of-thought': '[[Rationalism]]' }, { match: 'any' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('named blocks default to any (OR): any matching block triggers', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({}, {
      match: 'any',
      blocks: {
        'has-leibniz': block({ influenced: '[[Leibniz]]' }),
        'has-descartes': block({ influenced: '[[Descartes]]' }),
      },
    });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
  });

  it('named blocks with match: all — all blocks must match', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({}, {
      match: 'all',
      blocks: {
        'has-leibniz': block({ influenced: '[[Leibniz]]' }),
        'has-descartes': block({ influenced: '[[Descartes]]' }),
      },
    });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('per-block match mode applies within that block', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    // inner block uses match: any — either condition is enough
    index.types.get('Philosopher')!.autoApply = block({}, {
      blocks: {
        'either-link': block({ influenced: '[[Leibniz]]', 'school-of-thought': '[[Rationalism]]' }, { match: 'any' }),
      },
    });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
  });

  it('returns false when a matched property is absent from frontmatter', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ 'school-of-thought': '[[Rationalism]]' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('returns true when any direct type satisfies auto-apply', () => {
    const index = makeIndex();
    index.types.set('Scientist', {
      ...makeType(),
      autoApply: true,
      name: 'Scientist',
      path: '_types/Scientist.md',
    });
    const entity = index.entities.get('Spinoza.md')!;
    entity.instanceOf = ['Philosopher', 'Scientist'];
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
  });

  it('evaluates numeric > comparison', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ 'birth-year': '> 1600' });
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1632 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1400 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('evaluates numeric < comparison', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ 'birth-year': '< 500' });
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 400 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1632 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('evaluates >= and <= comparisons', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1632 };
    index.types.get('Philosopher')!.autoApply = block({ 'birth-year': '>= 1632' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    index.types.get('Philosopher')!.autoApply = block({ 'birth-year': '<= 1632' });
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
  });

  it('evaluates != comparison', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ 'birth-year': '!= 2000' });
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1632 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 2000 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });

  it('mixes wiki link and numeric conditions', () => {
    const index = makeIndex();
    const entity = index.entities.get('Spinoza.md')!;
    index.types.get('Philosopher')!.autoApply = block({ influenced: '[[Leibniz]]', 'birth-year': '> 1600' });
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1632 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(true);
    entity.frontmatter = { ...entity.frontmatter, 'birth-year': 1400 };
    expect(shouldAutoApplyScaffold(index, entity)).toBe(false);
  });
});

describe('applyTypeReplacements', () => {
  it('replaces a value in the same field when new-field is omitted', () => {
    const frontmatter: Record<string, unknown> = { relationship: ['[[colleague]]', '[[person]]'] };

    applyTypeReplacements(frontmatter, [{ field: 'relationship', newValue: 'friend', value: 'colleague' }], ['is-instance']);

    expect(frontmatter).toEqual({ relationship: ['[[person]]', '[[friend]]'] });
  });

  it('moves the replacement to a different field', () => {
    const frontmatter: Record<string, unknown> = { relationship: '[[colleague]]', status: 'active' };

    applyTypeReplacements(frontmatter, [{ field: 'relationship', newField: 'connection', newValue: 'friend', value: 'colleague' }], ['is-instance']);

    expect(frontmatter).toEqual({ connection: '[[friend]]', status: 'active' });
  });

  it('preserves remove-only replacement rules', () => {
    const frontmatter: Record<string, unknown> = { 'is-instance': ['[[friend]]', '[[person]]'] };

    applyTypeReplacements(frontmatter, [{ value: 'friend' }], ['is-instance', 'type']);

    expect(frontmatter).toEqual({ 'is-instance': '[[person]]' });
  });
});
