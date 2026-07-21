import type {
  App,
  Plugin as ObsidianPlugin,
  TFile
} from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import { isOntologyTypeFile } from './ontology/indexer.ts';

export interface PluginCommandHandlers {
  getIndex: () => null | OntologyIndex;
  getSettings: () => PluginSettings;
  hasEntityActions: () => boolean;
  openCreateTypeModal: () => Promise<void>;
  openEditTypeModal: (file: TFile) => Promise<void>;
  openEntityActionsModal: (file: TFile) => Promise<void>;
  openBulkScaffoldModal: () => Promise<void>;
  openIssuesModal: () => Promise<void>;
  openRelationFixModal: () => Promise<void>;
  openSchemaDiagnosticsModal: () => Promise<void>;
  openTypeLibraryModal: () => Promise<void>;
  rebuildIndex: (showNotice: boolean) => Promise<void>;
  scaffoldActiveNote: (file: TFile) => Promise<void>;
  showActiveFileIssues: (file: TFile) => Promise<void>;
}

export function registerPluginCommands(plugin: ObsidianPlugin, app: App, handlers: PluginCommandHandlers): void {
  plugin.addCommand({
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) {
        return false;
      }
      if (!checking) {
        void handlers.showActiveFileIssues(file);
      }
      return true;
    },
    id: 'check-active-note',
    name: 'Check active ontology note'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.rebuildIndex(true);
    },
    id: 'rebuild-index',
    name: 'Rebuild ontology index'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openIssuesModal();
    },
    id: 'open-issues',
    name: 'Open ontology issues'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openSchemaDiagnosticsModal();
    },
    id: 'open-schema-diagnostics',
    name: 'Open ontology schema diagnostics'
  });

  plugin.addCommand({
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) {
        return false;
      }
      if (!checking) {
        void handlers.scaffoldActiveNote(file);
      }
      return true;
    },
    id: 'scaffold-active-note',
    name: 'Scaffold active ontology note'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openRelationFixModal();
    },
    id: 'fix-missing-inverses',
    name: 'Fix missing inverse relations'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openTypeLibraryModal();
    },
    id: 'browse-ontology-types',
    name: 'Browse ontology types'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openCreateTypeModal();
    },
    id: 'create-ontology-type',
    name: 'Create ontology type'
  });

  plugin.addCommand({
    callback: () => {
      void handlers.openBulkScaffoldModal();
    },
    id: 'bulk-scaffold-type',
    name: 'Bulk scaffold ontology entities'
  });

  plugin.addCommand({
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      const fm = file ? app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined : undefined;
      if (!file || !isOntologyTypeFile(file, handlers.getSettings().typeFolder, fm)) {
        return false;
      }
      if (!checking) {
        void handlers.openEditTypeModal(file);
      }
      return true;
    },
    id: 'edit-active-ontology-type',
    name: 'Edit active ontology type'
  });

  plugin.addCommand({
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file || !handlers.getIndex()?.entities.has(file.path) || !handlers.hasEntityActions()) {
        return false;
      }
      if (!checking) {
        void handlers.openEntityActionsModal(file);
      }
      return true;
    },
    id: 'open-entity-actions',
    name: 'Open script actions for active note'
  });
}
