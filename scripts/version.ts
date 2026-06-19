import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const VERSION_ARG_INDEX = 2;

function main(): void {
  const versionUpdateType = process.argv[VERSION_ARG_INDEX];

  if (!versionUpdateType) {
    console.error('Usage: jiti scripts/version.ts <major|minor|patch|x.y.z>');
    process.exit(1);
  }

  execSync(`npm version ${versionUpdateType} --no-git-tag-version --allow-same-version`, { stdio: 'inherit' });

  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
  const newVersion = packageJson.version;

  // Sync version into manifest.json and versions.json
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8')) as Record<string, string>;
  manifest['version'] = newVersion;
  writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  const minObsidianVersion = manifest['minAppVersion'] ?? '0.15.0';
  const versions = JSON.parse(readFileSync('versions.json', 'utf-8')) as Record<string, string>;
  versions[newVersion] = minObsidianVersion;
  writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

  execSync('git add package.json manifest.json versions.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' });
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });

  console.log(`Tagged v${newVersion}`);
}

main();
