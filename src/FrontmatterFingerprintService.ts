function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint);
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

export function frontmatterFingerprint(frontmatter: Record<string, unknown> | undefined): string {
  return JSON.stringify(normalizeForFingerprint(frontmatter ?? {}));
}

export class FrontmatterFingerprintService {
  private readonly fingerprints = new Map<string, string>();

  public seed(entries: Iterable<{ frontmatter: Record<string, unknown>; path: string }>): void {
    this.fingerprints.clear();
    for (const entry of entries) {
      this.record(entry.path, entry.frontmatter);
    }
  }

  public record(path: string, frontmatter: Record<string, unknown> | undefined): void {
    this.fingerprints.set(path, frontmatterFingerprint(frontmatter));
  }

  public forget(path: string): void {
    this.fingerprints.delete(path);
  }

  public hasChanged(path: string, frontmatter: Record<string, unknown> | undefined): boolean {
    return this.fingerprints.get(path) !== frontmatterFingerprint(frontmatter);
  }
}
