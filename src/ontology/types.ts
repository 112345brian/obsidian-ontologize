export type FrontmatterValue =
  | boolean
  | null
  | number
  | string
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export interface PropertyDefinition {
  cardinality?: string | undefined;
  type?: string | undefined;
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

export interface OntologyType {
  abstract: boolean;
  canHave: Map<string, PropertyDefinition>;
  cannotHave: Set<string>;
  disjoint: string[];
  extends: string[];
  implements: string[];
  isInterface: boolean;
  lockIntent: boolean;
  mustHave: Map<string, PropertyDefinition>;
  name: string;
  path: string;
  relations: Map<string, RelationDefinition>;
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
  ancestorsByType: Map<string, Set<string>>;
  cacheVersion: 1;
  effectiveEntityLocks: Map<string, EffectiveLockState>;
  effectiveTypeLocks: Map<string, EffectiveLockState>;
  entities: Map<string, OntologyEntity>;
  entitiesByName: Map<string, OntologyEntity>;
  issues: OntologyIssue[];
  relationDefinitions: Map<string, RelationDefinition>;
  generatedAt: string;
  settings: {
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: FrontmatterIgnoreRule[];
    typeFolder: string;
  };
  types: Map<string, OntologyType>;
}
