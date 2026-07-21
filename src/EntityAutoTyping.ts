import type {
  App,
  TFile
} from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import {
  detectAutoApplyType,
  detectTypeFromField
} from './ontology/mutations.ts';
import { normalizeLinkTarget } from './ontology/links.ts';

export async function maybeStampAutoAppliedType(
  app: App,
  index: OntologyIndex,
  settings: PluginSettings,
  file: TFile
): Promise<boolean> {
  const rawFrontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const globalTypePath = index.globalType?.path;
  const globalFm = (globalTypePath ? app.metadataCache.getCache(globalTypePath)?.frontmatter : undefined) ?? {};
  const inferOverride = rawFrontmatter['infer-type-from-field'];
  const inferFromField = typeof inferOverride === 'boolean'
    ? inferOverride
    : (typeof globalFm['infer-type-from-field'] === 'boolean' ? globalFm['infer-type-from-field'] as boolean : false);
  const inferField = (typeof rawFrontmatter['infer-type-field'] === 'string' ? rawFrontmatter['infer-type-field'] : null)
    ?? (typeof globalFm['infer-type-field'] === 'string' ? globalFm['infer-type-field'] : null)
    ?? 'up';
  // ingest-from detection is handled by the indexer — no stamp needed.
  const matched = detectAutoApplyType(index, rawFrontmatter)
    ?? (inferFromField ? detectTypeFromField(index, rawFrontmatter, inferField) : null);
  if (!matched) {
    return false;
  }

  const ancestors = index.ancestorsByType.get(matched) ?? new Set<string>();
  let rootAncestor = matched;
  for (const ancestor of ancestors) {
    const ancestorType = index.types.get(ancestor);
    if (!ancestorType?.subtypeOf.some((parent) => index.types.has(parent))) {
      rootAncestor = ancestor;
      break;
    }
  }
  const matchedType = index.types.get(matched);
  const cascade = (matchedType?.alsoApply ?? []).filter((typeName) => index.types.has(typeName));
  await app.fileManager.processFrontMatter(file, (fm) => {
    const primaryField = settings.entityTypeFields?.[0] ?? 'is-instance';
    const existing = fm[primaryField];
    const currentTypes = new Set(
      (Array.isArray(existing) ? existing : existing != null ? [existing] : [])
        .map((value) => (typeof value === 'string' ? normalizeLinkTarget(value) : null))
        .filter((value): value is string => value !== null)
    );
    const toStamp = [matched, ...cascade.filter((typeName) => !currentTypes.has(typeName))];
    fm[primaryField] = toStamp.length === 1 ? `[[${toStamp[0]}]]` : toStamp.map((typeName) => `[[${typeName}]]`);
    const allTypeNames = new Set([matched, ...ancestors]);
    const existingUp: unknown[] = Array.isArray(fm['up'])
      ? fm['up'] as unknown[]
      : fm['up'] != null
      ? [fm['up']]
      : [];
    const kept = existingUp.filter((value) => {
      const target = typeof value === 'string' ? normalizeLinkTarget(value) : null;
      return target === null || !allTypeNames.has(target);
    });
    kept.push(`[[${rootAncestor}]]`);
    fm['up'] = kept.length === 1 ? kept[0] : kept;
  });

  return true;
}
