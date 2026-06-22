import type {
  FrontmatterValue,
  OntologyType,
  PropertyDefinition,
  TypeReplacement
} from './types.ts';

export interface TypeEditorField {
  cardinality: string;
  excludedTypes: string[];
  frontmatterKey: string;
  includedTypes: string[];
  insert: string;
  name: string;
  possibleValues: string[];
  type: string;
  uses: string;
}

export interface TypeEditorRelation {
  autoUpdate: boolean;
  cardinality: string;
  inverse: string;
  name: string;
  range: string;
  symmetric: boolean;
  transitive: boolean;
  uses: string;
  valueType: string;
}

export interface TypeEditorAutoApplyCondition {
  key: string;
  value: string;
}

export type TypeEditorRule =
  | { kind: 'excludes' | 'requires'; value: string }
  | ({ kind: 'replaces' } & TypeReplacement);

export interface TypeEditorModel {
  abstract: boolean;
  alsoApply: string[];
  autoApplyConditions: TypeEditorAutoApplyCondition[];
  autoApplyMatch: 'all' | 'any';
  autoApplyMode: 'never' | 'always' | 'conditional';
  canHave: TypeEditorField[];
  extends: string[];
  implementableBy: string[];
  implements: string[];
  ingestFrom: Array<{ field: string; target: string }>;
  isInterface: boolean;
  lock: boolean;
  mustHave: TypeEditorField[];
  name: string;
  relations: TypeEditorRelation[];
  rules: TypeEditorRule[];
  template: string;
}

export function emptyTypeEditorModel(): TypeEditorModel {
  return {
    abstract: false,
    alsoApply: [],
    autoApplyConditions: [],
    autoApplyMatch: 'all',
    autoApplyMode: 'never',
    canHave: [],
    extends: [],
    implementableBy: [],
    implements: [],
    ingestFrom: [],
    isInterface: false,
    lock: false,
    mustHave: [],
    name: '',
    relations: [],
    rules: [],
    template: ''
  };
}

function displayInsert(value: FrontmatterValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fieldFromDefinition(name: string, definition: PropertyDefinition): TypeEditorField {
  return {
    cardinality: definition.cardinality ?? '',
    excludedTypes: definition.excludedTypes ?? [],
    frontmatterKey: definition.frontmatterKey ?? '',
    includedTypes: definition.includedTypes ?? [],
    insert: displayInsert(definition.insert),
    name,
    possibleValues: definition.values ?? [],
    type: definition.type ?? '',
    uses: definition.uses ?? ''
  };
}

function autoApplyToModel(autoApply: OntologyType['autoApply']): Pick<TypeEditorModel, 'autoApplyMode' | 'autoApplyMatch' | 'autoApplyConditions'> {
  if (!autoApply) {
    return { autoApplyConditions: [], autoApplyMatch: 'all', autoApplyMode: 'never' };
  }
  if (autoApply === true) {
    return { autoApplyConditions: [], autoApplyMatch: 'all', autoApplyMode: 'always' };
  }
  return {
    autoApplyConditions: Object.entries(autoApply.conditions).map(([key, value]) => ({ key, value: String(value) })),
    autoApplyMatch: autoApply.match,
    autoApplyMode: 'conditional'
  };
}

export function typeEditorModelFromType(type: OntologyType): TypeEditorModel {
  return {
    abstract: type.abstract,
    alsoApply: [...(type.alsoApply ?? [])],
    ...autoApplyToModel(type.autoApply),
    canHave: [...type.canHave].map(([name, definition]) => fieldFromDefinition(name, definition)),
    extends: [...type.extends],
    implementableBy: [...(type.implementableBy ?? [])],
    implements: [...type.implements],
    ingestFrom: [...(type.ingestFrom ?? new Map())].map(([field, target]) => ({ field, target })),
    isInterface: type.isInterface,
    lock: type.lockIntent,
    mustHave: [...type.mustHave].map(([name, definition]) => fieldFromDefinition(name, definition)),
    name: type.name,
    relations: [...type.relations].map(([name, definition]) => ({
      autoUpdate: definition.autoUpdate === true,
      cardinality: definition.cardinality ?? '',
      inverse: definition.inverse ?? '',
      name,
      range: definition.range ?? '',
      symmetric: definition.symmetric === true,
      transitive: definition.transitive === true,
      uses: definition.uses ?? '',
      valueType: definition.valueType ?? ''
    })),
    rules: [
      ...type.requires.map((value): TypeEditorRule => ({ kind: 'requires', value })),
      ...type.excludes.map((value): TypeEditorRule => ({ kind: 'excludes', value })),
      ...type.replaces.map((replacement): TypeEditorRule => ({ kind: 'replaces', ...replacement }))
    ],
    template: type.template ?? ''
  };
}

function parseInsert(value: string): FrontmatterValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as FrontmatterValue;
  } catch {
    return trimmed;
  }
}

