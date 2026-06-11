import type { MarkdownPostProcessorContext, TAbstractFile } from 'obsidian';

import { MarkdownRenderer, normalizePath, Notice, Plugin as ObsidianPlugin, stringifyYaml, TFile } from 'obsidian';

import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import { readOntologyCache, writeOntologyCache } from './ontology/cache.ts';
import {
  buildOntologyIndex,
  isIgnoredOntologyPath,
  isOntologySchemaFile,
  isOntologyTypeFile,
  removeOntologyFile,
  upsertOntologyFile
} from './ontology/indexer.ts';
import { applyMissingInversePlans, applyScaffoldPlan, fixMissingInverses, planMissingInverses, planScaffoldEntity, shouldAutoApplyScaffold } from './ontology/mutations.ts';
import type { TypeReplacement } from './ontology/types.ts';
import { normalizeLinkTarget } from './ontology/links.ts';
import { runOntologyQuery } from './ontology/query.ts';
import { summarizeIssues } from './ontology/issues.ts';
import { OntologyIssuesModal } from './OntologyIssuesModal.ts';
import { OntologyRelationFixModal } from './OntologyRelationFixModal.ts';
import { OntologyScaffoldReviewModal } from './OntologyScaffoldReviewModal.ts';
import { OntologySchemaDiagnosticsModal } from './OntologySchemaDiagnosticsModal.ts';
import { OntologyTypeEditorModal } from './OntologyTypeEditorModal.ts';
import { OntologyBulkScaffoldModal } from './OntologyBulkScaffoldModal.ts';
import { OntologyTypeLibraryModal } from './OntologyTypeLibraryModal.ts';
import { OntologyTypePickerModal, OntologyTypeWizardModal } from './OntologyTypeWizardModal.ts';
import { emptyTypeEditorModel, TYPE_EDITOR_KEYS, typeEditorFrontmatter, typeEditorModelFromType } from './ontology/type-editor.ts';
import type { TypeEditorModel } from './ontology/type-editor.ts';
import { applyTypeTemplate } from './templater.ts';
import { PluginSettings as PluginSettingsClass } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

const CACHE_WRITE_DEBOUNCE_MS = 800;

export class Plugin extends ObsidianPlugin {
  public index: null | OntologyIndex = null;
  public pluginSettings: PluginSettings = new PluginSettingsClass();

  private cacheWriteTimer: null | number = null;
  private indexReady = false;
  private indexTask: Promise<unknown> = Promise.resolve();
  private isAutoFixingInverses = false;
  // Paths whose scaffold review was closed without the membership changing
  // since; auto-scaffold stays quiet for them until the entity's types change.
  private scaffoldDismissedPaths = new Set<string>();
  private scaffoldReviewOpenPaths = new Set<string>();

