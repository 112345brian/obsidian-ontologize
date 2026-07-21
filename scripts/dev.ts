import { context } from 'esbuild';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOptions, stylesOptions } from './helpers/build-config.ts';

function loadEnv(): Record<string, string> {
  const envPath = resolve('.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return [];
        const eq = trimmed.indexOf('=');
        if (eq === -1) return [];
        return [[trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()]];
      }),
  );
}

const env = loadEnv();
const pluginPath = env['OBSIDIAN_PLUGIN_PATH'];

function copyToVault(): void {
  if (!pluginPath) return;
  for (const file of ['main.js', 'styles.css', 'manifest.json'] as const) {
    copyFileSync(file, `${pluginPath}/${file}`);
  }
  console.log(`[ontologize] copied to ${pluginPath}`);
}

const ctx = await context({
  ...buildOptions,
  plugins: [{ name: 'copy', setup(build) { build.onEnd(copyToVault); } }],
});

const stylesCtx = await context(stylesOptions);

await Promise.all([ctx.watch(), stylesCtx.watch()]);

if (!pluginPath) {
  console.log('[ontologize] No OBSIDIAN_PLUGIN_PATH set in .env — skipping vault copy.');
}
