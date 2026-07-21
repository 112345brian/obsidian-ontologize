import type { OntologyType } from './ontology/types.ts';
import { normalizeForStructuralCompare } from './ontology/structural-compare.ts';

// Ignoring name/path so only the ontology-relevant schema fields are considered.
function normalizeForSchemaCompare(type: OntologyType): unknown {
  const { name: _name, path: _path, ...rest } = type;
  return normalizeForStructuralCompare(rest);
}

export function hasOntologySchemaChange(previous: OntologyType, next: OntologyType): boolean {
  return JSON.stringify(normalizeForSchemaCompare(previous)) !== JSON.stringify(normalizeForSchemaCompare(next));
}
