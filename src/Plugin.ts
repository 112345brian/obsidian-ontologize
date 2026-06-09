import type { MarkdownPostProcessorContext, TAbstractFile } from 'obsidian';

import { MarkdownRenderer, Notice, Plugin as ObsidianPlugin, TFile } from 'obsidian';

import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import { readOntologyCache, writeOntologyCache } from './ontology/cache.ts';
import {
  buildOntologyIndex,
  isIgnoredOntologyPath,
  isOntologyTypeFile,
  removeOntologyFile,
  upsertOntologyFile
} from './ontology/indexer.ts';
import { fixMissingInverses, scaffoldEntity } from './ontology/mutations.ts';
import { runOntologyQuery } from './ontology/query.ts';
import { PluginSettings as PluginSettingsClass } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

const CACHE_WRITE_DEBOUNCE_MS = 800;

export class Plugin extends ObsidianPlugin {
  public index: null | OntologyIndex = null;
  public pluginSettings: PluginSettings = new PluginSettingsClass();

  private cacheWriteTimer: null | number = null;
  private isAutoFixingInverses = false;

  public override async onload(): Promise<void> {
    this.pluginSettings = Object.assign(new PluginSettingsClass(), await this.loadData());
    this.index = await readOntologyCache(this.app, this.pluginSettings.cachePath);

    this.registerMarkdownCodeBlockProcessor('ontology-query', this.renderQueryBlock.bind(this));

    this.addCommand({
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.showActiveFileIssues(file);
        }
        return true;
      },
      id: 'check-active-note',
      name: 'Check active ontology note',
    });

    this.addCommand({
      callback: () => { void this.rebuildIndex(true); },
      id: 'rebuild-index',
      name: 'Rebuild ontology index',
    });

    this.addCommand({
      callback: () => { this.showValidationSummary(); },
      id: 'check-consistency',
      name: 'Check ontology consistency',
    });

    this.addCommand({
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.scaffoldActiveNote(file);
        }
        return true;
      },
      id: 'scaffold-active-note',
      name: 'Scaffold active ontology note',
    });

    this.addCommand({
      callback: () => { void this.fixInverses(); },
      id: 'fix-missing-inverses',
      name: 'Fix missing inverse relations',
    });

    this.registerEvent(this.app.metadataCache.on('changed', (file) => { void this.handleMetadataChanged(file); }));
    this.registerEvent(this.app.vault.on('create', (file) => { void this.handleVaultCreate(file); }));
    this.registerEvent(this.app.vault.on('delete', (file) => { this.handleVaultDelete(file); }));
    this.registerEvent(this.app.vault.on('modify', (file) => { void this.handleVaultModify(file); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.handleVaultRename(file, oldPath); }));
    this.addSettingTab(new PluginSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => { void this.rebuildIndex(false); });
  }

  public override onunload(): void {
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
    }
  }

  public async savePluginSettings(): Promise<void> {
    await this.saveData(this.pluginSettings);
    await this.rebuildIndex(false);
  }

  public async rebuildIndex(showNotice: boolean): Promise<void> {
    this.index = await buildOntologyIndex(this.app, this.indexSettings());
    await writeOntologyCache(this.app, this.pluginSettings.cachePath, this.index);

    let autoFixedInverses = 0;
    if (this.pluginSettings.autoUpdateInverses && !this.isAutoFixingInverses) {
      this.isAutoFixingInverses = true;
      try {
        autoFixedInverses = await fixMissingInverses(this.app, this.index, { onlyAutoUpdate: true });
        if (autoFixedInverses > 0) {
          this.index = await buildOntologyIndex(this.app, {
            filesToIgnore: this.pluginSettings.filesToIgnore,
            foldersToIgnore: this.pluginSettings.foldersToIgnore,
            frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
            typeFolder: this.pluginSettings.typeFolder,
          });
          await writeOntologyCache(this.app, this.pluginSettings.cachePath, this.index);
        }
      } finally {
        this.isAutoFixingInverses = false;
      }
    }

    if (showNotice) {
      const autoFixText = autoFixedInverses > 0 ? `, ${autoFixedInverses} inverse updates` : '';
      new Notice(`Ontology index rebuilt: ${this.index.types.size} types, ${this.index.entities.size} entities, ${this.index.issues.length} issues${autoFixText}.`);
    }
  }

  private async applyAutoInverseUpdates(): Promise<number> {
    if (!this.index || !this.pluginSettings.autoUpdateInverses || this.isAutoFixingInverses) {
      return 0;
    }

    this.isAutoFixingInverses = true;
    try {
      const fixed = await fixMissingInverses(this.app, this.index, { onlyAutoUpdate: true });
      if (fixed > 0) {
        this.index = await buildOntologyIndex(this.app, {
          filesToIgnore: this.pluginSettings.filesToIgnore,
          foldersToIgnore: this.pluginSettings.foldersToIgnore,
          frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
          typeFolder: this.pluginSettings.typeFolder,
        });
      }
      return fixed;
    } finally {
      this.isAutoFixingInverses = false;
    }
  }

  private async ensureIndex(): Promise<OntologyIndex> {
    if (!this.index) {
      await this.rebuildIndex(false);
    }
    return this.index!;
  }

  private async handleMetadataChanged(file: TFile): Promise<void> {
    if (isOntologyTypeFile(file, this.pluginSettings.typeFolder) || isIgnoredOntologyPath(file.path, this.indexSettings())) {
      return;
    }
    await this.upsertFile(file);
  }

  private async handleVaultCreate(file: TAbstractFile): Promise<void> {
    if (file instanceof TFile && isOntologyTypeFile(file, this.pluginSettings.typeFolder) && !isIgnoredOntologyPath(file.path, this.indexSettings())) {
      await this.upsertFile(file);
    }
  }

  private handleVaultDelete(file: TAbstractFile): void {
    if (!this.index || !('path' in file)) {
      return;
    }
    this.index = removeOntologyFile(this.index, file.path);
    this.scheduleCacheWrite();
  }

  private async handleVaultModify(file: TAbstractFile): Promise<void> {
    if (file instanceof TFile && isOntologyTypeFile(file, this.pluginSettings.typeFolder)) {
      await this.upsertFile(file);
    }
  }

  private async handleVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
    const index = await this.ensureIndex();
    this.index = removeOntologyFile(index, oldPath);
    if (file instanceof TFile) {
      await this.upsertFile(file);
      return;
    }
    this.scheduleCacheWrite();
  }

  private scheduleCacheWrite(): void {
    if (!this.index) {
      return;
    }
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
    }
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.index) {
        void writeOntologyCache(this.app, this.pluginSettings.cachePath, this.index);
      }
    }, CACHE_WRITE_DEBOUNCE_MS);
  }

  private async upsertFile(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    this.index = await upsertOntologyFile(this.app, index, file, {
      filesToIgnore: this.pluginSettings.filesToIgnore,
      foldersToIgnore: this.pluginSettings.foldersToIgnore,
      frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
      typeFolder: this.pluginSettings.typeFolder,
    });
    await this.applyAutoInverseUpdates();
    this.scheduleCacheWrite();
  }

  private async renderQueryBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const index = await this.ensureIndex();
    const querySource = this.pluginSettings.queryOnlyLocked && !/\binclude:\s*/i.test(source)
      ? `${source}\ninclude: locked`
      : source;
    const results = runOntologyQuery(index, querySource);

    el.empty();
    el.addClass('ontology-query-results');

    if (results.length === 0) {
      el.createEl('p', { cls: 'ontology-query-empty', text: 'No matching ontology notes.' });
      return;
    }

    const table = el.createEl('table');
    const header = table.createEl('thead').createEl('tr');
    header.createEl('th', { text: 'Note' });
    header.createEl('th', { text: 'Types' });
    header.createEl('th', { text: 'Lock' });

    const body = table.createEl('tbody');
    for (const entity of results) {
      const row = body.createEl('tr');
      const noteCell = row.createEl('td');
      await MarkdownRenderer.render(this.app, `[[${entity.name}]]`, noteCell, ctx.sourcePath, this);
      row.createEl('td', { text: entity.instanceOf.join(', ') });
      row.createEl('td', { text: index.effectiveEntityLocks.get(entity.path)?.state ?? 'unlocked' });
    }
  }

  private showValidationSummary(): void {
    if (!this.index) {
      new Notice('Ontology index is not ready yet.');
      return;
    }
    const errors = this.index.issues.filter((issue) => issue.severity === 'error').length;
    const warnings = this.index.issues.length - errors;
    new Notice(`Ontology consistency: ${errors} errors, ${warnings} warnings.`);
    console.table(this.index.issues);
  }

  private indexSettings(): {
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: PluginSettings['frontmatterIgnoreRules'];
    typeFolder: string;
  } {
    return {
      filesToIgnore: this.pluginSettings.filesToIgnore,
      foldersToIgnore: this.pluginSettings.foldersToIgnore,
      frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
      typeFolder: this.pluginSettings.typeFolder,
    };
  }

  private async showActiveFileIssues(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    if (isIgnoredOntologyPath(file.path, this.indexSettings())) {
      new Notice('Active note is ignored by ontology settings.');
      return;
    }

    const issues = index.issues.filter((issue) => issue.file === file.path);
    if (issues.length === 0) {
      new Notice('Active note has no ontology issues.');
      return;
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    new Notice(`Active note ontology: ${errors} errors, ${warnings} warnings.`);
    console.table(issues);
  }

  private async scaffoldActiveNote(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    const added = await scaffoldEntity(this.app, index, file);
    new Notice(`Ontology scaffold added ${added} fields.`);
    await this.rebuildIndex(false);
  }

  private async fixInverses(): Promise<void> {
    const index = await this.ensureIndex();
    const fixed = await fixMissingInverses(this.app, index);
    new Notice(`Ontology fixed ${fixed} inverse relation entries.`);
    await this.rebuildIndex(false);
  }
}
