import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';

vi.mock('obsidian', () => ({
  parseYaml: (source: string): unknown => parse(source) as unknown,
}));

import { buildOntologyIndex } from './indexer.ts';

const ROOT = process.env['ONTOLOGY_LIVE_VAULT_ROOT'] ?? '';
const SKIP = new Set(['.git', '.trash', '.versiondb', 'node_modules']);

function markdownFiles(root: string): TFile[] {
  const files: TFile[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.obsidian') || SKIP.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md'))
        files.push({ basename: basename(entry.name, '.md'), extension: 'md', path: relative(root, path) } as TFile);
    }
  };
  walk(root);
  return files;
}

function frontmatter(source: string): Record<string, unknown> {
  if (!source.trimStart().startsWith('---')) return {};
  const end = source.indexOf('\n---', 3);
  if (end === -1) return {};
  try { return (parse(source.slice(3, end)) as Record<string, unknown>) ?? {}; }
  catch { return {}; }
}

function vaultApp(root: string): App {
  const files = markdownFiles(root);
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter(readFileSync(join(root, file.path), 'utf8')) }),
    },
    vault: {
      adapter: { exists: () => Promise.resolve(false), read: (p: string) => Promise.resolve(readFileSync(join(root, p), 'utf8')) },
      getMarkdownFiles: () => files,
      getFileByPath: (p: string) => byPath.get(p) ?? null,
      read: (file: TFile) => Promise.resolve(readFileSync(join(root, file.path), 'utf8')),
    },
  } as unknown as App;
}

describe.skipIf(!ROOT)('live vault after fold + 3 new types', () => {
  it('reports counts', async () => {
    const index = await buildOntologyIndex(vaultApp(ROOT), {
      entityTypeFields: ['instance-of', 'is-instance', 'type'],
      schemaPath: '',
      typeFolder: 'config/_types',
    });
    const issues = index.issues ?? [];
    const errors = issues.filter((i) => i.severity === 'error');
    const schemaErr = (index.schemaIssues ?? []).filter((i) => i.severity === 'error');
    const tally = (arr: typeof issues) => {
      const t: Record<string, number> = {};
      for (const i of arr) {
        const key = i.property ?? i.message;
        t[key] = (t[key] ?? 0) + 1;
      }
      return Object.entries(t).sort((a, b) => b[1] - a[1]);
    };
    // recognized types check
    const typeNames = new Set([...(index.types?.keys?.() ?? [])]);
    // eslint-disable-next-line no-console
    console.log('\nnew types recognized -> reference:', typeNames.has('reference'), '| guide:', typeNames.has('guide'), '| prompt:', typeNames.has('prompt'));
    // eslint-disable-next-line no-console
    console.log('ERRORS:', errors.length, '| schemaErrors:', schemaErr.length, '| WARNINGS:', issues.filter((i) => i.severity === 'warning').length);
    // eslint-disable-next-line no-console
    console.log('error rules:', JSON.stringify(tally(errors)));
    // eslint-disable-next-line no-console
    console.log('PARTOF-ERR-FILES:', JSON.stringify(errors.filter((e) => e.property === 'part-of').map((e) => e.file)));
    expect(true).toBe(true);
  });
});
