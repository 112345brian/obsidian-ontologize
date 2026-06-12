import type { Scale } from './types.ts';

// Words stripped from alias phrases before comparison — makes "influenced by" match "influenced"
// without needing to enumerate every prepositional variant as an explicit alias.
export const DEFAULT_STRIP_WORDS = new Set([
  'a', 'an', 'the',
  'by', 'from', 'of', 'to', 'with', 'at', 'in', 'on',
  'into', 'onto', 'via', 'per',
]);

export function normalizeAlias(text: string, customStrip?: string[]): string {
  const strip = customStrip ? new Set(customStrip) : DEFAULT_STRIP_WORDS;
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !strip.has(w))
    .join(' ');
}

export const DEFAULT_SCALE: Scale = {
  max: 2,
  min: -2,
  neutral: 0,
  steps: {
    '2': ['high', 'strong', 'strongly', 'significant'],
    '1': ['moderate', 'somewhat', 'partial'],
    '0': ['neutral'],
    '-1': ['low', 'somewhat against'],
    '-2': ['strongly against', 'opposed'],
  },
};

// Resolves a user-provided alias to its numeric step. Returns undefined if unrecognized.
export function resolveScaleAlias(scale: Scale, input: string): number | undefined {
  const canonical = normalizeAlias(input, scale.normalize);
  for (const [numStr, aliases] of Object.entries(scale.steps)) {
    if (aliases.some((a) => normalizeAlias(a, scale.normalize) === canonical)) {
      const num = Number(numStr);
      return Number.isNaN(num) ? undefined : num;
    }
  }
  return undefined;
}

export function scaleNeutral(scale: Scale): number {
  return scale.neutral ?? 0;
}
