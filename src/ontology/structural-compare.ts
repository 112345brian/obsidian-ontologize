// Normalizes a value (Maps → sorted objects, Sets/arrays → order-independent sorted
// arrays, plain objects → key-sorted) so two structurally-equal-but-differently-ordered
// values produce identical JSON.stringify output. Shared by every fingerprint/comparison
// consumer that needs to answer "did this object meaningfully change" — frontmatter
// fingerprinting, type-schema fingerprinting, and locked-type schema-change detection all
// need the exact same normalization, and previously each hand-rolled its own copy.
export function normalizeForStructuralCompare(value: unknown): unknown {
  if (value instanceof Map) {
    const entries = [...(value as Map<string, unknown>).entries()];
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalizeForStructuralCompare(item)]));
  }
  if (value instanceof Set) {
    return [...value].sort();
  }
  if (Array.isArray(value)) {
    // Order-independent: sort by stringified form so reordering entries in frontmatter
    // (no semantic change) doesn't register as a change.
    return value.map(normalizeForStructuralCompare).map((item) => JSON.stringify(item)).sort().map((item) => JSON.parse(item) as unknown);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeForStructuralCompare(item)])
    );
  }
  return value;
}