  public override async onload(): Promise<void> {
    this.pluginSettings = Object.assign(new PluginSettingsClass(), await this.loadData());
    const cachedIndex = await readOntologyCache(this.app, this.pluginSettings.cachePath);
    // A cache built under different scoping settings describes a different graph;
    // hydrating it would let pre-rebuild reads see files the user has since
    // ignored (or miss files they un-ignored). Wait for the cold rebuild instead.
    this.index = cachedIndex && JSON.stringify(cachedIndex.settings) === JSON.stringify(this.indexSettings()) ? cachedIndex : null;

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
      callback: () => { void this.openIssuesModal(); },
      id: 'open-issues',
      name: 'Open ontology issues',
    });

    this.addCommand({
      callback: () => { void this.openSchemaDiagnosticsModal(); },
      id: 'open-schema-diagnostics',
      name: 'Open ontology schema diagnostics',
    });

    this.addCommand({
      callback: () => {
        void this.rebuildIndex(false).then(() => this.openSchemaDiagnosticsModal());
      },
      id: 'lint-schema',
      name: 'Lint ontology schema',
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
      callback: () => { void this.openRelationFixModal(); },
      id: 'fix-missing-inverses',
      name: 'Fix missing inverse relations',
    });

    this.addCommand({
      callback: () => { void this.openTypeLibraryModal(); },
      id: 'browse-ontology-types',
      name: 'Browse ontology types',
    });

    this.addCommand({
      callback: () => { void this.openCreateTypeModal(); },
      id: 'create-ontology-type',
      name: 'Create ontology type',
    });

    this.addCommand({
      callback: () => { void this.scaffoldAllEntities(); },
      id: 'scaffold-all-entities',
      name: 'Scaffold all ontology entities',
    });

    this.addCommand({
      callback: () => { void this.openBulkScaffoldModal(); },
      id: 'bulk-scaffold-type',
      name: 'Bulk scaffold entities of type',
    });

    this.addCommand({
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isOntologyTypeFile(file, this.pluginSettings.typeFolder)) {
          return false;
        }
        if (!checking) {
          void this.openEditTypeModal(file);
        }
        return true;
      },
      id: 'edit-active-ontology-type',
      name: 'Edit active ontology type',
    });

    this.registerEvent(this.app.metadataCache.on('changed', (file) => { void this.handleMetadataChanged(file); }));
    this.registerEvent(this.app.vault.on('create', (file) => { void this.handleVaultCreate(file); }));
    this.registerEvent(this.app.vault.on('delete', (file) => { void this.handleVaultDelete(file); }));
    this.registerEvent(this.app.vault.on('modify', (file) => { void this.handleVaultModify(file); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.handleVaultRename(file, oldPath); }));
    this.addSettingTab(new PluginSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.rebuildIndex(false).finally(() => { this.indexReady = true; });
    });
  }

  /**
   * Serializes every operation that assigns `this.index` so a long-running
   * incremental update cannot resolve after a full rebuild and clobber it with
   * a stale graph. Tasks run in submission order regardless of their duration.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.indexTask.then(task, task);
    this.indexTask = run.then(() => undefined, () => undefined);
    return run;
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
    await this.enqueue(() => this.buildAndStore(showNotice));
  }

  private async buildAndStore(showNotice: boolean): Promise<void> {
    this.index = await buildOntologyIndex(this.app, this.indexSettings());
    await writeOntologyCache(this.app, this.pluginSettings.cachePath, this.index);

    let autoFixedInverses = 0;
    if (this.pluginSettings.autoUpdateInverses) {
      autoFixedInverses = await this.runAutoInverseFix();
    }

    if (showNotice) {
      const autoFixText = autoFixedInverses > 0 ? `, ${autoFixedInverses} inverse updates` : '';
      new Notice(`Ontology index rebuilt: ${this.index.types.size} types, ${this.index.entities.size} entities, ${this.index.issues.length} issues${autoFixText}.`);
    }
  }

  public async openIssuesModal(file?: string): Promise<void> {
    const index = await this.ensureIndex();
    const issues = file ? index.issues.filter((issue) => issue.file === file) : index.issues;
    const summary = summarizeIssues(issues);
    new Notice(`Ontology issues: ${summary.errors} errors, ${summary.warnings} warnings.`);

    new OntologyIssuesModal(this.app, {
      getIssues: () => this.index?.issues ?? [],
      initialFilter: file ? { file } : undefined,
      onFixInverses: async () => {
        await this.openRelationFixModal();
      },
      onRebuild: async () => {
        await this.rebuildIndex(true);
      },
    }).open();
  }

  public async openRelationFixModal(): Promise<void> {
    const index = await this.ensureIndex();
    const plans = planMissingInverses(index);

    new OntologyRelationFixModal(this.app, {
      onApply: async (fixPlans) => applyMissingInversePlans(this.app, fixPlans),
      onDone: async () => {
        await this.rebuildIndex(false);
      },
      plans,
    }).open();
  }

  public async openSchemaDiagnosticsModal(): Promise<void> {
    await this.ensureIndex();
    new OntologySchemaDiagnosticsModal(this.app, {
      getIndex: () => this.index,
      onOpenIssues: async () => {
        await this.openIssuesModal();
      },
      onRebuild: async () => {
        await this.rebuildIndex(true);
      },
    }).open();
  }

  private async openTypeLibraryModal(): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyTypeLibraryModal(this.app, index, {
      onCreateNew: () => { void this.openCreateTypeModal(); },
      onCreateSubtype: (parent) => {
        const model = emptyTypeEditorModel();
        model.extends = [parent.name];
        this.openTypeEditorForCreate(model);
      },
      onEdit: (type) => {
        const file = this.app.vault.getFileByPath(type.path);
        if (file) { void this.openEditTypeModal(file); }
      },
      onOpenFile: (type) => {
        const file = this.app.vault.getFileByPath(type.path);
        if (file) { void this.app.workspace.getLeaf(false).openFile(file); }
      },
    }).open();
  }

  private async openCreateTypeModal(): Promise<void> {
    const index = await this.ensureIndex();
    const types = [...index.types.values()];
    new OntologyTypeWizardModal(this.app, types, (model) => {
      this.openTypeEditorForCreate(model);
    }).open();
  }

  private async removeTypeMemberships(file: TFile, replacements: TypeReplacement[]): Promise<void> {
    const defaultFields = this.pluginSettings.entityTypeFields;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const data = fm as Record<string, unknown>;
      for (const { value, field } of replacements) {
        const targets = field ? [field] : defaultFields;
        for (const key of targets) {
          const current = data[key];
          if (current === undefined || current === null) {
            continue;
          }
          if (typeof current === 'string') {
            if (normalizeLinkTarget(current) === value) {
              delete data[key];
            }
          } else if (Array.isArray(current)) {
            const filtered = current.filter((v) => normalizeLinkTarget(String(v)) !== value);
            if (filtered.length === 0) {
              delete data[key];
            } else if (filtered.length < current.length) {
              data[key] = filtered.length === 1 ? filtered[0] : filtered;
            }
          }
        }
      }
    });
  }

  private async applyBulkScaffoldDiffs(diffs: BulkScaffoldEntityDiff[]): Promise<number> {
    let totalFields = 0;
    for (const { path, plans } of diffs) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) {
        continue;
      }
      totalFields += await applyScaffoldPlan(this.app, file, plans);
    }
    if (totalFields > 0) {
      await this.rebuildIndex(false);
      new Notice(`Added ${totalFields} field${totalFields === 1 ? '' : 's'} across ${diffs.length} ${diffs.length === 1 ? 'entity' : 'entities'}.`);
    }
    return totalFields;
  }

  private async scaffoldAllEntities(): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyBulkScaffoldModal(this.app, index, async (diffs) => {
      const totalFields = await this.applyBulkScaffoldDiffs(diffs);
      this.pluginSettings.initialScaffoldComplete = true;
      await this.saveData(this.pluginSettings);
      if (totalFields === 0) {
        new Notice('All entities are already fully scaffolded.');
      }
      return totalFields;
    }).open();
  }

  private async openBulkScaffoldModal(): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyBulkScaffoldModal(this.app, index, async (diffs) => {
      return this.applyBulkScaffoldDiffs(diffs);
    }).open();
  }

  private openTypeEditorForCreate(preset: TypeEditorModel): void {
    new OntologyTypeEditorModal(this.app, {
      editing: false,
      model: preset,
      onSave: async (model) => {
        const folder = normalizePath(this.pluginSettings.typeFolder);
        const path = normalizePath(`${folder}/${model.name}.md`);
        if (await this.app.vault.adapter.exists(path)) {
          new Notice(`Ontology type already exists: ${path}`);
          return false;
        }
        if (!(await this.app.vault.adapter.exists(folder))) {
          await this.app.vault.adapter.mkdir(folder);
        }
        const source = `---\n${stringifyYaml(typeEditorFrontmatter(model))}---\n`;
        const file = await this.app.vault.create(path, source);
        await this.rebuildIndex(false);
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice(`Created ontology type ${model.name}.`);
        return true;
      },
    }).open();
  }

  private async openEditTypeModal(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    const type = [...index.types.values()].find((candidate) => candidate.path === file.path);
    if (!type) {
      new Notice('The active file is not a parsed ontology type.');
      return;
    }
    new OntologyTypeEditorModal(this.app, {
      editing: true,
      model: typeEditorModelFromType(type),
      onSave: async (model) => {
        const generated = typeEditorFrontmatter(model);
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          for (const key of TYPE_EDITOR_KEYS) {
            delete frontmatter[key];
          }
          Object.assign(frontmatter, generated);
        });
        await this.rebuildIndex(false);
        new Notice(`Updated ontology type ${model.name}.`);
        return true;
      },
    }).open();
  }

  /**
   * Incremental auto-fix path. Held back until the first full rebuild has run so
   * an early metadata event cannot trigger inverse writes against the stale
   * hydrated cache before the vault has been reconciled.
   */
  private async applyAutoInverseUpdates(): Promise<number> {
    if (!this.index || !this.pluginSettings.autoUpdateInverses || !this.indexReady) {
      return 0;
    }
    return this.runAutoInverseFix();
  }

  private canAutoScaffold(file: TFile): boolean {
    const entity = this.index?.entities.get(file.path);
    if (!this.index || !entity || entity.instanceOf.length === 0) {
      return false;
    }
    for (const typeName of entity.instanceOf) {
      const type = this.index.types.get(typeName);
      if (!type || type.abstract || type.isInterface || this.index.circularTypes?.has(typeName)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Fires only when an entity's ontology membership transitions (the caller
   * checks that), never on ordinary edits, and respects a prior dismissal so a
   * cancelled review does not reopen on the next keystroke.
   */
  private applyAutoScaffold(file: TFile): void {
    if (!this.index || !this.indexReady || !this.canAutoScaffold(file)) {
      return;
    }
    if (!this.pluginSettings.initialScaffoldComplete) {
      return;
    }
    if (this.scaffoldReviewOpenPaths.has(file.path) || this.scaffoldDismissedPaths.has(file.path)) {
      return;
    }

    const plans = planScaffoldEntity(this.index, file.path);
    if (plans.length === 0) {
      return;
    }

    const entity = this.index.entities.get(file.path);
    if (entity && shouldAutoApplyScaffold(this.index, entity)) {
      void applyScaffoldPlan(this.app, file, plans);
      return;
    }

    if (!this.pluginSettings.autoScaffoldEntities) {
      return;
    }
    new Notice(`Ontology scaffold available: ${plans.length} fields.`);
    this.openScaffoldReviewModal(file, plans);
  }

  private async runAutoInverseFix(): Promise<number> {
    if (!this.index || this.isAutoFixingInverses) {
      return 0;
    }
    this.isAutoFixingInverses = true;
    try {
      const fixed = await fixMissingInverses(this.app, this.index, { onlyAutoUpdate: true });
      if (fixed > 0) {
        this.index = await buildOntologyIndex(this.app, this.indexSettings());
        await writeOntologyCache(this.app, this.pluginSettings.cachePath, this.index);
      }
      return fixed;
    } finally {
      this.isAutoFixingInverses = false;
    }
  }

  private async ensureIndex(): Promise<OntologyIndex> {
    return this.enqueue(() => this.ensureIndexCore());
  }

  private async ensureIndexCore(): Promise<OntologyIndex> {
    if (!this.index) {
      await this.buildAndStore(false);
    }
    return this.index!;
  }

  private handleMetadataChanged(file: TFile): Promise<unknown> {
    return this.enqueue(async () => {
      if (isOntologySchemaFile(file, this.pluginSettings.schemaPath)) {
        await this.buildAndStore(false);
        return;
      }
      if (isOntologyTypeFile(file, this.pluginSettings.typeFolder) || isIgnoredOntologyPath(file.path, this.indexSettings())) {
        return;
      }
      await this.upsertFileCore(file);
    });
  }

  private handleVaultCreate(file: TAbstractFile): Promise<unknown> {
    return this.enqueue(async () => {
      if (file instanceof TFile && isOntologySchemaFile(file, this.pluginSettings.schemaPath)) {
        await this.buildAndStore(false);
        return;
      }
      if (file instanceof TFile && isOntologyTypeFile(file, this.pluginSettings.typeFolder) && !isIgnoredOntologyPath(file.path, this.indexSettings())) {
        await this.upsertFileCore(file);
      }
    });
  }

  private handleVaultDelete(file: TAbstractFile): Promise<unknown> {
    return this.enqueue(async () => {
      if (!('path' in file)) {
        return;
      }
      if (file.path === this.pluginSettings.schemaPath) {
        await this.buildAndStore(false);
        return;
      }
      if (!this.index) {
        return;
      }
      this.index = removeOntologyFile(this.index, file.path);
      this.scheduleCacheWrite();
    });
  }

  private handleVaultModify(file: TAbstractFile): Promise<unknown> {
    return this.enqueue(async () => {
      if (file instanceof TFile && isOntologySchemaFile(file, this.pluginSettings.schemaPath)) {
        await this.buildAndStore(false);
        return;
      }
      if (file instanceof TFile && isOntologyTypeFile(file, this.pluginSettings.typeFolder)) {
        await this.upsertFileCore(file);
      }
    });
  }

  private handleVaultRename(file: TAbstractFile, oldPath: string): Promise<unknown> {
    return this.enqueue(async () => {
      if ((file instanceof TFile && isOntologySchemaFile(file, this.pluginSettings.schemaPath)) || oldPath === this.pluginSettings.schemaPath) {
        await this.buildAndStore(false);
        return;
      }
      if (file instanceof TFile) {
        const index = await this.ensureIndexCore();
        this.index = removeOntologyFile(index, oldPath);
        await this.upsertFileCore(file);
        return;
      }
      // Folder rename: Obsidian does not reliably emit per-child events, so the
      // children's new paths are only discoverable with a full rebuild.
      await this.buildAndStore(false);
    });
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

  private async upsertFileCore(file: TFile): Promise<void> {
    const index = await this.ensureIndexCore();
    const membershipBefore = index.entities.get(file.path)?.instanceOf ?? [];
    this.index = await upsertOntologyFile(this.app, index, file, this.indexSettings());
    const membershipAfter = this.index.entities.get(file.path)?.instanceOf ?? [];

    const membershipChanged = membershipBefore.length !== membershipAfter.length
      || membershipBefore.some((typeName, position) => typeName !== membershipAfter[position]);
    if (membershipChanged) {
      this.scaffoldDismissedPaths.delete(file.path);
      if (membershipAfter.length > 0) {
        this.applyAutoScaffold(file);
        const addedTypes = membershipAfter.filter((t) => !membershipBefore.includes(t));
        const toReplace: TypeReplacement[] = [];
        let appliedTemplate = false;
        for (const typeName of addedTypes) {
          const type = this.index.types.get(typeName);
          for (const r of type?.replaces ?? []) {
            toReplace.push(r);
          }
          if (type?.template && !appliedTemplate) {
            void applyTypeTemplate(this.app, type.template, file);
            appliedTemplate = true;
          }
        }
        if (toReplace.length > 0) {
          void this.removeTypeMemberships(file, toReplace);
        }
      }
    }

    await this.applyAutoInverseUpdates();
    this.scheduleCacheWrite();
  }

  private async renderQueryBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const index = await this.ensureIndex();
    // An explicit `include:` in the block always wins; the setting only moves the default.
    const results = runOntologyQuery(index, source, {
      defaultInclude: this.pluginSettings.queryOnlyLocked ? 'locked' : 'all',
    });

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

    el.createEl('p', {
      cls: 'ontology-query-count',
      text: `${results.length} ${results.length === 1 ? 'note' : 'notes'}.`,
    });
  }

  private showValidationSummary(): void {
    if (!this.index) {
      new Notice('Ontology index is not ready yet.');
      return;
    }
    void this.openIssuesModal();
  }

  private indexSettings(): {
    autoApplyBlockPrefix: string;
    entityTypeFields: string[];
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: PluginSettings['frontmatterIgnoreRules'];
    schemaPath: string;
    typeFolder: string;
  } {
    return {
      autoApplyBlockPrefix: this.pluginSettings.autoApplyBlockPrefix,
      entityTypeFields: this.pluginSettings.entityTypeFields,
      filesToIgnore: this.pluginSettings.filesToIgnore,
      foldersToIgnore: this.pluginSettings.foldersToIgnore,
      frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
      schemaPath: this.pluginSettings.schemaPath,
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

    await this.openIssuesModal(file.path);
  }

  private async scaffoldActiveNote(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    if (!index.entities.has(file.path)) {
      new Notice('This note has no ontology type frontmatter.');
      return;
    }
    const plans = planScaffoldEntity(index, file.path);
    if (plans.length === 0) {
      new Notice('No ontology scaffold fields are missing.');
      return;
    }
    this.openScaffoldReviewModal(file, plans);
  }

  private openScaffoldReviewModal(file: TFile, plans: ReturnType<typeof planScaffoldEntity>): void {
    if (this.scaffoldReviewOpenPaths.has(file.path)) {
      return;
    }
    this.scaffoldReviewOpenPaths.add(file.path);
    new OntologyScaffoldReviewModal(this.app, {
      file,
      onApply: async (selectedPlans) => applyScaffoldPlan(this.app, file, selectedPlans),
      onClosed: () => {
        this.scaffoldReviewOpenPaths.delete(file.path);
        this.scaffoldDismissedPaths.add(file.path);
      },
      onDone: async () => {
        await this.rebuildIndex(false);
      },
      plans,
    }).open();
  }

}
