import { readFileSync } from 'node:fs';

interface PackageJson {
  version: string;
}

interface ManifestJson {
  version: string;
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as ManifestJson;
const versions = JSON.parse(readFileSync('versions.json', 'utf8')) as Record<string, string>;

const failures: string[] = [];

if (manifest.version !== packageJson.version) {
  failures.push(`manifest.json version ${manifest.version} does not match package.json version ${packageJson.version}`);
}

if (!(packageJson.version in versions)) {
  failures.push(`versions.json is missing an entry for ${packageJson.version}`);
}

if (failures.length > 0) {
  throw new Error(failures.join('\n'));
}

console.log(`Version metadata is consistent for ${packageJson.version}.`);
