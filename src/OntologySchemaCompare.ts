import type { OntologyType } from './ontology/types.ts';

// Normalizes an OntologyType's schema fields (Maps → sorted objects, Sets/arrays →
// sorted arrays) for structural comparison, ignoring name/path so only the
// ontology-relevant frontmatter is considered.
function normalizeForSchemaCompare(type: OntologyType): unknown {
  const { name: _name, path: _path, ...rest } = type;
  const normalizeValue = (value: unknown): unknown => {
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizeValue(v)]));
    }
    if (value instanceof Set) {
      return [...value].sort();
    }
    if (Array.isArray(value)) {
      // Fields like disjoint/excludes/implements/alsoApply/requires/values/replaces are
      // semantically unordered — sort so reordering entries in frontmatter (no schema
      // change) doesn't register as a schema change and spuriously fire the locked-type
      // notice, matching the Set branch above.
      return value.map(normalizeValue).map((v) => JSON.stringify(v)).sort().map((v) => JSON.parse(v) as unknown);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizeValue(v)]));
    }
    return value;
  };
  return normalizeValue(rest);
}

export function hasOntologySchemaChange(previous: OntologyType, next: OntologyType): boolean {
  return JSON.stringify(normalizeForSchemaCompare(previous)) !== JSON.stringify(normalizeForSchemaCompare(next));
}
