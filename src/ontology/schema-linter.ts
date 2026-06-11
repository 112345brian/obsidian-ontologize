import { parseYaml } from 'obsidian';

import type { OntologyIssue } from './types.ts';

import { isInsertTemplate } from './templates.ts';
import { DEFAULT_BLOCK_PREFIX } from './parser.ts';
import { isValidTypeExpression } from './type-expression.ts';

const TYPE_KEYS = new Set([
  'abstract',
  'auto-apply',
  'can-have',
  'cannot-have',
  'disjoint',
  'excludes',
  'extends',
  'fields',
  'implements',
  'requires',
  'interface',
  'lock',
  'must-have',
  'relations',
  'replaces',
  'template',
  'type',
  'values',
]);

const PROPERTY_KEYS = new Set([
  'cardinality',
  'excluded-types',
  'frontmatter-key',
  'included-types',
  'insert',
  'possible-values',
  'type',
  'uses',
]);

const RELATION_KEYS = new Set([
  'auto-update',
  'cardinality',
  'inverse',
  'range',
  'symmetric',
  'transitive',
  'type',
  'uses',
  'value',
  'value-type',
]);

const SCHEMA_KEYS = new Set(['fields', 'interfaces', 'relations', 'types']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function issue(file: string, message: string, severity: OntologyIssue['severity'] = 'error'): OntologyIssue {
  return { file, message, severity };
}

function parseSource(file: string, source: string, json: boolean): { issues: OntologyIssue[]; value: Record<string, unknown> | null } {
  const trimmed = source.trim();
  if (!trimmed) {
    return { issues: [issue(file, 'Schema source is empty', 'warning')], value: {} };
  }

  let body = trimmed;
  if (!json && trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3);
    if (end === -1) {
      return { issues: [issue(file, 'YAML frontmatter is missing its closing --- delimiter')], value: null };
    }
    body = trimmed.slice(3, end);
  } else if (!json) {
    body = trimmed.replace(/^# .*(?:\r?\n|$)/, '');
  }

  try {
    const parsed: unknown = json ? JSON.parse(body) as unknown : parseYaml(body) as unknown;
    const record = asRecord(parsed);
    return record
      ? { issues: [], value: record }
      : { issues: [issue(file, 'Schema root must be a map/object')], value: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { issues: [issue(file, `Schema syntax error: ${detail}`)], value: null };
  }
}

function lintUnknownKeys(file: string, context: string, record: Record<string, unknown>, allowed: Set<string>, issues: OntologyIssue[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      issues.push(issue(file, `Unknown ${context} field ${key}`, 'warning'));
    }
  }
}

function lintStringArray(file: string, context: string, value: unknown, issues: OntologyIssue[]): void {
  if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
    issues.push(issue(file, `${context} must be an array of strings`));
  }
}

function lintStringOrStringArray(file: string, context: string, value: unknown, issues: OntologyIssue[]): void {
  if (value === undefined || typeof value === 'string') {
    return;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    issues.push(issue(file, `${context} must be a string or flat array of strings`));
  }
}

function lintBoolean(file: string, context: string, value: unknown, issues: OntologyIssue[]): void {
  if (value !== undefined && typeof value !== 'boolean') {
    issues.push(issue(file, `${context} must be boolean`));
  }
}

function lintKebabCase(file: string, context: string, value: unknown, issues: OntologyIssue[]): void {
  if (typeof value === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    issues.push(issue(file, `${context} ${value} should use kebab-case`, 'warning'));
  }
}

function lintPropertyDefinition(file: string, property: string, value: unknown, issues: OntologyIssue[]): void {
  lintKebabCase(file, 'Property name', property, issues);
  if (typeof value === 'string') {
    if (!isValidTypeExpression(value)) {
      issues.push(issue(file, `Property ${property}.type has an invalid union expression`));
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    issues.push(issue(file, `Property ${property} must be a type string or definition map`));
    return;
  }
  lintUnknownKeys(file, `property ${property}`, record, PROPERTY_KEYS, issues);
  if (record['type'] !== undefined && typeof record['type'] !== 'string') {
    issues.push(issue(file, `Property ${property}.type must be one string`));
  } else if (typeof record['type'] === 'string' && !isValidTypeExpression(record['type'])) {
    issues.push(issue(file, `Property ${property}.type has an invalid union expression`));
  }
  lintStringArray(file, `Property ${property}.included-types`, record['included-types'], issues);
  lintStringArray(file, `Property ${property}.excluded-types`, record['excluded-types'], issues);
  lintStringArray(file, `Property ${property}.possible-values`, record['possible-values'], issues);
  lintKebabCase(file, `Property ${property}.frontmatter-key`, record['frontmatter-key'], issues);
  const insert = record['insert'];
  if (typeof insert === 'string' && /^[A-Za-z_]\w*(?:\.\w+)*\(.*\)$/.test(insert) && !isInsertTemplate(insert)) {
    issues.push(issue(file, `Property ${property}.insert uses unknown template ${insert}`));
  }
}

function lintPropertyMap(file: string, context: string, value: unknown, issues: OntologyIssue[]): void {
  if (value === undefined) {
    return;
  }
  const record = asRecord(value);
  if (!record) {
    issues.push(issue(file, `${context} must be a map of property definitions`));
    return;
  }
  for (const [property, definition] of Object.entries(record)) {
    lintPropertyDefinition(file, property, definition, issues);
  }
}

function lintRelationMap(file: string, value: unknown, issues: OntologyIssue[]): void {
  if (value === undefined || Array.isArray(value)) {
    return;
  }
  const record = asRecord(value);
  if (!record) {
    issues.push(issue(file, 'relations must be an array or map'));
    return;
  }
  for (const [name, definition] of Object.entries(record)) {
    lintKebabCase(file, 'Relation name', name, issues);
    if (typeof definition === 'string' || definition === true || definition === null) {
      continue;
    }
    const relation = asRecord(definition);
    if (!relation) {
      issues.push(issue(file, `Relation ${name} must be a string, true, null, or definition map`));
      continue;
    }
    lintUnknownKeys(file, `relation ${name}`, relation, RELATION_KEYS, issues);
    for (const key of ['inverse', 'range', 'type', 'uses', 'value', 'value-type']) {
      if (relation[key] !== undefined && typeof relation[key] !== 'string') {
        issues.push(issue(file, `Relation ${name}.${key} must be a string`));
      }
    }
    for (const key of ['range', 'type', 'value', 'value-type']) {
      if (typeof relation[key] === 'string' && !isValidTypeExpression(relation[key])) {
        issues.push(issue(file, `Relation ${name}.${key} has an invalid union expression`));
      }
    }
    lintKebabCase(file, `Relation ${name}.inverse`, relation['inverse'], issues);
    for (const key of ['auto-update', 'symmetric', 'transitive']) {
      lintBoolean(file, `Relation ${name}.${key}`, relation[key], issues);
    }
  }
}

function lintAutoApplyBlock(file: string, context: string, value: unknown, issues: OntologyIssue[], prefix: string): void {
  const record = asRecord(value);
  if (!record) {
    issues.push(issue(file, `${context} must be a map of conditions or named condition blocks`));
    return;
  }
  for (const [key, val] of Object.entries(record)) {
    if (key === 'match') {
      if (val !== 'any' && val !== 'all') {
        issues.push(issue(file, `${context}.match must be "any" or "all"`));
      }
    } else if (key.startsWith(prefix)) {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        lintAutoApplyBlock(file, `${context}.${key}`, val, issues, prefix);
      } else {
        issues.push(issue(file, `${context}.${key} must be a map (named condition block)`, 'warning'));
      }
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      issues.push(issue(file, `${context}.${key} is a map value; use a "${prefix}" prefix to define a named sub-block`, 'warning'));
    }
  }
}

