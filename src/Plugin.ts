import type {
  MarkdownPostProcessorContext,
  TAbstractFile
} from 'obsidian';

import {
  normalizePath,
  Notice,
  Plugin as ObsidianPlugin,
  stringifyYaml,
  TFile
} from 'obsidian';

import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';
import { OntologyEntityActionsModal } from './OntologyEntityActionsModal.ts';

import {
  buildOntologyIndex,
  isIgnoredOntologyPath,
  isOntologySchemaFile,
  isOntologyTypeFile,
  removeOntologyFile,
  upsertOntologyEntityFileFast,
  upsertOntologyFile
} from './ontology/indexer.ts';
import {
  applyMissingInversePlans,
  applyScaffoldPlan,
  applyTypeReplacements,
  fixMissingInverses,
  planMissingInverses,
  planScaffoldEntity
} from './ontology/mutations.ts';
import type { TypeReplacement } from './ontology/types.ts';
import { summarizeIssues } from './ontology/issues.ts';
import { OntologyIssuesModal } from './OntologyIssuesModal.ts';
import { OntologyRelationFixModal } from './OntologyRelationFixModal.ts';
import { OntologySchemaDiagnosticsModal } from './OntologySchemaDiagnosticsModal.ts';
import { OntologyTypeEditorModal } from './OntologyTypeEditorModal.ts';
import type { BulkScaffoldEntityDiff } from './OntologyBulkScaffoldModal.ts';

import { OntologyBulkScaffoldModal } from './OntologyBulkScaffoldModal.ts';
import { OntologyTypeLibraryModal } from './OntologyTypeLibraryModal.ts';
import { OntologyTypeWizardModal } from './OntologyTypeWizardModal.ts';
import {
  emptyTypeEditorModel,
  TYPE_EDITOR_KEYS,
  typeEditorFrontmatter,
  typeEditorModelFromType
} from './ontology/type-editor.ts';
import type { TypeEditorModel } from './ontology/type-editor.ts';
import { applyTypeTemplate } from './templater.ts';
import { analyzeTypeChange } from './ontology/impact.ts';
import { parseOntologyType, readYamlObject } from './ontology/parser.ts';
import { OntologyTypeImpactModal } from './OntologyTypeImpactModal.ts';
import type { ImpactResolution } from './OntologyTypeImpactModal.ts';
import { OntologyRepairModal } from './OntologyRepairModal.ts';
import { PluginSettings as PluginSettingsClass } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { IssueBlameService } from './IssueBlameService.ts';
import { registerPluginCommands } from './PluginCommandRegistration.ts';
import { renderOntologyQueryBlock } from './QueryBlockRenderer.ts';
import { hasOntologySchemaChange } from './OntologySchemaCompare.ts';
import { maybeStampAutoAppliedType } from './EntityAutoTyping.ts';
import {
  BackgroundSweepService,
  SWEEP_INTERVAL_MS
} from './BackgroundSweepService.ts';
import { ScriptingService } from './ScriptingService.ts';
import { IndexTaskQueue } from './IndexTaskQueue.ts';
import { OntologyCacheService } from './OntologyCacheService.ts';
import { registerVaultEvents } from './VaultEventRegistration.ts';
import { EntityScaffoldService } from './EntityScaffoldService.ts';
import { FrontmatterFingerprintService } from './FrontmatterFingerprintService.ts';
import { TypeSchemaFingerprintService } from './TypeSchemaFingerprintService.ts';

const AUTO_INVERSE_DEBOUNCE_MS = 1000;

export class Plugin extends ObsidianPlugin {
  public index: null | OntologyIndex = null;
  public pluginSettings: PluginSettings = new PluginSettingsClass();

  private readonly scriptingService = new ScriptingService();
  private readonly issueBlameService = new IssueBlameService();
  private readonly backgroundSweepService = new BackgroundSweepService();
  private readonly indexTaskQueue = new IndexTaskQueue();
  private readonly frontmatterFingerprints = new FrontmatterFingerprintService();
  private readonly typeSchemaFingerprints = new TypeSchemaFingerprintService();
  private readonly entityScaffoldService = new EntityScaffoldService(
    this.app,
    () => this.index,
    () => this.pluginSettings,
    () => this.indexReady,
    () => this.rebuildIndex(false)
  );
  private readonly cacheService = new OntologyCacheService(
    this.app,
    () => this.index,
    () => this.pluginSettings,
    () => this.deviceId
  );

