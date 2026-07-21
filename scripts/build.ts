import { build, context } from 'esbuild';
import process from 'node:process';

import { buildOptions, stylesOptions } from './helpers/build-config.ts';

const isDev = process.argv[2] === 'dev';

if (isDev) {
  const ctx = await context(buildOptions);
  const stylesCtx = await context(stylesOptions);
  await Promise.all([ctx.watch(), stylesCtx.watch()]);
} else {
  await build(buildOptions);
  await build(stylesOptions);
}
