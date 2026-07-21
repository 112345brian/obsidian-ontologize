import type {
  App,
  TAbstractFile
} from 'obsidian';
import type {
  OntologizeAPI,
  RegisteredEntityAction
} from './ontology/scripting.ts';
import type {
  OntologyEntity,
  OntologyIndex
} from './ontology/types.ts';

import { ScriptHookRegistry } from './ontology/scripting.ts';
import { ScriptLoader } from './ScriptLoader.ts';
import { runOntologyQuery } from './ontology/query.ts';
import { TFile } from 'obsidian';

export class ScriptingService {
  private readonly registry = new ScriptHookRegistry();
  private readonly loader = new ScriptLoader();
  private api: OntologizeAPI | null = null;

  public get entityActions(): RegisteredEntityAction[] {
    return this.registry.entityActions;
  }

  public get hasEntityActions(): boolean {
    return this.registry.entityActions.length > 0;
  }

  public getApi(): OntologizeAPI | null {
    return this.api;
  }

  public initialize(app: App, getIndex: () => null | OntologyIndex): void {
    const registry = this.registry;
    this.api = {
      get index() {
        return getIndex()!;
      },
      query(queryString) {
        const index = getIndex();
        return index ? runOntologyQuery(index, queryString) : [];
      },
      issue(path, message, severity = 'warning') {
        const index = getIndex();
        if (index) {
          index.issues.push({ file: path, message, severity });
        }
      },
      async updateFrontmatter(path, update) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await app.fileManager.processFrontMatter(file, (fm) => {
            Object.assign(fm, update);
          });
        }
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        if (event === 'index:ready') registry.indexReadyHandlers.push(handler as typeof registry.indexReadyHandlers[number]);
        else if (event === 'entity:save') registry.entitySaveHandlers.push(handler as typeof registry.entitySaveHandlers[number]);
        else if (event === 'entity:validate') registry.entityValidateHandlers.push(handler as typeof registry.entityValidateHandlers[number]);
      },
      ui: {
        registerEntityAction(label, options) {
          registry.entityActions.push({ label, options });
        }
      }
    } as OntologizeAPI;
  }

  public isScriptEventFile(file: TAbstractFile, scriptsFolder: string): boolean {
    return 'path' in file && this.loader.isScriptFile(file.path as string, scriptsFolder);
  }

  public async reloadScripts(app: App, scriptsFolder: string | undefined, index: null | OntologyIndex): Promise<void> {
    this.registry.clear();
    await this.loadScripts(app, scriptsFolder, index);
  }

  public async loadScripts(app: App, scriptsFolder: string | undefined, index: null | OntologyIndex): Promise<void> {
    if (!scriptsFolder || !this.api) {
      return;
    }
    await this.loader.loadAll(app, scriptsFolder, this.api);
    if (index) {
      for (const handler of this.registry.indexReadyHandlers) {
        try {
          await handler(this.api);
        } catch (e) {
          console.error('Ontologize script index:ready error', e);
        }
      }
    }
  }

  public async fireEntitySave(entity: OntologyEntity): Promise<void> {
    if (!this.api) {
      return;
    }
    for (const handler of this.registry.entitySaveHandlers) {
      try {
        await handler(entity, this.api);
      } catch (e) {
        console.error('Ontologize script entity:save error', e);
      }
    }
  }

  public fireEntityValidate(entity: OntologyEntity): void {
    if (!this.api) {
      return;
    }
    for (const handler of this.registry.entityValidateHandlers) {
      try {
        handler(entity, this.api);
      } catch (e) {
        console.error('Ontologize script entity:validate error', e);
      }
    }
  }

  public fireEntityValidateAll(index: null | OntologyIndex): void {
    if (!index || !this.api || this.registry.entityValidateHandlers.length === 0) {
      return;
    }
    for (const entity of index.entities.values()) {
      this.fireEntityValidate(entity);
    }
  }
}
