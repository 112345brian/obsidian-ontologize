import type { BuildOptions } from 'esbuild';

import { build, context } from 'esbuild';
import process from 'node:process';

const OBSIDIAN_EXTERNALS = [
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
];

const buildOptions: BuildOptions = {
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

const stylesOptions: BuildOptions = {
  entryPoints: [{ in: 'src/styles/main.scss', out: 'styles' }],
  loader: { '.scss': 'css' },
  logLevel: 'info',
  outdir: '.',
};

const isDev = process.argv[2] === 'dev';

if (isDev) {
  const ctx = await context(buildOptions);
  const stylesCtx = await context(stylesOptions);
  await Promise.all([ctx.watch(), stylesCtx.watch()]);
} else {
  await build(buildOptions);
  await build(stylesOptions);
}