  private deviceId = '';
  private indexReady = false;
  private isAutoFixingInverses = false;
  private autoInverseTimer: null | number = null;
  // Paths currently being written by the type editor modal; suppresses the
  // raw-edit lock warning for writes the plugin itself initiates.
  private modalWritingPaths = new Set<string>();

  public override async onload(): Promise<void> {
    const deviceIdKey = 'ontologize-device-id';
    let deviceId = window.localStorage.getItem(deviceIdKey);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      window.localStorage.setItem(deviceIdKey, deviceId);
    }
    this.deviceId = deviceId;

    const savedData = (await this.loadData()) as Record<string, unknown> | null ?? {};
    this.pluginSettings = Object.assign(new PluginSettingsClass(), savedData);
    if (!('globalTypePath' in savedData)) {
      const candidate = normalizePath(`${this.pluginSettings.typeFolder}/_global.md`);
      // Prefer the Vault API; fall back to the adapter for a typeFolder kept in a
      // dot-folder (e.g. .config/), which the vault index does not surface — same
      // fallback loadSchemaTypes uses for schema files in the same situation.
      if (this.app.vault.getFileByPath(candidate) || await this.app.vault.adapter.exists(candidate)) {
        this.pluginSettings.globalTypePath = candidate;
      }
    }
    const cachedIndex = await this.cacheService.read();
    // A cache built under different scoping settings describes a different graph;
    // hydrating it would let pre-rebuild reads see files the user has since
    // ignored (or miss files they un-ignored). Wait for the cold rebuild instead.
    this.index = cachedIndex && JSON.stringify(cachedIndex.settings) === JSON.stringify(this.indexSettings()) ? cachedIndex : null;

    this.registerMarkdownCodeBlockProcessor('ontology-query', this.renderQueryBlock.bind(this));

    registerPluginCommands(this, this.app, {
      getIndex: () => this.index,
      getSettings: () => this.pluginSettings,
      hasEntityActions: () => this.scriptingService.hasEntityActions,
      openBulkScaffoldModal: () => this.openBulkScaffoldModal(),
      openCreateTypeModal: () => this.openCreateTypeModal(),
      openEditTypeModal: (file) => this.openEditTypeModal(file),
      openEntityActionsModal: (file) => this.openEntityActionsModal(file),
      openIssuesModal: () => this.openIssuesModal(),
      openRelationFixModal: () => this.openRelationFixModal(),
      openSchemaDiagnosticsModal: () => this.openSchemaDiagnosticsModal(),
      openTypeLibraryModal: () => this.openTypeLibraryModal(),
      rebuildIndex: (showNotice) => this.rebuildIndex(showNotice),
      scaffoldActiveNote: (file) => this.scaffoldActiveNote(file),
      showActiveFileIssues: (file) => this.showActiveFileIssues(file)
    });

