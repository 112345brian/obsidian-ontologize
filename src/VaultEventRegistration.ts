import type {
  App,
  Plugin as ObsidianPlugin,
  TAbstractFile,
  TFile
} from 'obsidian';
import type { ScriptingService } from './ScriptingService.ts';

export interface VaultEventHandlers {
  getScriptsFolder: () => string | undefined;
  handleMetadataChanged: (file: TFile) => Promise<unknown>;
  handleVaultCreate: (file: TAbstractFile) => Promise<unknown>;
  handleVaultDelete: (file: TAbstractFile) => Promise<unknown>;
  handleVaultModify: (file: TAbstractFile) => Promise<unknown>;
  handleVaultRename: (file: TAbstractFile, oldPath: string) => Promise<unknown>;
  reloadScripts: () => Promise<void>;
  runEventTask: (task: Promise<unknown>) => void;
}

export function registerVaultEvents(
  plugin: ObsidianPlugin,
  app: App,
  scriptingService: ScriptingService,
  handlers: VaultEventHandlers
): void {
  plugin.registerEvent(app.metadataCache.on('changed', (file) => {
    handlers.runEventTask(handlers.handleMetadataChanged(file));
  }));
  plugin.registerEvent(app.vault.on('create', (file) => {
    handlers.runEventTask(handlers.handleVaultCreate(file));
  }));
  plugin.registerEvent(app.vault.on('delete', (file) => {
    handlers.runEventTask(handlers.handleVaultDelete(file));
  }));
  plugin.registerEvent(app.vault.on('modify', (file) => {
    handlers.runEventTask(handlers.handleVaultModify(file));
  }));
  plugin.registerEvent(app.vault.on('rename', (file, oldPath) => {
    handlers.runEventTask(handlers.handleVaultRename(file, oldPath));
  }));

  plugin.registerEvent(app.vault.on('create', (file) => {
    const scriptsFolder = handlers.getScriptsFolder();
    if (scriptsFolder && scriptingService.isScriptEventFile(file, scriptsFolder)) {
      handlers.runEventTask(handlers.reloadScripts());
    }
  }));
  plugin.registerEvent(app.vault.on('modify', (file) => {
    const scriptsFolder = handlers.getScriptsFolder();
    if (scriptsFolder && scriptingService.isScriptEventFile(file, scriptsFolder)) {
      handlers.runEventTask(handlers.reloadScripts());
    }
  }));
  plugin.registerEvent(app.vault.on('delete', (file) => {
    const scriptsFolder = handlers.getScriptsFolder();
    if (scriptsFolder && scriptingService.isScriptEventFile(file, scriptsFolder)) {
      handlers.runEventTask(handlers.reloadScripts());
    }
  }));
}
