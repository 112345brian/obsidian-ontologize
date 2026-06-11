export function basenameWithoutExtension(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  return fileName.replace(/\.md$/i, '');
}

export function normalizeLinkTarget(value: string): string {
  const trimmed = value.trim();
  const withoutNot = trimmed.startsWith('NOT ') ? trimmed.slice(4).trim() : trimmed;
  const wikiMatch = /^\[\[([^|\]#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/.exec(withoutNot);
  const wikiTarget = wikiMatch?.[1];
  if (wikiTarget) {
    return basenameWithoutExtension(wikiTarget.trim());
  }
  return basenameWithoutExtension(withoutNot.replace(/\.md$/i, ''));
}

function extractTargets(value: unknown, mode: 'all' | 'asserted' | 'negated'): string[] {
  if (typeof value === 'string') {
    const isNegated = value.trim().startsWith('NOT ');
    if (mode === 'asserted' && isNegated) {
      return [];
    }
    if (mode === 'negated' && !isNegated) {
      return [];
    }
    return [normalizeLinkTarget(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTargets(item, mode));
  }
  if (value && typeof value === 'object' && 'target' in value) {
    return extractTargets(value.target, mode);
  }
  return [];
}

export function extractAssertedLinkTargets(value: unknown): string[] {
  return extractTargets(value, 'asserted');
}

export function extractAssertedWikiLinkTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('NOT ') || !/^\[\[[^\]]+\]\]$/.test(trimmed)) {
      return [];
    }
    return [normalizeLinkTarget(trimmed)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractAssertedWikiLinkTargets(item));
  }
  if (value && typeof value === 'object' && 'target' in value) {
    return extractAssertedWikiLinkTargets(value.target);
  }
  return [];
}

export function containsFrontmatterValue(value: unknown, inserted: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsFrontmatterValue(item, inserted));
  }
  if (typeof inserted === 'string') {
    const insertedTargets = extractAssertedWikiLinkTargets(inserted);
    if (insertedTargets.length > 0) {
      return insertedTargets.every((target) => extractAssertedWikiLinkTargets(value).includes(target));
    }
  }
  return JSON.stringify(value) === JSON.stringify(inserted);
}

export function extractLinkTargets(value: unknown): string[] {
  return extractTargets(value, 'all');
}

export function extractNegatedLinkTargets(value: unknown): string[] {
  return extractTargets(value, 'negated');
}

export function hasNegatedTarget(value: unknown, target: string): boolean {
  return extractNegatedLinkTargets(value).includes(target);
}

export function toWikiLink(name: string): string {
  return `[[${name}]]`;
}
