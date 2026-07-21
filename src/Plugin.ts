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
import type { OntologizeAPI } from './ontology/scripting.ts';
import { ScriptHookRegistry } from './ontology/scripting.ts';
import { ScriptLoader } from './ScriptLoader.ts';
import { OntologyEntityActionsModal } from './OntologyEntityActionsModal.ts';

import {
  readOntologyCache,
  writeOntologyCache
} from './ontology/cache.ts';
import {
  buildOntologyIndex,
  isIgnoredOntologyPath,
  isOntologySchemaFile,
  isOntologyTypeFile,
  removeOntologyFile,
  upsertOntologyFile
} from './ontology/indexer.ts';
import {
  applyMissingInversePlans,
  applyScaffoldPlan,
  applyTypeReplacements,
  fixMissingInverses,
  planMissingInverses,
  planScaffoldEntity,
  shouldAutoApplyScaffold
} from './ontology/mutations.ts';
import type { TypeReplacement } from './ontology/types.ts';
import {
  runOntologyQuery
} from './ontology/query.ts';
import { summarizeIssues } from './ontology/issues.ts';
import { OntologyIssuesModal } from './OntologyIssuesModal.ts';
import { OntologyRelationFixModal } from './OntologyRelationFixModal.ts';
import { OntologyScaffoldReviewModal } from './OntologyScaffoldReviewModal.ts';
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
import { parseOntologyType } from './ontology/parser.ts';
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

const CACHE_WRITE_DEBOUNCE_MS = 800;

export class Plugin extends ObsidianPlugin {
  public index: null | OntologyIndex = null;
  public pluginSettings: PluginSettings = new PluginSettingsClass();

  private readonly scriptRegistry = new ScriptHookRegistry();
  private readonly scriptLoader = new ScriptLoader();
  private readonly issueBlameService = new IssueBlameService();
  private readonly backgroundSweepService = new BackgroundSweepService();
  private scriptApi: OntologizeAPI | null = null;

  private deviceId = '';
  private cacheWriteTimer: null | number = null;
  private indexReady = false;
  private indexTask: Promise<unknown> = Promise.resolve();
  private isAutoFixingInverses = false;
  // Paths whose scaffold review was closed without the membership changing
  // since; auto-scaffold stays quiet for them until the entity's types change.
  private scaffoldDismissedPaths = new Set<string>();
  private scaffoldReviewOpenPaths = new Set<string>();
  // Paths currently being written by the type editor modal; suppresses the
  // raw-edit lock warning for writes the plugin itself initiates.
  private modalWritingPaths = new Set<string>();

  private effectiveCachePath(): string {
    const base = this.pluginSettings.cachePath;
    const withoutExt = base.endsWith('.json') ? base.slice(0, -5) : base;
    return `${withoutExt}-${this.deviceId}.json`;
  }

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
    const cachedIndex = await readOntologyCache(this.app, this.effectiveCachePath());
    // A cache built under different scoping settings describes a different graph;
    // hydrating it would let pre-rebuild reads see files the user has since
    // ignored (or miss files they un-ignored). Wait for the cold rebuild instead.
    this.index = cachedIndex && JSON.stringify(cachedIndex.settings) === JSON.stringify(this.indexSettings()) ? cachedIndex : null;

    this.registerMarkdownCodeBlockProcessor('ontology-query', this.renderQueryBlock.bind(this));