function serializeFields(fields: TypeEditorField[]): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const name = field.name.trim();
    if (!name) {
      continue;
    }
    const definition: Record<string, unknown> = {};
    if (field.uses.trim()) {
      definition['uses'] = field.uses.trim();
    }
    if (field.type.trim()) {
      definition['type'] = field.type.trim();
    }
    if (field.cardinality.trim()) {
      definition['cardinality'] = field.cardinality.trim();
    }
    if (field.frontmatterKey.trim()) {
      definition['frontmatter-key'] = field.frontmatterKey.trim();
    }
    if (field.includedTypes.length > 0) {
      definition['included-types'] = field.includedTypes;
    }
    if (field.excludedTypes.length > 0) {
      definition['excluded-types'] = field.excludedTypes;
    }
    if (field.possibleValues.length > 0) {
      definition['possible-values'] = field.possibleValues;
    }
    const insert = parseInsert(field.insert);
    if (insert !== undefined) {
      definition['insert'] = insert;
    }
    result[name] = definition;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function schemaKey(key: string, requireOntologizePrefix: boolean): string {
  return requireOntologizePrefix ? `ontologize.${key}` : key;
}

export function typeEditorFrontmatter(model: TypeEditorModel, requireOntologizePrefix = false): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = { ontologize: true };
  if (model.lock) {
    frontmatter[schemaKey('lock', requireOntologizePrefix)] = true;
  }
  if (model.abstract) {
    frontmatter[schemaKey('abstract', requireOntologizePrefix)] = true;
  }
  if (model.isInterface) {
    frontmatter[schemaKey('interface', requireOntologizePrefix)] = true;
  }
  if (model.extends.length > 0) {
    frontmatter[schemaKey('extends', requireOntologizePrefix)] = model.extends.map((name) => `[[${name}]]`);
  }
  if (model.implementableBy.length > 0) {
    frontmatter[schemaKey('implementable-by', requireOntologizePrefix)] = model.implementableBy.map((name) => `[[${name}]]`);
  }
  const ingestFrom = model.ingestFrom.filter((e) => e.field.trim() && e.target.trim());
  if (ingestFrom.length > 0) {
    frontmatter[schemaKey('ingest-from', requireOntologizePrefix)] = Object.fromEntries(ingestFrom.map((e) => [e.field.trim(), e.target.trim()]));
  }
  if (model.implements.length > 0) {
    frontmatter[schemaKey('implements', requireOntologizePrefix)] = model.implements.map((name) => `[[${name}]]`);
  }
  const replacementRules = model.rules.filter((rule): rule is Extract<TypeEditorRule, { kind: 'replaces' }> => rule.kind === 'replaces');
  if (replacementRules.length > 0) {
    const serializedReplacements: unknown[] = [];
    for (const { field, newField, newValue, value } of replacementRules) {
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        continue;
      }
      const linkedValue = `[[${trimmedValue}]]`;
      const trimmedField = field?.trim();
      const trimmedNewField = newField?.trim();
      const trimmedNewValue = newValue?.trim();
      if (!trimmedField && !trimmedNewField && !trimmedNewValue) {
        serializedReplacements.push(linkedValue);
        continue;
      }
      serializedReplacements.push({
        ...(trimmedField ? { field: trimmedField } : {}),
        ...(trimmedNewField ? { 'new-field': trimmedNewField } : {}),
        ...(trimmedNewValue ? { 'new-value': `[[${trimmedNewValue}]]` } : {}),
        value: linkedValue
      });
    }
    if (serializedReplacements.length > 0) {
      frontmatter[schemaKey('replaces', requireOntologizePrefix)] = serializedReplacements;
    }
  }
  const requires = model.rules.filter((rule) => rule.kind === 'requires' && rule.value.trim()).map((rule) => `[[${rule.value.trim()}]]`);
  if (requires.length > 0) {
    frontmatter[schemaKey('requires', requireOntologizePrefix)] = requires;
  }
  const excludes = model.rules.filter((rule) => rule.kind === 'excludes' && rule.value.trim()).map((rule) => `[[${rule.value.trim()}]]`);
  if (excludes.length > 0) {
    frontmatter[schemaKey('excludes', requireOntologizePrefix)] = excludes;
  }
  const mustHave = serializeFields(model.mustHave);
  if (mustHave) {
    frontmatter[schemaKey('must-have', requireOntologizePrefix)] = mustHave;
  }
  const canHave = serializeFields(model.canHave);
  if (canHave) {
    frontmatter[schemaKey('can-have', requireOntologizePrefix)] = canHave;
  }
  if (model.autoApplyMode === 'always') {
    frontmatter[schemaKey('auto-apply', requireOntologizePrefix)] = true;
  } else if (model.autoApplyMode === 'conditional' && model.autoApplyConditions.some((c) => c.key.trim())) {
    const conditions: Record<string, unknown> = {};
    for (const { key, value } of model.autoApplyConditions) {
      if (key.trim()) {
        conditions[key.trim()] = value;
      }
    }
    frontmatter[schemaKey('auto-apply', requireOntologizePrefix)] = { match: model.autoApplyMatch, ...conditions };
  }
  if (model.template.trim()) {
    frontmatter[schemaKey('template', requireOntologizePrefix)] = `[[${model.template.trim()}]]`;
  }
  if (model.alsoApply.length > 0) {
    frontmatter[schemaKey('also-apply', requireOntologizePrefix)] = model.alsoApply.map((name) => `[[${name}]]`);
  }
  if (model.relations.length > 0) {
    frontmatter[schemaKey('relations', requireOntologizePrefix)] = Object.fromEntries(
      model.relations.filter((relation) => relation.name.trim()).map((relation) => {
        const definition: Record<string, unknown> = {};
        if (relation.uses.trim()) definition['uses'] = relation.uses.trim();
        if (relation.valueType.trim()) definition['value-type'] = relation.valueType.trim();
        if (relation.range.trim()) definition['range'] = relation.range.trim();
        if (relation.inverse.trim()) definition['inverse'] = relation.inverse.trim();
        if (relation.cardinality.trim()) definition['cardinality'] = relation.cardinality.trim();
        if (relation.symmetric) definition['symmetric'] = true;
        if (relation.transitive) definition['transitive'] = true;
        if (relation.autoUpdate) definition['auto-update'] = true;
        return [relation.name.trim(), Object.keys(definition).length > 0 ? definition : true];
      })
    );
  }
  return frontmatter;
}

export const TYPE_EDITOR_KEYS = [
  'abstract',
  'also-apply',
  'auto-apply',
  'can-have',
  'excludes',
  'extends',
  'implementable-by',
  'implements',
  'ingest-from',
  'interface',
  'lock',
  'must-have',
  'relations',
  'replaces',
  'requires',
  'template'
] as const;
