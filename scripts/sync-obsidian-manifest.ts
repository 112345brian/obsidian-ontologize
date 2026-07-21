import { readFileSync, writeFileSync } from 'node:fs';

// Run as release-it's after:bump hook — package.json's version has already
// been bumped by release-it's version plugin at this point. Obsidian reads
// the plugin version from manifest.json (not package.json), and versions.json
// maps every released version to its minimum required Obsidian app version.
function main(): void {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
  const newVersion = packageJson.version;

  const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8')) as Record<string, string>;
  manifest['version'] = newVersion;
  writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  const minObsidianVersion = manifest['minAppVersion'] ?? '0.15.0';
  const versions = JSON.parse(readFileSync('versions.json', 'utf-8')) as Record<string, string>;
  versions[newVersion] = minObsidianVersion;
  writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

  console.log(`Synced manifest.json and versions.json to v${newVersion}`);
}

main();
