export interface Scale {
  max?: number;
  min?: number;
  neutral?: number;
  normalize?: string[];  // custom word-strip list; omit to use the built-in default
  steps: Record<string, string[]>;  // numeric string key → alias list
}

export type FrontmatterValue =
  | boolean
  | null
  | number
  | string
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export interface PropertyDefinition {
  cardinality?: string | undefined;
  excludedTypes?: string[] | undefined;
  frontmatterKey?: string | undefined;
  includedTypes?: string[] | undefined;
  insert?: FrontmatterValue | undefined;
  type?: string | undefined;
  uses?: string | undefined;
  values?: string[] | undefined;
  weighted?: boolean | undefined;
  weightScale?: string | undefined;
}

export interface RelationDefinition {
  autoUpdate?: boolean;
  cardinality?: string | undefined;
  inverse?: string | undefined;
  range?: string | undefined;
  symmetric?: boolean;
  transitive?: boolean;
  uses?: string | undefined;
  valueType?: string | undefined;
}

export interface TypeReplacement {
  field?: string | undefined;
  newField?: string | undefined;
  newValue?: string | undefined;
  value: string;
}

export interface AutoApplyBlock {
  match: 'any' | 'all';
  conditions: Record<string, unknown>;
  blocks: Record<string, AutoApplyBlock>;
}

export interface OntologyType {
  abstract: boolean;
  autoApply?: AutoApplyBlock | true | undefined;
  canHave: Map<string, PropertyDefinition>;
  cannotHave: Set<string>;
  disjoint: string[];
  excludes: string[];
  extends: string[];
  implementableBy: string[];
  implements: string[];
  alsoApply: string[];
  ingestFrom: Map<string, string>;
  isInterface: boolean;
  replaces: TypeReplacement[];
  requires: string[];
  lockIntent: boolean;
  fields: Map<string, PropertyDefinition>;
  mustHave: Map<string, PropertyDefinition>;
  name: string;
  path: string;
  relations: Map<string, RelationDefinition>;
  scales: Map<string, Scale>;
  template?: string | undefined;
  typeKind?: string | undefined;
  values: string[];
}

export interface OntologyEntity {
  frontmatter: Record<string, unknown>;
  ignored?: boolean | undefined;
  instanceOf: string[];
  lockIntent: boolean;
  name: string;
  path: string;
}

export interface EffectiveLockState {
  reason?: string;
  state: 'incomplete' | 'locked' | 'unlocked';
}

export interface FrontmatterIgnoreRule {
  key: string;
  value?: string;
}

export interface GitBlame {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface OntologyIssue {
  autoUpdate?: boolean;
  autofixable?: boolean;
  blame?: GitBlame | undefined;
  file: string;
  /** 'coherence' = disjoint/excludes/requires violation; type membership is self-contradictory.
   *  'schema'    = missing field, bad value, cardinality error; membership is fine but incomplete. */
  kind?: 'coherence' | 'schema' | undefined;
  message: string;
  property?: string;
  severity: 'error' | 'warning';
  target?: string;
}

export interface OntologyIndex {
  ambiguousEntityNames?: Set<string>;
  ancestorsByType: Map<string, Set<string>>;
  cacheVersion: 1;
  circularTypes?: Set<string>;
  effectiveEntityLocks: Map<string, EffectiveLockState>;
  effectiveTypeLocks: Map<string, EffectiveLockState>;
  entities: Map<string, OntologyEntity>;
  entitiesByName: Map<string, OntologyEntity>;
  fieldDefinitions: Map<string, PropertyDefinition>;
  globalType?: OntologyType | undefined;
  globalTypeCanHave?: Map<string, PropertyDefinition> | undefined;
  globalTypeMustHave?: Map<string, PropertyDefinition> | undefined;
  globalTypeRelations?: Map<string, RelationDefinition> | undefined;
  issues: OntologyIssue[];
  relationDefinitions: Map<string, RelationDefinition>;
  scales: Map<string, Scale>;
  schemaIssues?: OntologyIssue[] | undefined;
  generatedAt: string;
  settings: {
    autoApplyBlockPrefix: string;
    entityTypeFields: string[];
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: FrontmatterIgnoreRule[];
    globalTypePath: string;
    schemaPath: string;
    typeFolder: string;
  };
  types: Map<string, OntologyType>;
}
