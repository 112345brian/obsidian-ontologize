import type { App } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { TypeEditorField, TypeEditorModel, TypeEditorRelation } from './ontology/type-editor.ts';

interface OntologyTypeEditorModalOptions {
  editing: boolean;
  model: TypeEditorModel;
  onSave: (model: TypeEditorModel) => Promise<boolean>;
}

function splitNames(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function emptyField(): TypeEditorField {
  return {
    cardinality: '', excludedTypes: [], frontmatterKey: '', includedTypes: [], insert: '', name: '', possibleValues: [], type: '', uses: '',
  };
}

function emptyRelation(): TypeEditorRelation {
  return {
    autoUpdate: false, cardinality: '', inverse: '', name: '', range: '', symmetric: false, transitive: false, uses: '', valueType: '',
  };
}

type TabId = 'general' | 'fields' | 'relations' | 'automation';

export class OntologyTypeEditorModal extends Modal {
  private saving = false;
  private activeTab: TabId = 'general';

  public constructor(app: App, private readonly options: OntologyTypeEditorModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass('ontology-type-editor-shell');
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    const { model } = this.options;
    contentEl.empty();
    contentEl.addClass('ontology-type-editor-modal');
    contentEl.createEl('h2', { text: this.options.editing ? `Edit ${model.name}` : 'Create Ontology Type' });

    // Tab bar
    const tabs = contentEl.createEl('div', { cls: 'ontology-editor-tabs' });
    const tabDefs: { id: TabId; label: string }[] = [
      { id: 'general', label: 'General' },
      { id: 'fields', label: 'Fields' },
      { id: 'relations', label: 'Relations' },
      { id: 'automation', label: 'Automation' },
    ];
    for (const tab of tabDefs) {
      const btn = tabs.createEl('button', {
        cls: `ontology-editor-tab${this.activeTab === tab.id ? ' is-active' : ''}`,
        text: tab.label,
      });
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.render();
      });
    }

    const panel = contentEl.createEl('div', { cls: 'ontology-editor-panel' });

    if (this.activeTab === 'general') {
      new Setting(panel)
        .setName('Type name')
        .setDesc(this.options.editing ? 'The file name determines the type name.' : 'Creates a Markdown constructor file in the configured type folder.')
        .addText((text) => {
          text.setPlaceholder('journal-entry').setValue(model.name).onChange((value) => { model.name = value.trim(); });
          if (this.options.editing) text.setDisabled(true);
        });

      new Setting(panel).setName('Locked').setDesc('Valid instances participate in locked queries.').addToggle((t) => t.setValue(model.lock).onChange((v) => { model.lock = v; }));
      new Setting(panel).setName('Abstract').setDesc('This type cannot be instantiated directly.').addToggle((t) => t.setValue(model.abstract).onChange((v) => { model.abstract = v; }));
      new Setting(panel).setName('Interface').setDesc('This constructor is composed through implements.').addToggle((t) => t.setValue(model.isInterface).onChange((v) => { model.isInterface = v; }));

      new Setting(panel).setName('Extends').setDesc('Parent types, separated by commas or lines.').addTextArea((text) => text.setPlaceholder('person').setValue(model.extends.join('\n')).onChange((v) => { model.extends = splitNames(v); }));
      new Setting(panel).setName('Implements').setDesc('Interfaces, separated by commas or lines.').addTextArea((text) => text.setPlaceholder('observable').setValue(model.implements.join('\n')).onChange((v) => { model.implements = splitNames(v); }));
      new Setting(panel).setName('Requires').setDesc('Classes an entity must already belong to before this class can apply.').addTextArea((text) => text.setPlaceholder('person').setValue(model.requires.join('\n')).onChange((v) => { model.requires = splitNames(v); }));
      new Setting(panel).setName('Excludes').setDesc('Classes that cannot coexist with this one on the same entity.').addTextArea((text) => text.setPlaceholder('building').setValue(model.excludes.join('\n')).onChange((v) => { model.excludes = splitNames(v); }));
      new Setting(panel).setName('Replaces').setDesc('Classes removed from the entity when this class is applied.').addTextArea((text) => text.setPlaceholder('friend').setValue(model.replaces.join('\n')).onChange((v) => { model.replaces = splitNames(v); }));
      new Setting(panel).setName('Template').setDesc('Templater template applied when this type is first assigned.').addText((text) => text.setPlaceholder('My Template').setValue(model.template).onChange((v) => { model.template = v.trim(); }));
    }

    if (this.activeTab === 'fields') {
      this.renderFieldSection(panel, 'Required fields', model.mustHave, 'must-have');
      this.renderFieldSection(panel, 'Optional fields', model.canHave, 'can-have');
    }

    if (this.activeTab === 'relations') {
      this.renderRelations(panel);
    }

    if (this.activeTab === 'automation') {
      this.renderAutoApply(panel);
    }

    this.renderActions(contentEl);
  }

  private renderAutoApply(containerEl: HTMLElement): void {
    const { model } = this.options;
    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    section.createEl('h3', { text: 'Auto-apply scaffold' });

    new Setting(section)
      .setName('When to apply')
      .setDesc('Automatically scaffold new entities of this type.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('never', 'Never')
          .addOption('always', 'Always')
          .addOption('conditional', 'When conditions match')
          .setValue(model.autoApplyMode)
          .onChange((value) => {
            model.autoApplyMode = value as TypeEditorModel['autoApplyMode'];
            this.render();
          });
      });

    if (model.autoApplyMode === 'conditional') {
      new Setting(section)
        .setName('Match')
        .addDropdown((dropdown) => {
          dropdown
            .addOption('all', 'All conditions')
            .addOption('any', 'Any condition')
            .setValue(model.autoApplyMatch)
            .onChange((value) => { model.autoApplyMatch = value as 'all' | 'any'; });
        });

      const condHeader = section.createEl('div', { cls: 'ontology-type-editor-header' });
      condHeader.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Conditions' });
      const addBtn = condHeader.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Add condition' }, text: '+' });
      addBtn.addEventListener('click', () => {
        model.autoApplyConditions.push({ key: '', value: '' });
        this.render();
      });

      for (const [index, condition] of model.autoApplyConditions.entries()) {
        new Setting(section)
          .addText((text) => text.setPlaceholder('frontmatter-key').setValue(condition.key).onChange((v) => { condition.key = v.trim(); }))
          .addText((text) => text.setPlaceholder('expected value').setValue(condition.value).onChange((v) => { condition.value = v; }))
          .addButton((btn) => btn.setIcon('trash-2').setTooltip('Remove').onClick(() => {
            model.autoApplyConditions.splice(index, 1);
            this.render();
          }));
      }
    }
  }

  private renderFieldSection(containerEl: HTMLElement, title: string, fields: TypeEditorField[], kind: string): void {
    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('h3', { text: title });
    const add = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `Add ${kind} field` }, text: '+' });
    add.addEventListener('click', () => {
      fields.push(emptyField());
      this.render();
    });

    for (const [index, field] of fields.entries()) {
      const row = section.createEl('div', { cls: 'ontology-type-editor-field' });
      new Setting(row)
        .setName(field.name || 'New field')
        .addText((text) => text.setPlaceholder('field-name').setValue(field.name).onChange((value) => { field.name = value.trim(); }))
        .addText((text) => text.setPlaceholder('type or union').setValue(field.type).onChange((value) => { field.type = value; }))
        .addText((text) => text.setPlaceholder('uses').setValue(field.uses).onChange((value) => { field.uses = value.trim(); }))
        .addText((text) => text.setPlaceholder('insert').setValue(field.insert).onChange((value) => { field.insert = value; }))
        .addDropdown((dropdown) => dropdown
          .addOption('', 'Any cardinality')
          .addOption('one', 'One')
          .addOption('one-to-one', 'One-to-one')
          .setValue(field.cardinality)
          .onChange((value) => { field.cardinality = value; }))
        .addButton((button) => button.setIcon('trash-2').setTooltip('Remove field').onClick(() => {
          fields.splice(index, 1);
          this.render();
        }));
      new Setting(row)
        .setName('Advanced constraints')
        .addText((text) => text.setPlaceholder('frontmatter-key').setValue(field.frontmatterKey).onChange((value) => { field.frontmatterKey = value.trim(); }))
        .addText((text) => text.setPlaceholder('included types').setValue(field.includedTypes.join(', ')).onChange((value) => { field.includedTypes = splitNames(value); }))
        .addText((text) => text.setPlaceholder('excluded types').setValue(field.excludedTypes.join(', ')).onChange((value) => { field.excludedTypes = splitNames(value); }))
        .addText((text) => text.setPlaceholder('possible values').setValue(field.possibleValues.join(', ')).onChange((value) => { field.possibleValues = splitNames(value); }));
    }
  }

  private renderRelations(containerEl: HTMLElement): void {
    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('h3', { text: 'Relations' });
    const add = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Add relation' }, text: '+' });
    add.addEventListener('click', () => {
      this.options.model.relations.push(emptyRelation());
      this.render();
    });
    for (const [index, relation] of this.options.model.relations.entries()) {
      const row = section.createEl('div', { cls: 'ontology-type-editor-field' });
      new Setting(row)
        .setName(relation.name || 'New relation')
        .addText((text) => text.setPlaceholder('relation-name').setValue(relation.name).onChange((value) => { relation.name = value.trim(); }))
        .addText((text) => text.setPlaceholder('uses').setValue(relation.uses).onChange((value) => { relation.uses = value.trim(); }))
        .addText((text) => text.setPlaceholder('value type').setValue(relation.valueType).onChange((value) => { relation.valueType = value; }))
        .addText((text) => text.setPlaceholder('range').setValue(relation.range).onChange((value) => { relation.range = value; }))
        .addText((text) => text.setPlaceholder('inverse').setValue(relation.inverse).onChange((value) => { relation.inverse = value.trim(); }))
        .addButton((button) => button.setIcon('trash-2').setTooltip('Remove relation').onClick(() => {
          this.options.model.relations.splice(index, 1);
          this.render();
        }));
      new Setting(row)
        .setName('Relation behavior')
        .addDropdown((dropdown) => dropdown.addOption('', 'Any cardinality').addOption('one', 'One').addOption('one-to-one', 'One-to-one').setValue(relation.cardinality).onChange((value) => { relation.cardinality = value; }))
        .addToggle((toggle) => toggle.setTooltip('Symmetric').setValue(relation.symmetric).onChange((value) => { relation.symmetric = value; }))
        .addToggle((toggle) => toggle.setTooltip('Transitive').setValue(relation.transitive).onChange((value) => { relation.transitive = value; }))
        .addToggle((toggle) => toggle.setTooltip('Auto-update inverse').setValue(relation.autoUpdate).onChange((value) => { relation.autoUpdate = value; }));
    }
  }

  private renderActions(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Actions')
      .addButton((button) => button.setButtonText('Cancel').onClick(() => { this.close(); }))
      .addButton((button) => button.setButtonText(this.options.editing ? 'Save changes' : 'Create type').setCta().onClick(async () => {
        if (this.saving) {
          return;
        }
        if (!this.options.model.name || /[\\/]/.test(this.options.model.name)) {
          new Notice('Type name is required and cannot contain a path separator.');
          return;
        }
        this.saving = true;
        button.setDisabled(true);
        try {
          if (await this.options.onSave(this.options.model)) {
            this.close();
          }
        } finally {
          this.saving = false;
          button.setDisabled(false);
        }
      }));
  }
}
