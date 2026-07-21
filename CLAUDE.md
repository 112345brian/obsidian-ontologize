# obsidian-ontologize

## Before writing a normalization/comparison/fingerprint helper

This codebase has repeatedly grown independent copies of the same "deep-normalize
a value for structural comparison" algorithm (sort Map/Set/array/object keys,
then compare or hash) — once for entity frontmatter, once for type schema
fingerprinting, once for locked-type change detection. They drifted apart in
subtle ways before being caught and consolidated into
[`src/ontology/structural-compare.ts`](src/ontology/structural-compare.ts).

Before adding new logic that normalizes, hashes, fingerprints, or diffs an
`OntologyType`, `OntologyEntity`, or frontmatter object:

1. Check `src/ontology/structural-compare.ts`'s `normalizeForStructuralCompare`
   first — reuse it unless you have a concrete, stated reason the semantics
   differ (e.g. `FrontmatterFingerprintService` intentionally treats arrays as
   order-*sensitive*, since frontmatter list order is often meaningful, while
   the shared normalizer treats arrays as order-*independent* for schema
   fields — this is a deliberate divergence, not an oversight, and is called
   out in that file).
2. If you need a "has this changed since last time" cache keyed by path
   (mirroring `FrontmatterFingerprintService`/`TypeSchemaFingerprintService`),
   don't hand-roll another `Map<string, string>` wrapper — check whether the
   existing services already cover the case, or generalize them, before
   adding a third one.
3. More generally: before adding any new file under `src/` or `src/ontology/`,
   grep for the operation you're about to implement (e.g. `grep -rn
   "normalizeFor\|Fingerprint" src/`) — this project has several small,
   similarly-named service files, and it's easy to duplicate one without
   noticing another already exists.