    registerVaultEvents(this, this.app, this.scriptingService, {
      getScriptsFolder: () => this.pluginSettings.scriptsFolder,
      handleMetadataChanged: (file) => this.handleMetadataChanged(file),
      handleVaultCreate: (file) => this.handleVaultCreate(file),
      handleVaultDelete: (file) => this.handleVaultDelete(file),
      handleVaultModify: (file) => this.handleVaultModify(file),
      handleVaultRename: (file, oldPath) => this.handleVaultRename(file, oldPath),
      reloadScripts: () => this.reloadScripts(),
      runEventTask: (task) => {
        this.runEventTask(task);
      }
    });
    this.addSettingTab(new PluginSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.rebuildIndex(false).finally(() => {
        this.indexReady = true;
        this.registerInterval(window.setInterval(() => {
          this.runEventTask(this.runBackgroundSweep());
        }, SWEEP_INTERVAL_MS));
      });
    });
    this.scriptingService.initialize(this.app, () => this.index);
  }

  // Vault event handlers have no caller to surface a rejection to; without
  // this, a failed incremental update dies as an unhandled rejection and the
  // index silently stops tracking the vault.
  private runEventTask(task: Promise<unknown>): void {
    task.catch((error: unknown) => {
      console.error('Ontologize: incremental index update failed', error);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return this.indexTaskQueue.enqueue(task);
  }

  public override onunload(): void {
    this.cacheService.clearTimer();
    if (this.autoInverseTimer !== null) {
      window.clearTimeout(this.autoInverseTimer);
      this.autoInverseTimer = null;
    }
  }

  public async savePluginSettings(): Promise<void> {
    await this.saveData(this.pluginSettings);
    await this.rebuildIndex(false);
  }

  public async rebuildIndex(showNotice: boolean): Promise<void> {
    await this.enqueue(() => this.buildAndStore(showNotice));
  }

  // Type files aren't necessarily entities (only ones with entity-registration
  // frontmatter are, via resolveTypeFileAsEntity) — a pure-schema type file's raw
  // frontmatter needs to be seeded separately or its baseline fingerprint would
  // never get recorded, and the very first handleVaultModify after a rebuild would
  // always see it as "changed" regardless of whether anything actually changed.
  // Read fresh via vault.read() rather than metadataCache, matching how
  // handleVaultModify's own fingerprint check reads type files, so the seeded
  // baseline and later comparisons agree on what "the frontmatter" is.
  private async typeOnlyFrontmatterEntries(index: OntologyIndex): Promise<Array<{ frontmatter: Record<string, unknown>; path: string }>> {
    const entries: Array<{ frontmatter: Record<string, unknown>; path: string }> = [];
    for (const type of index.types.values()) {
      if (index.entities.has(type.path)) {
        continue;
      }
      const file = this.app.vault.getFileByPath(type.path);
      if (!(file instanceof TFile)) {
        continue;
      }
      const source = await this.app.vault.read(file);
      entries.push({ frontmatter: readYamlObject(source), path: type.path });
    }
    return entries;
  }

  private async seedFingerprints(index: OntologyIndex): Promise<void> {
    this.frontmatterFingerprints.seed([...index.entities.values(), ...await this.typeOnlyFrontmatterEntries(index)]);
    this.typeSchemaFingerprints.seed(index.types.values());
  }

  private async buildAndStore(showNotice: boolean): Promise<void> {
    this.index = await buildOntologyIndex(this.app, this.indexSettings());
    await this.seedFingerprints(this.index);
    await this.writeCacheSafely();
    // Reload scripts on full rebuild so they see the fresh index, then run validate hooks.
    await this.reloadScripts();
    await this.fireEntityValidateHooks();

    let autoFixedInverses = 0;
    if (this.pluginSettings.autoUpdateInverses) {
      autoFixedInverses = await this.runAutoInverseFix();
    }

    if (showNotice) {
      const autoFixText = autoFixedInverses > 0 ? `, ${autoFixedInverses} inverse updates` : '';
      const ignoredCount = [...this.index.entities.values()].filter((e) => e.ignored).length;
      const ignoredText = ignoredCount > 0 ? `, ${ignoredCount} ignored` : '';
      new Notice(
        `Ontology index rebuilt: ${this.index.types.size} types, ${this.index.entities.size} entities, ${this.index.issues.length} issues${autoFixText}${ignoredText}.`
      );
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
      isIgnoredFile: (filePath) => this.index?.entities.get(filePath)?.ignored === true,
      onFixInverses: async () => {
        await this.openRelationFixModal();
      },
      onRebuild: async () => {
        await this.rebuildIndex(true);
      },
      onRepair: () => {
        void this.openRepairModal();
      }
    }).open();
  }

  public async openRepairModal(): Promise<void> {
    await this.ensureIndex();
    new OntologyRepairModal(this.app, {
      getIndex: () => this.index ?? null,
      onUnignore: async (paths) => {
        await this.setEntitiesIgnored(paths, false);
        await this.rebuildIndex(false);
      }
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
      plans
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
      }
    }).open();
  }

  private async openTypeLibraryModal(): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyTypeLibraryModal(this.app, index, {
      onCreateNew: () => {
        void this.openCreateTypeModal();
      },
      onCreateSubtype: (parent) => {
        const model = emptyTypeEditorModel();
        model.subtypeOf = [parent.name];
        void this.openTypeEditorForCreate(model);
      },
      onEdit: (type) => {
        const file = this.app.vault.getFileByPath(type.path);
        if (file) void this.openEditTypeModal(file);
      },
      onOpenFile: (type) => {
        const file = this.app.vault.getFileByPath(type.path);
        if (file) void this.app.workspace.getLeaf(false).openFile(file);
      }
    }).open();
  }

  private async openCreateTypeModal(): Promise<void> {
    const index = await this.ensureIndex();
    const types = [...index.types.values()];
    new OntologyTypeWizardModal(this.app, types, (model) => {
      void this.openTypeEditorForCreate(model);
    }).open();
  }

  private async applyTypeReplacementRules(file: TFile, replacements: TypeReplacement[]): Promise<void> {
    const defaultFields = this.pluginSettings.entityTypeFields;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      applyTypeReplacements(fm as Record<string, unknown>, replacements, defaultFields);
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

  private offerScaffoldAfterTypeChange(): void {
    if (!this.index || !this.indexReady) return;
    const affected = [...this.index.entities.values()].filter(
      (e) => !e.ignored && planScaffoldEntity(this.index!, e.path).length > 0
    );
    if (affected.length === 0) return;

    const notice = new Notice('', 0);
    const frag = notice.noticeEl;
    frag.createEl('span', { text: `Type change affects ${affected.length} ${affected.length === 1 ? 'note' : 'notes'} with missing fields. ` });
    const btn = frag.createEl('a', { cls: 'ontology-notice-link', text: 'Scaffold now', href: '#' });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      notice.hide();
      void this.openBulkScaffoldModal();
    });
  }

  private async openBulkScaffoldModal(): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyBulkScaffoldModal(this.app, index, async (diffs) => {
      const totalFields = await this.applyBulkScaffoldDiffs(diffs);
      if (!this.pluginSettings.initialScaffoldComplete) {
        this.pluginSettings.initialScaffoldComplete = true;
        await this.saveData(this.pluginSettings);
      }
      return totalFields;
    }).open();
  }

  private typeEditorNames(): { typeNames: string[]; interfaceNames: string[] } {
    const all = [...(this.index?.types.values() ?? [])];
    return {
      interfaceNames: all.filter((t) => t.isInterface).map((t) => t.name).sort(),
      typeNames: all.filter((t) => !t.isInterface).map((t) => t.name).sort()
    };
  }

  private async openTypeEditorForCreate(preset: TypeEditorModel): Promise<void> {
    const index = await this.ensureIndex();
    new OntologyTypeEditorModal(this.app, {
      ...this.typeEditorNames(),
      editing: false,
      index,
      model: preset,
      onSave: async (model) => {
        const folder = normalizePath(this.pluginSettings.typeFolder);
        const path = normalizePath(`${folder}/${model.name}.md`);
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice(`Ontology type already exists: ${path}`);
          return false;
        }
        if (!this.app.vault.getFolderByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        const source = `---\n${stringifyYaml(typeEditorFrontmatter(model, this.pluginSettings.requireOntologizePrefix))}---\n`;
        const file = await this.app.vault.create(path, source);
        await this.rebuildIndex(false);
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice(`Created ontology type ${model.name}.`);
        return true;
      }
    }).open();
  }

  private async openEditTypeModal(file: TFile): Promise<void> {
    const index = await this.ensureIndex();
    const type = index.types.get(file.basename) ?? [...index.types.values()].find((candidate) => candidate.path === file.path);
    if (!type) {
      new Notice('The active file is not a parsed ontology type.');
      return;
    }
    new OntologyTypeEditorModal(this.app, {
      ...this.typeEditorNames(),
      editing: true,
      index,
      model: typeEditorModelFromType(type),
      onSave: async (model) => {
        // Build the proposed OntologyType by round-tripping through the
        // frontmatter serializer and parser so the shadow exactly matches
        // what the file write would produce.
        const generated = typeEditorFrontmatter(model, this.pluginSettings.requireOntologizePrefix);
        const previewMarkdown = `---\n${stringifyYaml(generated)}---\n`;
        const proposedType = parseOntologyType(file.path, previewMarkdown, this.pluginSettings.autoApplyBlockPrefix, this.pluginSettings.requireOntologizePrefix);

        const currentIndex = this.index ?? index;
        const impact = analyzeTypeChange(currentIndex, model.name, proposedType);
        const hasImpact = impact.coherenceViolations.length > 0
          || impact.softBreaking.length > 0
          || impact.softFixed.length > 0;

        if (hasImpact) {
          const resolution = await new Promise<ImpactResolution>((resolve) => {
            new OntologyTypeImpactModal(this.app, {
              impact,
              onResolve: resolve,
              typeName: model.name
            }).open();
          });

          if (resolution === 'cancel') {
            return false;
          }

          if (resolution === 'ignore-affected') {
            const filesToIgnore = new Set([
              ...impact.coherenceViolations.map((i) => i.file),
              ...impact.softBreaking.map((i) => i.file)
            ]);
            await this.setEntitiesIgnored([...filesToIgnore], true);
          }
        }

        this.modalWritingPaths.add(file.path);
        try {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            delete frontmatter['ontologize'];
            // 'extends' is the pre-rename name of 'subtype-of' (no longer parsed at all);
            // clean it up here too or the structured editor leaves a dead, misleading key
            // behind on an un-migrated type file instead of replacing it with subtype-of.
            for (const key of [...TYPE_EDITOR_KEYS, 'extends']) {
              delete frontmatter[key];
              delete frontmatter[`ontologize.${key}`];
            }
            Object.assign(frontmatter, generated);
          });
        } finally {
          this.modalWritingPaths.delete(file.path);
        }
        await this.rebuildIndex(false);
        new Notice(`Updated ontology type ${model.name}.`);
        return true;
      }
    }).open();
  }

  private async setEntitiesIgnored(paths: string[], ignored: boolean): Promise<void> {
    await Promise.all(
      paths.map(async (path) => {
        const file = this.app.vault.getFileByPath(path);
        if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (ignored) {
              fm['ignored'] = true;
            } else {
              delete fm['ignored'];
            }
          });
        }
      })
    );
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

  private scheduleAutoInverseUpdates(): void {
    if (!this.index || !this.pluginSettings.autoUpdateInverses || !this.indexReady) {
      return;
    }
    if (this.autoInverseTimer !== null) {
      window.clearTimeout(this.autoInverseTimer);
    }
    this.autoInverseTimer = window.setTimeout(() => {
      this.autoInverseTimer = null;
      this.runEventTask(this.enqueue(async () => {
        await this.applyAutoInverseUpdates();
      }));
    }, AUTO_INVERSE_DEBOUNCE_MS);
  }

  /**
   * Rotates through the entity roster in batches, refreshing frontmatter from
   * the in-memory metadataCache and re-running per-entity validation without a
   * full rebuild. Runs inside the enqueue queue so it never races a live event.
   * After the sync phase, blame info is attached to any new issues found in the
   * batch so the issues modal can show which commit introduced each problem.
   */
  private async runBackgroundSweep(): Promise<void> {
    let batch: string[] = [];
    await this.enqueue(async () => {
      const result = this.backgroundSweepService.run(this.app, this.index, this.indexReady);
      batch = result.batch;
      if (result.shouldScheduleCacheWrite) {
        this.scheduleCacheWrite();
      }
    });
    if (batch.length > 0) {
      await this.attachBlameForBatch(batch);
    }
  }

  private async attachBlameForBatch(batch: string[]): Promise<void> {
    if (!this.index) {
      return;
    }
    await this.issueBlameService.attachBlameForBatch(this.app, this.index, batch);
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
        await this.seedFingerprints(this.index);
        await this.writeCacheSafely();
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
      if (isIgnoredOntologyPath(file.path, this.indexSettings())) {
        return;
      }
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (isOntologyTypeFile(file, this.pluginSettings.typeFolder, fm)) {
        // If this file just gained ontologize:true (not yet in the type index), register it now.
        // Files in typeFolder are handled reliably by handleVaultModify; only out-of-folder
        // files have a stale-cache race where handleVaultModify misses the new flag.
        if (this.index && !this.index.types.has(file.basename)) {
          await this.upsertFileCore(file);
        }
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
      if (file instanceof TFile) {
        const createFm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (isOntologyTypeFile(file, this.pluginSettings.typeFolder, createFm) && !isIgnoredOntologyPath(file.path, this.indexSettings())) {
          await this.upsertFileCore(file);
        }
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
      const wasType = 'basename' in file && this.index.types.has((file as { basename: string }).basename);
      this.index = removeOntologyFile(this.index, file.path);
      this.frontmatterFingerprints.forget(file.path);
      this.typeSchemaFingerprints.forget(file.path);
      if (wasType) {
        this.offerScaffoldAfterTypeChange();
      }
      this.scheduleCacheWrite();
    });
  }

  private handleVaultModify(file: TAbstractFile): Promise<unknown> {
    return this.enqueue(async () => {
      if (file instanceof TFile && isOntologySchemaFile(file, this.pluginSettings.schemaPath)) {
        await this.buildAndStore(false);
        this.offerScaffoldAfterTypeChange();
        return;
      }
      const modifyFm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined : undefined;
      if (file instanceof TFile && isOntologyTypeFile(file, this.pluginSettings.typeFolder, modifyFm)) {
        // Warn when a locked type's own schema (must-have, relations, lock, etc.) is
        // edited directly rather than through the type editor modal. Body prose and
        // non-schema frontmatter on the same file shouldn't trigger this warning.
        // Compare against the type as freshly indexed by upsertFileCore below (the
        // same uncached vault.read()-backed path used everywhere else) rather than a
        // separate cachedRead()+parse, which could race a very recent write and would
        // redundantly re-parse the file a second time regardless.
        const typeName = file.basename;
        const previousType = this.index?.types.get(typeName);
        const shouldWarnIfChanged = !this.modalWritingPaths.has(file.path) && previousType?.lockIntent === true;
        // Gate on the raw frontmatter fingerprint (read fresh, not from metadataCache —
        // same staleness concern as the comment above), not the parsed schema fingerprint.
        // A type file can also double as its own hub entity via entity-registration
        // frontmatter (instance-of, member-of, ...) that isn't part of the parsed
        // OntologyType schema, and lint issues are re-derived from the raw source too.
        // Comparing only the parsed schema would skip re-indexing (and re-linting) an
        // edit that changes neither, leaving stale entity registration or stale lint
        // issues behind until the next full rebuild.
        const source = await this.app.vault.read(file);
        const rawFrontmatter = readYamlObject(source);
        if (!this.frontmatterFingerprints.hasChanged(file.path, rawFrontmatter)) {
          return;
        }
        await this.upsertFileCore(file);
        // Re-record with this fresh vault.read()-backed value — upsertFileCore's own
        // record uses metadataCache, which can still be catching up right after a vault
        // 'modify' event fires (the same race the comment above warns about), and a
        // stale recorded baseline would make the next genuine edit's comparison wrong.
        this.frontmatterFingerprints.record(file.path, rawFrontmatter);
        const indexedType = this.index?.types.get(typeName);
        if (shouldWarnIfChanged && previousType) {
          const newType = indexedType;
          if (newType && hasOntologySchemaChange(previousType, newType)) {
            new Notice(
              `"${typeName}" is a locked type. Use the type editor (right-click → Edit type) to validate impact before saving changes.`
            );
          }
        }
        this.offerScaffoldAfterTypeChange();
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
        this.frontmatterFingerprints.forget(oldPath);
        this.typeSchemaFingerprints.forget(oldPath);
        await this.upsertFileCore(file);
        return;
      }
      // Folder rename: Obsidian does not reliably emit per-child events, so the
      // children's new paths are only discoverable with a full rebuild.
      await this.buildAndStore(false);
    });
  }

  // The cache is a startup optimization — a failed write (disk full, network
  // drive dropped) must not abort the operation that triggered it, but the user
  // should hear about it once instead of silently loading a stale index next
  // session.
  private async writeCacheSafely(): Promise<void> {
    await this.cacheService.writeSafely();
  }

  private scheduleCacheWrite(): void {
    this.cacheService.scheduleWrite();
  }

  private async upsertFileCore(file: TFile): Promise<void> {
    const index = await this.ensureIndexCore();
    const membershipBefore = index.entities.get(file.path)?.instanceOf ?? [];
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (!isOntologySchemaFile(file, this.pluginSettings.schemaPath) && !isOntologyTypeFile(file, this.pluginSettings.typeFolder, frontmatter)) {
      if (!this.frontmatterFingerprints.hasChanged(file.path, frontmatter)) {
        return;
      }
      this.index = await upsertOntologyEntityFileFast(this.app, index, file, this.indexSettings());
    } else {
      this.index = await upsertOntologyFile(this.app, index, file, this.indexSettings());
      const indexedType = this.index.types.get(file.basename) ?? [...this.index.types.values()].find((type) => type.path === file.path);
      if (indexedType) {
        this.typeSchemaFingerprints.record(indexedType);
      }
    }
    this.frontmatterFingerprints.record(file.path, frontmatter);
    const membershipAfter = this.index.entities.get(file.path)?.instanceOf ?? [];

    const entity = this.index.entities.get(file.path);
    if (entity) {
      await this.scriptingService.fireEntitySave(entity);
      this.scriptingService.fireEntityValidate(entity);
    }

    // Auto-apply detection: if the file is not yet typed, scan all types with
    // conditional auto-apply to see if any match the file's frontmatter.  When
    // one matches, stamp is-instance and reconcile `up` for Breadcrumbs:
    //   - add the direct type to `up` so the chain reads entity → type → parent
    //   - remove ancestor types from `up` (they're now reachable through the
    //     type chain; non-type links like topic pages are left alone)
    if (membershipAfter.length === 0 && await maybeStampAutoAppliedType(this.app, this.index, this.pluginSettings, file)) {
      return;
    }

    const membershipChanged = membershipBefore.length !== membershipAfter.length
      || membershipBefore.some((typeName, position) => typeName !== membershipAfter[position]);
    if (membershipChanged) {
      this.entityScaffoldService.clearDismissed(file.path);
      if (membershipAfter.length > 0) {
        this.entityScaffoldService.applyAutoScaffold(file);
        const addedTypes = membershipAfter.filter((t) => !membershipBefore.includes(t));
        const toReplace: TypeReplacement[] = [];
        let appliedTemplate = false;
        for (const typeName of addedTypes) {
          const type = this.index.types.get(typeName);
          for (const r of type?.replaces ?? []) {
            toReplace.push(r);
          }
          if (type?.template && !appliedTemplate) {
            // Awaited so the template body lands before the inverse pass and
            // cache write below read the file; the vault events these writes
            // emit are enqueued behind the current task, not awaited, so this
            // cannot deadlock the queue.
            await applyTypeTemplate(this.app, type.template, file);
            appliedTemplate = true;
          }
        }
        if (toReplace.length > 0) {
          await this.applyTypeReplacementRules(file, toReplace);
        }
      }
    }

    this.scheduleAutoInverseUpdates();
    this.scheduleCacheWrite();
  }

  private async renderQueryBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const index = await this.ensureIndex();
    await renderOntologyQueryBlock(this.app, this, source, el, ctx, index, this.pluginSettings.queryOnlyLocked ? 'locked' : 'all');
  }

  private async reloadScripts(): Promise<void> {
    await this.scriptingService.reloadScripts(this.app, this.pluginSettings.scriptsFolder, this.index);
  }

  public async fireEntityValidateHooks(): Promise<void> {
    this.scriptingService.fireEntityValidateAll(this.index);
  }

  private async openEntityActionsModal(file: TFile): Promise<void> {
    const scriptApi = this.scriptingService.getApi();
    if (!scriptApi) return;
    const entity = this.index?.entities.get(file.path);
    if (!entity) {
      new Notice('This note is not an indexed ontology entity.');
      return;
    }
    new OntologyEntityActionsModal(this.app, entity, this.scriptingService.entityActions, scriptApi).open();
  }

  private indexSettings(): {
    autoApplyBlockPrefix: string;
    entityTypeFields: string[];
    filesToIgnore: string[];
    foldersToIgnore: string[];
    frontmatterIgnoreRules: PluginSettings['frontmatterIgnoreRules'];
    globalTypePath: string;
    ignoredEntityFields: string[];
    requireOntologizePrefix: boolean;
    schemaPath: string;
    typeFolder: string;
    warnUnknownEntityFields: boolean;
  } {
    return {
      autoApplyBlockPrefix: this.pluginSettings.autoApplyBlockPrefix,
      entityTypeFields: this.pluginSettings.entityTypeFields,
      filesToIgnore: this.pluginSettings.filesToIgnore,
      foldersToIgnore: this.pluginSettings.foldersToIgnore,
      frontmatterIgnoreRules: this.pluginSettings.frontmatterIgnoreRules,
      globalTypePath: this.pluginSettings.globalTypePath,
      ignoredEntityFields: this.pluginSettings.ignoredEntityFields,
      requireOntologizePrefix: this.pluginSettings.requireOntologizePrefix,
      schemaPath: this.pluginSettings.schemaPath,
      typeFolder: this.pluginSettings.typeFolder,
      warnUnknownEntityFields: this.pluginSettings.warnUnknownEntityFields
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
    this.entityScaffoldService.scaffoldActiveNote(index, file);
  }
}