function lintAutoApply(file: string, value: unknown, issues: OntologyIssue[], prefix: string): void {
  if (value === undefined || value === true) {
    return;
  }
  lintAutoApplyBlock(file, 'auto-apply', value, issues, prefix);
}

function lintReplacesField(file: string, value: unknown, issues: OntologyIssue[]): void {
  if (value === undefined) {
    return;
  }
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (typeof item === 'string') {
      continue;
    }
    const record = asRecord(item);
    if (!record) {
      issues.push(issue(file, 'replaces entries must be a wikilink string or {value, field} object'));
      continue;
    }
    if (typeof record['value'] !== 'string') {
      issues.push(issue(file, 'replaces entry is missing a value field'));
    }
    if (record['field'] !== undefined && typeof record['field'] !== 'string') {
      issues.push(issue(file, 'replaces entry field must be a string'));
    }
  }
}

function lintTypeRecord(file: string, value: unknown, issues: OntologyIssue[], prefix: string): void {
  const record = asRecord(value);
  if (!record) {
    issues.push(issue(file, 'Type definition must be a map/object'));
    return;
  }
  lintUnknownKeys(file, 'type', record, TYPE_KEYS, issues);
  lintStringOrStringArray(file, 'extends', record['extends'], issues);
  lintStringOrStringArray(file, 'implements', record['implements'], issues);
  lintStringOrStringArray(file, 'disjoint', record['disjoint'], issues);
  lintStringOrStringArray(file, 'excludes', record['excludes'], issues);
  lintReplacesField(file, record['replaces'], issues);
  lintStringOrStringArray(file, 'requires', record['requires'], issues);
  lintBoolean(file, 'abstract', record['abstract'], issues);
  lintBoolean(file, 'interface', record['interface'], issues);
  lintBoolean(file, 'lock', record['lock'], issues);
  lintAutoApply(file, record['auto-apply'], issues, prefix);
  lintPropertyMap(file, 'must-have', record['must-have'], issues);
  lintPropertyMap(file, 'can-have', record['can-have'], issues);
  lintPropertyMap(file, 'fields', record['fields'], issues);
  lintRelationMap(file, record['relations'], issues);
}

export function lintOntologyTypeSource(file: string, source: string, blockPrefix = DEFAULT_BLOCK_PREFIX): OntologyIssue[] {
  const parsed = parseSource(file, source, false);
  if (parsed.value) {
    lintTypeRecord(file, parsed.value, parsed.issues, blockPrefix);
  }
  return parsed.issues;
}

export function lintOntologySchemaSource(file: string, source: string, blockPrefix = DEFAULT_BLOCK_PREFIX): OntologyIssue[] {
  const parsed = parseSource(file, source, file.endsWith('.json'));
  if (!parsed.value) {
    return parsed.issues;
  }
  lintUnknownKeys(file, 'schema', parsed.value, SCHEMA_KEYS, parsed.issues);
  for (const group of ['types', 'interfaces'] as const) {
    const definitions = asRecord(parsed.value[group]);
    if (parsed.value[group] !== undefined && !definitions) {
      parsed.issues.push(issue(file, `${group} must be a map of named definitions`));
      continue;
    }
    for (const [name, definition] of Object.entries(definitions ?? {})) {
      lintTypeRecord(`${file}#${group}/${name}`, definition, parsed.issues, blockPrefix);
    }
  }
  lintPropertyMap(file, 'fields', parsed.value['fields'], parsed.issues);
  lintRelationMap(file, parsed.value['relations'], parsed.issues);
  return parsed.issues;
}
