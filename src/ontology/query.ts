import type { OntologyEntity, OntologyIndex, Scale } from './types.ts';

import { entityCompositionChain } from './compose.ts';
import { extractAssertedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';
import { DEFAULT_SCALE, resolveScaleAlias, scaleNeutral } from './scale.ts';

interface AndNode {
  left: QueryNode;
  right: QueryNode;
  type: 'and';
}

interface NotNode {
  node: QueryNode;
  type: 'not';
}

interface OrNode {
  left: QueryNode;
  right: QueryNode;
  type: 'or';
}

interface PredicateNode {
  key: string;
  type: 'predicate';
  value: string;
}

export type QueryIncludeMode = 'all' | 'ignored' | 'incomplete' | 'locked';

export interface RunQueryOptions {
  defaultInclude?: QueryIncludeMode;
}

interface QueryOptions {
  include: QueryIncludeMode;
}

interface TrueNode {
  type: 'true';
}

type QueryNode = AndNode | NotNode | OrNode | PredicateNode | TrueNode;

const TRUE_NODE: TrueNode = { type: 'true' };

function extractOptions(source: string, defaultInclude: QueryIncludeMode): { options: QueryOptions; sourceWithoutOptions: string } {
  const options: QueryOptions = { include: defaultInclude };
  const sourceWithoutOptions = source.replace(/\binclude\s*:\s*(all|incomplete|locked)\b/gi, (_match, includeValue: string) => {
    options.include = includeValue.toLowerCase() as QueryOptions['include'];
    return '';
  });
  return { options, sourceWithoutOptions };
}

function isOperator(token: string): boolean {
  return /^(?:AND|OR|NOT|\(|\))$/i.test(token);
}

function tokenize(source: string): string[] {
  return source
    .replace(/\r?\n/g, ' ')
    .match(/\[\[[^\]]+\]\]|"[^"]*"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) ?? [];
}

function parsePredicate(tokens: string[], cursor: { index: number }): QueryNode {
  const token = tokens[cursor.index];
  if (!token || isOperator(token) || !token.includes(':')) {
    return TRUE_NODE;
  }
  cursor.index++;

  const separator = token.indexOf(':');
  const key = token.slice(0, separator).trim();
  let value = token.slice(separator + 1).trim();
  if (!value) {
    value = tokens[cursor.index] ?? '';
    cursor.index++;
  }
  if (/^NOT$/i.test(value) && /^EXISTS$/i.test(tokens[cursor.index] ?? '')) {
    value = 'NOT EXISTS';
    cursor.index++;
  }
  return { key, type: 'predicate', value };
}

function parseOperand(tokens: string[], cursor: { index: number }): QueryNode {
  const token = tokens[cursor.index];
  if (!token) {
    return TRUE_NODE;
  }
  if (/^NOT$/i.test(token)) {
    cursor.index++;
    return { node: parseOperand(tokens, cursor), type: 'not' };
  }
  if (token === '(') {
    cursor.index++;
    const node = parseOr(tokens, cursor);
    if (tokens[cursor.index] === ')') {
      cursor.index++;
    }
    return node;
  }
  return parsePredicate(tokens, cursor);
}

function parseAnd(tokens: string[], cursor: { index: number }): QueryNode {
  let node = parseOperand(tokens, cursor);
  while (/^AND$/i.test(tokens[cursor.index] ?? '')) {
    cursor.index++;
    node = { left: node, right: parseOperand(tokens, cursor), type: 'and' };
  }
  return node;
}

function parseOr(tokens: string[], cursor: { index: number }): QueryNode {
  let node = parseAnd(tokens, cursor);
  while (/^OR$/i.test(tokens[cursor.index] ?? '')) {
    cursor.index++;
    node = { left: node, right: parseAnd(tokens, cursor), type: 'or' };
  }
  return node;
}

function parseQuery(source: string, defaultInclude: QueryIncludeMode): { node: QueryNode; options: QueryOptions; warnings: string[] } {
  const { options, sourceWithoutOptions } = extractOptions(source, defaultInclude);
  const tokens = tokenize(sourceWithoutOptions);
  const cursor = { index: 0 };
  const node = tokens.length === 0 ? TRUE_NODE : parseOr(tokens, cursor);
  const warnings: string[] = [];
  // A clause the grammar cannot consume (e.g. a bare word without `key:`)
  // stops the parser cold; everything from that point on has no effect on the
  // results, which silently widens or narrows them. Surface it instead.
  if (tokens.length > 0 && cursor.index < tokens.length) {
    warnings.push(`Ignored query content starting at "${tokens.slice(cursor.index).join(' ')}": clauses must look like "key: value".`);
  }
  return { node, options, warnings };
}

function scalarValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => scalarValues(item));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return [];
}

function matchesPredicate(index: OntologyIndex, entity: OntologyEntity, predicate: PredicateNode): boolean {
  // Configured entity membership fields act as type predicates alongside the
  // built-in keys, so custom fields query the inheritance chain too.
  const typeKeys = new Set(['type', 'is-instance', ...index.settings.entityTypeFields]);
  if (typeKeys.has(predicate.key)) {
    return entityCompositionChain(entity, index).has(normalizeLinkTarget(predicate.value));
  }

  const value = entity.frontmatter[predicate.key];
  if (/^EXISTS$/i.test(predicate.value)) {
    return value !== undefined && value !== null && value !== '';
  }
  if (/^NOT EXISTS$/i.test(predicate.value)) {
    return value === undefined || value === null || value === '';
  }

  const expectedTarget = normalizeLinkTarget(predicate.value);
  if (extractAssertedLinkTargets(value).includes(expectedTarget)) {
    return true;
  }

  // Handle object/map values (e.g. influence-weight: { kant: 2, bataille: -2 })
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const mapValue = value as Record<string, unknown>;
    const cleanValue = predicate.value.replace(/^"|"$/g, '');
    const scale: Scale = index.scales.get(predicate.key) ?? DEFAULT_SCALE;

    // WEIGHTED: has at least one entry that isn't at the neutral value
    if (/^WEIGHTED$/i.test(cleanValue)) {
      const neutral = scaleNeutral(scale);
      return Object.values(mapValue).some((v) => v !== neutral);
    }

    // Key presence check (e.g. influence-weight: kant)
    if (cleanValue in mapValue || normalizeLinkTarget(cleanValue) in mapValue) {
      return true;
    }

    // Scale alias resolution with normalization (e.g. "influenced by kant" → "influenced" → 2)
    const resolved = resolveScaleAlias(scale, cleanValue);
    if (resolved !== undefined && Object.values(mapValue).some((v) => v === resolved)) {
      return true;
    }

    // Direct value match against map values
    return Object.values(mapValue).some((v) => String(v) === cleanValue);
  }

  const expectedScalar = predicate.value.replace(/^"|"$/g, '');
  return scalarValues(value).some((candidate) => candidate === expectedScalar);
}

function evaluateNode(index: OntologyIndex, entity: OntologyEntity, node: QueryNode): boolean {
  switch (node.type) {
    case 'and':
      return evaluateNode(index, entity, node.left) && evaluateNode(index, entity, node.right);
    case 'not':
      if (node.node.type === 'predicate') {
        const value = entity.frontmatter[node.node.key];
        const expectedTarget = normalizeLinkTarget(node.node.value);
        return hasNegatedTarget(value, expectedTarget) || !matchesPredicate(index, entity, node.node);
      }
      return !evaluateNode(index, entity, node.node);
    case 'or':
      return evaluateNode(index, entity, node.left) || evaluateNode(index, entity, node.right);
    case 'predicate':
      return matchesPredicate(index, entity, node);
    case 'true':
      return true;
  }
}

export interface OntologyQueryResult {
  entities: OntologyEntity[];
  warnings: string[];
}

export function runOntologyQuery(index: OntologyIndex, source: string, runOptions: RunQueryOptions = {}): OntologyEntity[] {
  return runOntologyQueryDetailed(index, source, runOptions).entities;
}

export function runOntologyQueryDetailed(index: OntologyIndex, source: string, runOptions: RunQueryOptions = {}): OntologyQueryResult {
  const { node, options, warnings } = parseQuery(source, runOptions.defaultInclude ?? 'locked');
  const entities = [...index.entities.values()]
    .filter((entity) => {
      // Ignored entities are fully indexed and validated but excluded from
      // query results unless the query opts in with include: ignored/all.
      if (entity.ignored && options.include !== 'ignored' && options.include !== 'all') {
        return false;
      }
      const lock = index.effectiveEntityLocks.get(entity.path)?.state ?? 'unlocked';
      if (options.include === 'locked' && lock !== 'locked') {
        return false;
      }
      if (options.include === 'incomplete' && lock === 'unlocked') {
        return false;
      }
      return evaluateNode(index, entity, node);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { entities, warnings };
}
