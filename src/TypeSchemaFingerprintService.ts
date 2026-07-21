import type { OntologyType } from './ontology/types.ts';
import { normalizeForStructuralCompare } from './ontology/structural-compare.ts';

export function typeSchemaFingerprint(type: OntologyType): string {
  const { name: _name, path: _path, ...schema } = type;
  return JSON.stringify(normalizeForStructuralCompare(schema));
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
