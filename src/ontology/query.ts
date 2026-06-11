import type { OntologyEntity, OntologyIndex } from './types.ts';

import { entityCompositionChain } from './compose.ts';
import { extractAssertedLinkTargets, hasNegatedTarget, normalizeLinkTarget } from './links.ts';

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

export type QueryIncludeMode = 'all' | 'incomplete' | 'locked';

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

function parseQuery(source: string, defaultInclude: QueryIncludeMode): { node: QueryNode; options: QueryOptions } {
  const { options, sourceWithoutOptions } = extractOptions(source, defaultInclude);
  const tokens = tokenize(sourceWithoutOptions);
  return {
    node: tokens.length === 0 ? TRUE_NODE : parseOr(tokens, { index: 0 }),
    options,
  };
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

export function runOntologyQuery(index: OntologyIndex, source: string, runOptions: RunQueryOptions = {}): OntologyEntity[] {
  const { node, options } = parseQuery(source, runOptions.defaultInclude ?? 'locked');
  return [...index.entities.values()]
    .filter((entity) => {
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
}
