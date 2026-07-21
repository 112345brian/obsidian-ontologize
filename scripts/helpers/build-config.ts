import type { BuildOptions } from 'esbuild';

export const OBSIDIAN_EXTERNALS = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
] as const;

export const buildOptions: BuildOptions = {
  bundle: true,
  entryPoints: ['src/main.ts'],
  external: [...OBSIDIAN_EXTERNALS, 'node:*'],
  format: 'cjs',
  logLevel: 'info',
  outfile: 'main.js',
  platform: 'node',
  sourcemap: 'inline',
  target: 'ES2022',
  treeShaking: true,
};

export const stylesOptions: BuildOptions = {
  entryPoints: [{ in: 'src/styles/main.scss', out: 'styles' }],
  loader: { '.scss': 'css' },
  logLevel: 'info',
  outdir: '.',
};
