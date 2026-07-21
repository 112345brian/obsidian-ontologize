import type { OntologyType } from './ontology/types.ts';

function normalizeForFingerprint(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalizeForFingerprint(item)]));
  }
  if (value instanceof Set) {
    return [...value].sort();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint).map((item) => JSON.stringify(item)).sort().map((item) => JSON.parse(item) as unknown);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeForFingerprint(item)])
    );
  }
  return value;
}

export function typeSchemaFingerprint(type: OntologyType): string {
  const { name: _name, path: _path, ...schema } = type;
  return JSON.stringify(normalizeForFingerprint(schema));
}

export class TypeSchemaFingerprintService {
  private readonly fingerprints = new Map<string, string>();

  public seed(types: Iterable<OntologyType>): void {
    this.fingerprints.clear();
    for (const type of types) {
      this.record(type);
    }
  }

  public record(type: OntologyType): void {
    this.fingerprints.set(type.path, typeSchemaFingerprint(type));
  }

  public forget(path: string): void {
    this.fingerprints.delete(path);
  }

  public hasChanged(type: OntologyType): boolean {
    return this.fingerprints.get(type.path) !== typeSchemaFingerprint(type);
  }
}
