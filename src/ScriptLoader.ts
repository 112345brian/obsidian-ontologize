import type { App, TFile } from 'obsidian';

import { Notice } from 'obsidian';

import type { OntologizeAPI } from './ontology/scripting.ts';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  arg: string,
  body: string,
) => (...args: unknown[]) => Promise<void>;

async function runScript(path: string, content: string, api: OntologizeAPI): Promise<void> {
  try {
    const fn = new AsyncFunction('ontologize', content);
    await fn(api);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Ontologize: error in script ${path}:`, error);
    new Notice(`Ontologize script error in ${path}: ${detail}`);
  }
}

export class ScriptLoader {
  public async loadAll(app: App, scriptsFolder: string, api: OntologizeAPI): Promise<void> {
    const scripts = app.vault.getFiles().filter(
      (f) => f.path.startsWith(`${scriptsFolder}/`) && f.extension === 'js',
    );
    for (const file of scripts) {
      await this.loadFile(app, file, api);
    }
  }

  public async loadFile(app: App, file: TFile, api: OntologizeAPI): Promise<void> {
    const content = await app.vault.read(file);
    await runScript(file.path, content, api);
  }

  public isScriptFile(path: string, scriptsFolder: string): boolean {
    return path.startsWith(`${scriptsFolder}/`) && path.endsWith('.js');
  }
}
