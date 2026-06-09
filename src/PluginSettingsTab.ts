import type { App } from 'obsidian';

import { PluginSettingTab, Setting } from 'obsidian';

import type { Plugin } from './Plugin.ts';

function formatFrontmatterIgnoreRules(rules: { key: string; value?: string }[]): string {
  return rules.map((rule) => rule.value ? `${rule.key}: ${rule.value}` : rule.key).join('\n');
}

function parseFrontmatterIgnoreRules(value: string): { key: string; value?: string }[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      return [{ key: trimmed }];
    }
    const key = trimmed.slice(0, separator).trim();
    const ruleValue = trimmed.slice(separator + 1).trim();
    return key ? [{ key, ...(ruleValue ? { value: ruleValue } : {}) }] : [];
  });
}

export class PluginSettingsTab extends PluginSettingTab {
  public constructor(app: App, private readonly plugin: Plugin) {
    super(app, plugin);
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian Ontology' });

    new Setting(containerEl)
      .setName('Issue report')
      .setDesc('Open current ontology validation results.')
      .addButton((button) =>
        button
          .setButtonText('Open issues')
          .onClick(() => {
            void this.plugin.openIssuesModal();
          })
      );

    new Setting(containerEl)
      .setName('Type folder')
      .setDesc('Markdown folder containing ontology type definitions.')
      .addText((text) =>
        text
          .setPlaceholder('_types')
          .setValue(this.plugin.pluginSettings.typeFolder)
          .onChange(async (value) => {
            this.plugin.pluginSettings.typeFolder = value.trim() || '_types';
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Schema file')
      .setDesc('Optional vault-relative JSON or YAML file that defines relations, interfaces, and types in one place.')
      .addText((text) =>
        text
          .setPlaceholder('_types/ontology.schema.yaml')
          .setValue(this.plugin.pluginSettings.schemaPath)
          .onChange(async (value) => {
            this.plugin.pluginSettings.schemaPath = value.trim();
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Entity type fields')
      .setDesc('One frontmatter field per line used to read ontology membership from entity notes. The first matching field wins.')
      .addTextArea((text) =>
        text
          .setPlaceholder('instance_of\ntype')
          .setValue(this.plugin.pluginSettings.entityTypeFields.join('\n'))
          .onChange(async (value) => {
            const fields = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            this.plugin.pluginSettings.entityTypeFields = fields.length > 0 ? fields : ['instance_of', 'type'];
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Cache path')
      .setDesc('Vault-relative JSON cache path.')
      .addText((text) =>
        text
          .setPlaceholder('.obsidian/ontology-cache.json')
          .setValue(this.plugin.pluginSettings.cachePath)
          .onChange(async (value) => {
            this.plugin.pluginSettings.cachePath = value.trim() || '.obsidian/ontology-cache.json';
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Default locked query results')
      .setDesc('Keep ontology-query results aligned with the trusted locked-state default.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.pluginSettings.queryOnlyLocked)
          .onChange(async (value) => {
            this.plugin.pluginSettings.queryOnlyLocked = value;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-update inverse relations')
      .setDesc('Automatically write missing inverse entries after rebuilds and note edits, only for relations declaring auto-update: true. Command-based fixing is always available.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.pluginSettings.autoUpdateInverses)
          .onChange(async (value) => {
            this.plugin.pluginSettings.autoUpdateInverses = value;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-scaffold entities')
      .setDesc('Automatically add inherited property and relation fields when a note has complete ontology membership frontmatter.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.pluginSettings.autoScaffoldEntities)
          .onChange(async (value) => {
            this.plugin.pluginSettings.autoScaffoldEntities = value;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Validation threshold')
      .setDesc('Entity count where validation should be treated as urgent.')
      .addText((text) =>
        text
          .setValue(String(this.plugin.pluginSettings.validationThreshold))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.pluginSettings.validationThreshold = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Ignored folders')
      .setDesc('One vault-relative folder path per line. Files in these folders are excluded from ontology indexing and validation.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Archive\nTemplates')
          .setValue(this.plugin.pluginSettings.foldersToIgnore.join('\n'))
          .onChange(async (value) => {
            this.plugin.pluginSettings.foldersToIgnore = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Ignored file patterns')
      .setDesc('One JavaScript regex per line matched against vault-relative file paths.')
      .addTextArea((text) =>
        text
          .setPlaceholder('^Daily/\n\\.canvas\\.md$')
          .setValue(this.plugin.pluginSettings.filesToIgnore.join('\n'))
          .onChange(async (value) => {
            this.plugin.pluginSettings.filesToIgnore = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName('Frontmatter ignore list')
      .setDesc('One frontmatter matcher per line, like "up: Philosopher". Matching entity notes are excluded from ontology indexing and validation.')
      .addTextArea((text) =>
        text
          .setPlaceholder('up: Philosopher\nontology-ignore')
          .setValue(formatFrontmatterIgnoreRules(this.plugin.pluginSettings.frontmatterIgnoreRules))
          .onChange(async (value) => {
            this.plugin.pluginSettings.frontmatterIgnoreRules = parseFrontmatterIgnoreRules(value);
            await this.plugin.savePluginSettings();
          })
      );
  }
}
