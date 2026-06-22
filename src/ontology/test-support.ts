import type { OntologyEntity, OntologyIndex, OntologyType } from './types.ts';

/**
 * Shared fixture builders for unit tests. New `OntologyType` or index-settings
 * fields only need a default added here instead of in every test file.
 */

export function makeOntologyType(overrides: Partial<OntologyType> & { name: string }): OntologyType {
  return {
    abstract: false,
    alsoApply: [],
    canHave: new Map(),
    cannotHave: new Set(),
    disjoint: [],
    excludes: [],
    extends: [],
    fields: new Map(),
    implementableBy: [],
    implements: [],
    ingestFrom: new Map(),
    isInterface: false,
    lockIntent: false,
    mustHave: new Map(),
    path: `_types/${overrides.name}.md`,
    relations: new Map(),
    replaces: [],
    requires: [],
    scales: new Map(),
    values: [],
    ...overrides,
  };
}

export function makeOntologyEntity(overrides: Partial<OntologyEntity> & { path: string }): OntologyEntity {
  const { path } = overrides;
  return {
    frontmatter: {},
    ignored: false,
    instanceOf: [],
    lockIntent: false,
    name: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    ...overrides,
    path,
  };
}

export function makeIndexSettings(overrides: Partial<OntologyIndex['settings']> = {}): OntologyIndex['settings'] {
  return {
    autoApplyBlockPrefix: 'condition-',
    entityTypeFields: ['is-instance', 'type'],
    filesToIgnore: [],
    foldersToIgnore: [],
    frontmatterIgnoreRules: [],
    globalTypePath: '',
    requireOntologizePrefix: false,
    schemaPath: '',
    typeFolder: '_types',
    ...overrides,
  };
}
