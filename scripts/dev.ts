import { context } from 'esbuild';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  plugins: [{ name: 'copy', setup(build) { build.onEnd(copyToVault); } }],
});

const stylesCtx = await context({
  entryPoints: [{ in: 'src/styles/main.scss', out: 'styles' }],
  loader: { '.scss': 'css' },
  logLevel: 'info',
  outdir: '.',
});

await Promise.all([ctx.watch(), stylesCtx.watch()]);

if (!pluginPath) {
  console.log('[ontologize] No OBSIDIAN_PLUGIN_PATH set in .env — skipping vault copy.');
}
