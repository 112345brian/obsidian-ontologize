import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';

vi.mock('obsidian', () => ({
  parseYaml: (source: string): unknown => parse(source) as unknown,
}));

import { buildOntologyIndex } from './indexer.ts';

const ROOT = process.env['ONTOLOGY_EXAMPLE_ROOT'] ?? join(process.cwd(), 'demo-vault');

function markdownFiles(root: string): TFile[] {
  const files: TFile[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.obsidian') {
          walk(path);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({
          basename: basename(entry.name, '.md'),
          extension: 'md',
          path: relative(root, path),
        } as TFile);
      }
    }
  };
  for (const folder of ['_types', 'ONTOLOGY DEMO']) {
    walk(join(root, folder));
  }
  return files;
}

function frontmatter(source: string): Record<string, unknown> {
  if (!source.trimStart().startsWith('---')) {
    return {};
  }
  const end = source.indexOf('\n---', 3);
  return end === -1 ? {} : parse(source.slice(3, end)) as Record<string, unknown>;
}

function exampleApp(root: string): App {
  const files = markdownFiles(root);
  return {
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter(readFileSync(join(root, file.path), 'utf8')) }),
    },
    vault: {
      adapter: {
        exists: () => Promise.resolve(false),
      },
      getMarkdownFiles: () => files,
      read: (file: TFile) => Promise.resolve(readFileSync(join(root, file.path), 'utf8')),
    },
  } as unknown as App;
}

describe('example vault schema', () => {
  it('lints and builds without schema errors', async () => {
    const index = await buildOntologyIndex(exampleApp(ROOT), {
      entityTypeFields: ['is-instance', 'type'],
      schemaPath: '',
      typeFolder: '_types',
    });

    expect(index.schemaIssues?.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(index.issues.filter((issue) => issue.file.startsWith('_types/') && issue.severity === 'error')).toEqual([]);
    const unexpectedEntityErrors = index.issues.filter((issue) => !issue.file.startsWith('_types/') && issue.severity === 'error');
    expect(unexpectedEntityErrors).toEqual([]);
    const relationWarnings = index.issues.filter((issue) => issue.autofixable);
    expect(relationWarnings).toHaveLength(2);
    expect(relationWarnings.every((issue) => issue.property === 'companion-of' && issue.target === 'Charles Darwin')).toBe(true);
  });
});
