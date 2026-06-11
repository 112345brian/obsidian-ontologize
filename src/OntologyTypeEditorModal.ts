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

export class OntologyTypeEditorModal extends Modal {
  private saving = false;

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

    new Setting(contentEl)
      .setName('Type name')
      .setDesc(this.options.editing ? 'The file name determines the type name.' : 'Creates a Markdown constructor file in the configured type folder.')
      .addText((text) => {
        text.setPlaceholder('journal-entry').setValue(model.name).onChange((value) => { model.name = value.trim(); });
        if (this.options.editing) {
          text.setDisabled(true);
        }
      });

    const behavior = contentEl.createEl('section', { cls: 'ontology-type-editor-section' });
    behavior.createEl('h3', { text: 'Behavior' });
    new Setting(behavior).setName('Locked').setDesc('Valid instances participate in locked queries.').addToggle((toggle) => toggle.setValue(model.lock).onChange((value) => { model.lock = value; }));
    new Setting(behavior).setName('Abstract').setDesc('This type cannot be instantiated directly.').addToggle((toggle) => toggle.setValue(model.abstract).onChange((value) => { model.abstract = value; }));
    new Setting(behavior).setName('Interface').setDesc('This constructor is composed through implements.').addToggle((toggle) => toggle.setValue(model.isInterface).onChange((value) => { model.isInterface = value; }));

    new Setting(contentEl)
      .setName('Extends')
      .setDesc('Parent types, separated by commas or lines.')
      .addTextArea((text) => text.setPlaceholder('person').setValue(model.extends.join('\n')).onChange((value) => { model.extends = splitNames(value); }));

    new Setting(contentEl)
      .setName('Implements')
      .setDesc('Interfaces, separated by commas or lines.')
      .addTextArea((text) => text.setPlaceholder('observable').setValue(model.implements.join('\n')).onChange((value) => { model.implements = splitNames(value); }));

    new Setting(contentEl)
      .setName('Requires')
      .setDesc('Classes an entity must already belong to before this class can apply. One per line.')
      .addTextArea((text) => text.setPlaceholder('person').setValue(model.requires.join('\n')).onChange((value) => { model.requires = splitNames(value); }));

    new Setting(contentEl)
      .setName('Excludes')
      .setDesc('Classes that cannot coexist with this one on the same entity. One per line.')
      .addTextArea((text) => text.setPlaceholder('building').setValue(model.excludes.join('\n')).onChange((value) => { model.excludes = splitNames(value); }));

    new Setting(contentEl)
      .setName('Replaces')
      .setDesc('Classes removed from the entity when this class is applied. One per line.')
      .addTextArea((text) => text.setPlaceholder('friend').setValue(model.replaces.join('\n')).onChange((value) => { model.replaces = splitNames(value); }));

    new Setting(contentEl)
      .setName('Template')
      .setDesc('Templater template applied to a new entity when this type is first assigned. Leave blank for none.')
      .addText((text) => text.setPlaceholder('My Template').setValue(model.template).onChange((value) => { model.template = value.trim(); }));

    this.renderFieldSection(contentEl, 'Required fields', model.mustHave, 'must-have');
    this.renderFieldSection(contentEl, 'Optional fields', model.canHave, 'can-have');
    this.renderRelations(contentEl);
    this.renderActions(contentEl);
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
