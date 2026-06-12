import type { FrontmatterValue, OntologyType, PropertyDefinition } from './types.ts';

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

export interface TypeEditorModel {
  abstract: boolean;
  autoApplyConditions: TypeEditorAutoApplyCondition[];
  autoApplyMatch: 'all' | 'any';
  autoApplyMode: 'never' | 'always' | 'conditional';
  canHave: TypeEditorField[];
  excludes: string[];
  extends: string[];
  implementableBy: string[];
  implements: string[];
  isInterface: boolean;
  lock: boolean;
  mustHave: TypeEditorField[];
  name: string;
  relations: TypeEditorRelation[];
  replaces: string[];
  requires: string[];
  template: string;
}

export function emptyTypeEditorModel(): TypeEditorModel {
  return {
    abstract: false,
    autoApplyConditions: [],
    autoApplyMatch: 'all',
    autoApplyMode: 'never',
    canHave: [],
    excludes: [],
    extends: [],
    implementableBy: [],
    implements: [],
    isInterface: false,
    lock: false,
    mustHave: [],
    name: '',
    relations: [],
    replaces: [],
    requires: [],
    template: '',
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
    uses: definition.uses ?? '',
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
    autoApplyMode: 'conditional',
  };
}

export function typeEditorModelFromType(type: OntologyType): TypeEditorModel {
  return {
    abstract: type.abstract,
    ...autoApplyToModel(type.autoApply),
    canHave: [...type.canHave].map(([name, definition]) => fieldFromDefinition(name, definition)),
    excludes: [...type.excludes],
    extends: [...type.extends],
    implementableBy: [...(type.implementableBy ?? [])],
    implements: [...type.implements],
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
      valueType: definition.valueType ?? '',
    })),
    replaces: type.replaces.filter((r) => !r.field).map((r) => r.value),
    requires: [...type.requires],
    template: type.template ?? '',
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

export function typeEditorFrontmatter(model: TypeEditorModel): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  if (model.lock) {
    frontmatter['lock'] = true;
  }
  if (model.abstract) {
    frontmatter['abstract'] = true;
  }
  if (model.isInterface) {
    frontmatter['interface'] = true;
  }
  if (model.extends.length > 0) {
    frontmatter['extends'] = model.extends.map((name) => `[[${name}]]`);
  }
  if (model.implementableBy.length > 0) {
    frontmatter['implementable-by'] = model.implementableBy.map((name) => `[[${name}]]`);
  }
  if (model.implements.length > 0) {
    frontmatter['implements'] = model.implements.map((name) => `[[${name}]]`);
  }
  if (model.replaces.length > 0) {
    frontmatter['replaces'] = model.replaces.map((name) => `[[${name}]]`);
  }
  if (model.requires.length > 0) {
    frontmatter['requires'] = model.requires.map((name) => `[[${name}]]`);
  }
  if (model.excludes.length > 0) {
    frontmatter['excludes'] = model.excludes.map((name) => `[[${name}]]`);
  }
  const mustHave = serializeFields(model.mustHave);
  if (mustHave) {
    frontmatter['must-have'] = mustHave;
  }
  const canHave = serializeFields(model.canHave);
  if (canHave) {
    frontmatter['can-have'] = canHave;
  }
  if (model.autoApplyMode === 'always') {
    frontmatter['auto-apply'] = true;
  } else if (model.autoApplyMode === 'conditional' && model.autoApplyConditions.some((c) => c.key.trim())) {
    const conditions: Record<string, unknown> = {};
    for (const { key, value } of model.autoApplyConditions) {
      if (key.trim()) {
        conditions[key.trim()] = value;
      }
    }
    frontmatter['auto-apply'] = { match: model.autoApplyMatch, ...conditions };
  }
  if (model.template.trim()) {
    frontmatter['template'] = `[[${model.template.trim()}]]`;
  }
  if (model.relations.length > 0) {
    frontmatter['relations'] = Object.fromEntries(model.relations.filter((relation) => relation.name.trim()).map((relation) => {
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
    }));
  }
  return frontmatter;
}

export const TYPE_EDITOR_KEYS = [
  'abstract',
  'auto-apply',
  'can-have',
  'excludes',
  'extends',
  'implementable-by',
  'implements',
  'interface',
  'lock',
  'must-have',
  'relations',
  'replaces',
  'requires',
  'template',
] as const;