    registerPluginCommands(this, this.app, {
      getIndex: () => this.index,
      getSettings: () => this.pluginSettings,
      hasEntityActions: () => this.scriptRegistry.entityActions.length > 0,
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

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.runEventTask(this.handleMetadataChanged(file));
    }));
    this.registerEvent(this.app.vault.on('create', (file) => {
      this.runEventTask(this.handleVaultCreate(file));
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.runEventTask(this.handleVaultDelete(file));
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      this.runEventTask(this.handleVaultModify(file));
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.runEventTask(this.handleVaultRename(file, oldPath));
    }));
    this.addSettingTab(new PluginSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.rebuildIndex(false).finally(() => {
        this.indexReady = true;
        this.registerInterval(window.setInterval(() => {
          this.runEventTask(this.runBackgroundSweep());
        }, SWEEP_INTERVAL_MS));
      });
    });

    this.scriptApi = this.makeScriptApi();
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile && this.pluginSettings.scriptsFolder && this.scriptLoader.isScriptFile(file.path, this.pluginSettings.scriptsFolder)) {
        this.runEventTask(this.reloadScripts());
      }
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && this.pluginSettings.scriptsFolder && this.scriptLoader.isScriptFile(file.path, this.pluginSettings.scriptsFolder)) {
        this.runEventTask(this.reloadScripts());
      }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (this.pluginSettings.scriptsFolder && 'path' in file && this.scriptLoader.isScriptFile(file.path as string, this.pluginSettings.scriptsFolder)) {
        this.runEventTask(this.reloadScripts());
      }
    }));
  }

  // Vault event handlers have no caller to surface a rejection to; without
  // this, a failed incremental update dies as an unhandled rejection and the
  // index silently stops tracking the vault.
  private runEventTask(task: Promise<unknown>): void {
    task.catch((error: unknown) => {
      console.error('Ontologize: incremental index update failed', error);
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
      const silentPlans = plans.filter((p) => p.kind !== 'optional');
      if (silentPlans.length > 0) {
        void applyScaffoldPlan(this.app, file, silentPlans);
      }
      return;
    }

    if (!this.pluginSettings.autoScaffoldEntities) {
      return;
    }
    new Notice(`Ontology scaffold available: ${plans.length} fields.`);
    this.openScaffoldReviewModal(file, plans);
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
        await this.upsertFileCore(file);
        if (shouldWarnIfChanged && previousType) {
          const newType = this.index?.types.get(typeName);
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
    if (!this.index) {
      return;
    }
    try {
      await writeOntologyCache(this.app, this.effectiveCachePath(), this.index);
    } catch (error) {
      console.error('Ontologize: failed to write ontology cache', error);
      new Notice('Ontologize: failed to write the ontology cache; the next session may start from a stale index.');
    }
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
      void this.writeCacheSafely();
    }, CACHE_WRITE_DEBOUNCE_MS);
  }

  private async upsertFileCore(file: TFile): Promise<void> {
    const index = await this.ensureIndexCore();
    const membershipBefore = index.entities.get(file.path)?.instanceOf ?? [];
    this.index = await upsertOntologyFile(this.app, index, file, this.indexSettings());
    const membershipAfter = this.index.entities.get(file.path)?.instanceOf ?? [];

    if (this.scriptApi) {
      const entity = this.index.entities.get(file.path);
      if (entity) {
        for (const handler of this.scriptRegistry.entitySaveHandlers) {
          try {
            await handler(entity, this.scriptApi);
          } catch (e) {
            console.error('Ontologize script entity:save error', e);
          }
        }
        for (const handler of this.scriptRegistry.entityValidateHandlers) {
          try {
            handler(entity, this.scriptApi);
          } catch (e) {
            console.error('Ontologize script entity:validate error', e);
          }
        }
      }
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

    await this.applyAutoInverseUpdates();
    this.scheduleCacheWrite();
  }

  private async renderQueryBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const index = await this.ensureIndex();
    await renderOntologyQueryBlock(this.app, this, source, el, ctx, index, this.pluginSettings.queryOnlyLocked ? 'locked' : 'all');
  }

  private makeScriptApi(): OntologizeAPI {
    const registry = this.scriptRegistry;
    const plugin = this;
    return {
      get index() {
        return plugin.index!;
      },
      query(queryString) {
        return plugin.index ? runOntologyQuery(plugin.index, queryString) : [];
      },
      issue(path, message, severity = 'warning') {
        if (plugin.index) {
          plugin.index.issues.push({ file: path, message, severity });
        }
      },
      async updateFrontmatter(path, update) {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await plugin.app.fileManager.processFrontMatter(file, (fm) => {
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

  private async loadScripts(): Promise<void> {
    const { scriptsFolder } = this.pluginSettings;
    if (!scriptsFolder || !this.scriptApi) {
      return;
    }
    await this.scriptLoader.loadAll(this.app, scriptsFolder, this.scriptApi);
    if (this.index) {
      for (const handler of this.scriptRegistry.indexReadyHandlers) {
        try {
          await handler(this.scriptApi);
        } catch (e) {
          console.error('Ontologize script index:ready error', e);
        }
      }
    }
  }

  private async reloadScripts(): Promise<void> {
    this.scriptRegistry.clear();
    await this.loadScripts();
  }

  public async fireEntityValidateHooks(): Promise<void> {
    if (!this.index || !this.scriptApi || this.scriptRegistry.entityValidateHandlers.length === 0) {
      return;
    }
    for (const entity of this.index.entities.values()) {
      for (const handler of this.scriptRegistry.entityValidateHandlers) {
        try {
          handler(entity, this.scriptApi);
        } catch (e) {
          console.error('Ontologize script entity:validate error', e);
        }
      }
    }
  }

  private async openEntityActionsModal(file: TFile): Promise<void> {
    if (!this.scriptApi) return;
    const entity = this.index?.entities.get(file.path);
    if (!entity) {
      new Notice('This note is not an indexed ontology entity.');
      return;
    }
    new OntologyEntityActionsModal(this.app, entity, this.scriptRegistry.entityActions, this.scriptApi).open();
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
      plans
    }).open();
  }
}
