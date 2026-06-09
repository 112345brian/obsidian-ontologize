import { parseYaml } from 'obsidian';

import type { OntologyEntity, OntologyType, PropertyDefinition, RelationDefinition } from './types.ts';

import { basenameWithoutExtension, extractLinkTargets, normalizeLinkTarget } from './links.ts';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStructuredObject(source: string, path = ''): Record<string, unknown> {
  const trimmed = source.trim();
  if (!trimmed) {
    return {};
  }
  if (path.endsWith('.json') || trimmed.startsWith('{')) {
    try {
      return asRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return {};
    }
  }
  return asRecord(parseYaml(trimmed));
}

function readYamlObject(markdown: string): Record<string, unknown> {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3);
    if (end !== -1) {
      return readStructuredObject(trimmed.slice(3, end));
    }
  }

  const withoutHeading = trimmed.replace(/^# .*(?:\r?\n|$)/, '');
  return readStructuredObject(withoutHeading);
}

function parsePropertyDefinition(value: unknown): PropertyDefinition {
  if (typeof value === 'string') {
    return { type: normalizeLinkTarget(value) };
  }
  const record = asRecord(value);
  const type = typeof record['type'] === 'string' ? normalizeLinkTarget(record['type']) : undefined;
  const cardinality = typeof record['cardinality'] === 'string' ? record['cardinality'] : undefined;
  const values = Array.isArray(record['values']) ? record['values'].map(String) : undefined;
  return { cardinality, type, values };
}

function parsePropertyMap(value: unknown): Map<string, PropertyDefinition> {
  return new Map(
    Object.entries(asRecord(value)).map(([key, definition]) => [key, parsePropertyDefinition(definition)])
  );
}

function parseCannotHave(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map(String));
  }
  return new Set(Object.keys(asRecord(value)));
}

function parseRelationDefinition(value: unknown): RelationDefinition {
  if (value === true || value === null) {
    return {};
  }
  if (typeof value === 'string') {
    return { uses: normalizeLinkTarget(value) };
  }
  const record = asRecord(value);
  return {
    autoUpdate: record['auto-update'] === true,
    cardinality: typeof record['cardinality'] === 'string' ? record['cardinality'] : undefined,
    inverse: typeof record['inverse'] === 'string' ? record['inverse'] : undefined,
    range: typeof record['range'] === 'string' ? normalizeLinkTarget(record['range']) : undefined,
    symmetric: record['symmetric'] === true,
    transitive: record['transitive'] === true,
    uses: typeof record['uses'] === 'string' ? normalizeLinkTarget(record['uses']) : undefined,
    valueType: typeof record['value-type'] === 'string'
      ? normalizeLinkTarget(record['value-type'])
      : typeof record['type'] === 'string'
        ? normalizeLinkTarget(record['type'])
        : typeof record['value'] === 'string'
          ? normalizeLinkTarget(record['value'])
          : undefined,
  };
}

function parseRelations(value: unknown): Map<string, RelationDefinition> {
  if (Array.isArray(value)) {
    return new Map(value.map((item) => {
      const key = normalizeLinkTarget(String(item));
      return [key, { uses: key }];
    }));
  }
  return new Map(Object.entries(asRecord(value)).map(([key, definition]) => [key, parseRelationDefinition(definition)]));
}

function parseOntologyTypeRecord(name: string, path: string, yaml: Record<string, unknown>): OntologyType {
  return {
    abstract: yaml['abstract'] === true,
    canHave: parsePropertyMap(yaml['can-have']),
    cannotHave: parseCannotHave(yaml['cannot-have']),
    disjoint: extractLinkTargets(yaml['disjoint']),
    extends: extractLinkTargets(yaml['extends']),
    implements: extractLinkTargets(yaml['implements']),
    isInterface: yaml['interface'] === true || yaml['type'] === 'interface',
    lockIntent: yaml['lock'] === true,
    mustHave: parsePropertyMap(yaml['must-have']),
    name,
    path,
    relations: parseRelations(yaml['relations']),
    typeKind: typeof yaml['type'] === 'string' ? yaml['type'] : undefined,
    values: Array.isArray(yaml['values']) ? yaml['values'].map(String) : [],
  };
}

export function parseOntologyType(path: string, markdown: string): OntologyType {
  return parseOntologyTypeRecord(basenameWithoutExtension(path), path, readYamlObject(markdown));
}

function parseSchemaTypeMap(path: string, group: string, value: unknown, defaults: Partial<OntologyType> = {}): OntologyType[] {
  return Object.entries(asRecord(value)).map(([name, definition]) => ({
    ...parseOntologyTypeRecord(name, `${path}#${group}/${name}`, asRecord(definition)),
    ...defaults,
    name,
  }));
}

export function parseOntologySchema(path: string, source: string): OntologyType[] {
  const schema = readStructuredObject(source, path);
  const types = [
    ...parseSchemaTypeMap(path, 'types', schema['types']),
    ...parseSchemaTypeMap(path, 'interfaces', schema['interfaces'], {
      isInterface: true,
    }),
  ];

  if (schema['relations'] !== undefined) {
    types.push(parseOntologyTypeRecord('_relations', `${path}#relations`, {
      relations: schema['relations'],
      type: 'relation-definitions',
    }));
  }

  return types;
}

export function parseOntologyEntity(path: string, frontmatter: Record<string, unknown>, typeFields: string[] = ['instance_of', 'type']): OntologyEntity | null {
  const typeValue = typeFields.map((field) => frontmatter[field]).find((value) => value !== undefined && value !== null && value !== '');
  const instanceOf = extractLinkTargets(typeValue);
  if (instanceOf.length === 0) {
    return null;
  }

  return {
    frontmatter,
    instanceOf,
    lockIntent: frontmatter['lock'] === true,
    name: basenameWithoutExtension(path),
    path,
  };
}
