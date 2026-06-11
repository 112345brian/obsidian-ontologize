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
  implements: string[];
  isInterface: boolean;
  replaces: TypeReplacement[];
  requires: string[];
  lockIntent: boolean;
  fields: Map<string, PropertyDefinition>;
  mustHave: Map<string, PropertyDefinition>;
  name: string;
  path: string;
  relations: Map<string, RelationDefinition>;
  template?: string | undefined;
  typeKind?: string | undefined;
  values: string[];
}

export interface OntologyEntity {
  frontmatter: Record<string, unknown>;
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

export interface OntologyIssue {
  autoUpdate?: boolean;
  autofixable?: boolean;
  file: string;
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
  issues: OntologyIssue[];
  relationDefinitions: Map<string, RelationDefinition>;
  schemaIssues?: OntologyIssue[] | undefined;
  generatedAt: string;
  settings: {
    autoApplyBlockPrefix: string;
    entityTypeFields: string[];
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: FrontmatterIgnoreRule[];
    schemaPath: string;
    typeFolder: string;
  };
  types: Map<string, OntologyType>;
}
