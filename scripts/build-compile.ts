import { build } from 'esbuild';

import { buildOptions, stylesOptions } from './helpers/build-config.ts';

await build(buildOptions);
await build(stylesOptions);
