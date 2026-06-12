import type { OntologyEntity, OntologyIndex, OntologyIssue, OntologyType } from './types.ts';

import { recomputeOntologyDerivedState } from '../ontology/indexer.ts';

export interface TypeChangeImpact {
  /** New coherence violations (disjoint/excludes/requires) on non-ignored entities. */
  coherenceViolations: OntologyIssue[];
  /** Non-ignored entities that gain any new issues. */
  softBreaking: OntologyIssue[];
  /** Issues that will be resolved by the change. */
  softFixed: OntologyIssue[];
  /** New issues on already-ignored entities (informational only). */
  ignoredBreaking: OntologyIssue[];
  /** Total number of entities whose issue set changes. */
  affectedEntityCount: number;
}

function issueKey(issue: OntologyIssue): string {
  return `${issue.file}\0${issue.severity}\0${issue.message}\0${issue.property ?? ''}\0${issue.target ?? ''}`;
}

/**
 * Builds a shadow copy of `index` with `typeName` replaced by `proposedType`
 * (pass null to simulate removing the type), runs full derived-state recompute,
 * and returns the shadow. The original index is not mutated.
 */
export function buildShadowIndex(
  index: OntologyIndex,
  typeName: string,
  proposedType: OntologyType | null,
): OntologyIndex {
  const shadowTypes = new Map(index.types);
  if (proposedType) {
    shadowTypes.set(typeName, proposedType);
  } else {
    shadowTypes.delete(typeName);
  }

  const shadow: OntologyIndex = {
    ...index,
    effectiveEntityLocks: new Map(),
    effectiveTypeLocks: new Map(),
    issues: [],
    schemaIssues: [],
    types: shadowTypes,
  };

  recomputeOntologyDerivedState(shadow);
  return shadow;
}

/**
 * Compares `currentIndex` to a shadow built with the proposed type change and
 * returns a categorised impact summary.
 */
export function analyzeTypeChange(
  currentIndex: OntologyIndex,
  typeName: string,
  proposedType: OntologyType | null,
): TypeChangeImpact {
  const shadow = buildShadowIndex(currentIndex, typeName, proposedType);

  const currentKeys = new Set(currentIndex.issues.map(issueKey));
  const shadowKeys = new Set(shadow.issues.map(issueKey));

  const ignoredPaths = new Set(
    [...currentIndex.entities.values()].filter((e) => e.ignored).map((e: OntologyEntity) => e.path),
  );

  const gained = shadow.issues.filter((i) => !currentKeys.has(issueKey(i)));
  const fixed = currentIndex.issues.filter((i) => !shadowKeys.has(issueKey(i)));

  const coherenceViolations = gained.filter((i) => i.kind === 'coherence' && !ignoredPaths.has(i.file));
  const softBreaking = gained.filter((i) => i.kind !== 'coherence' && !ignoredPaths.has(i.file));
  const ignoredBreaking = gained.filter((i) => ignoredPaths.has(i.file));
  const softFixed = fixed.filter((i) => !ignoredPaths.has(i.file));

  const affectedFiles = new Set([
    ...gained.filter((i) => !ignoredPaths.has(i.file)).map((i) => i.file),
    ...softFixed.map((i) => i.file),
  ]);

  return {
    affectedEntityCount: affectedFiles.size,
    coherenceViolations,
    ignoredBreaking,
    softBreaking,
    softFixed,
  };
}
