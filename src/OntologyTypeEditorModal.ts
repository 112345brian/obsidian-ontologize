import type { App, TFile } from 'obsidian';

import { AbstractInputSuggest, Modal, Notice, setIcon, Setting, ToggleComponent } from 'obsidian';

import type { TypeEditorField, TypeEditorModel, TypeEditorRelation, TypeEditorRule } from './ontology/type-editor.ts';
import { TagInput } from './TagInput.ts';

export interface OntologyTypeEditorModalOptions {
  editing: boolean;
  interfaceNames: string[];
  model: TypeEditorModel;
  onSave: (model: TypeEditorModel) => Promise<boolean>;
  typeNames: string[];
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

function templateLinkpath(file: TFile): string {
  return file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path;
}

class TemplateFileSuggest extends AbstractInputSuggest<TFile> {
  public constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly files: () => TFile[],
    private readonly onChoose: (linkpath: string) => void,
  ) {
    super(app, inputEl);
  }

  protected override getSuggestions(query: string): TFile[] {
    const normalized = query.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').toLowerCase();
    return this.files()
      .filter((file) => !normalized || file.basename.toLowerCase().includes(normalized) || file.path.toLowerCase().includes(normalized))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  public override renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl('div', { cls: 'suggestion-title', text: file.basename });
    el.createEl('div', { cls: 'suggestion-note', text: file.path });
  }

  public override selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
    const linkpath = templateLinkpath(file);
    this.setValue(linkpath);
    this.onChoose(linkpath);
    this.close();
  }
}

type TabId = 'general' | 'fields' | 'relations' | 'automation';

export class OntologyTypeEditorModal extends Modal {
  private saving = false;
  private activeTab: TabId = 'general';
  private templateSuggest: TemplateFileSuggest | null = null;

  public constructor(app: App, private readonly options: OntologyTypeEditorModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass('ontology-type-editor-shell');
    this.render();
  }

  public override onClose(): void {
    this.templateSuggest?.close();
    this.templateSuggest = null;
  }

  private render(): void {
    const { contentEl } = this;
    const { model } = this.options;
    this.templateSuggest?.close();
    this.templateSuggest = null;
    contentEl.empty();
    contentEl.addClass('ontology-type-editor-modal');
    contentEl.createEl('h2', { text: this.options.editing ? `Edit ${model.name}` : 'Create Ontology Type' });

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
      this.renderGeneral(panel);
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

  private addTagSetting(
    container: HTMLElement,
    name: string,
    desc: string,
    values: string[],
    suggestions: string[],
    onChange: (values: string[]) => void,
    placeholder?: string,
  ): void {
    const setting = new Setting(container).setName(name).setDesc(desc);
    setting.controlEl.empty();
    new TagInput(setting.controlEl, values, {
      onChange,
      ...(placeholder ? { placeholder } : {}),
      suggestions,
    });
  }

  private renderGeneral(panel: HTMLElement): void {
    const { model } = this.options;
    const { typeNames, interfaceNames } = this.options;

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

    this.addTagSetting(panel, 'Extends', 'Parent types.', model.extends, typeNames, (v) => { model.extends = v; });
    this.addTagSetting(panel, 'Implements', 'Interfaces this type composes.', model.implements, interfaceNames, (v) => { model.implements = v; });
    this.renderRules(panel);

    if (model.isInterface) {
      this.addTagSetting(panel, 'Implementable by', 'Only these types (and their subtypes) may implement this interface.', model.implementableBy, typeNames, (v) => { model.implementableBy = v; });
    }

    new Setting(panel)
      .setName('Template')
      .setDesc('Markdown template applied when this type is first assigned. Start typing to search files in the vault.')
      .addText((text) => {
        text.setPlaceholder('Templates/Person').setValue(model.template).onChange((value) => { model.template = value.trim(); });
        this.templateSuggest = new TemplateFileSuggest(
          this.app,
          text.inputEl,
          () => this.app.vault.getMarkdownFiles(),
          (linkpath) => { model.template = linkpath; },
        );
      });
  }

  private renderRules(containerEl: HTMLElement): void {
    const { model } = this.options;
    if (model.rules.length === 0) {
      model.rules.push({ kind: 'requires', value: '' });
    }
    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('h3', { text: 'Rules' });
    const add = header.createEl('button', { cls: 'ontology-editor-add-button', attr: { 'aria-label': 'Add rule' }, text: 'Add rule' });
    add.addEventListener('click', () => {
      model.rules.push({ kind: 'requires', value: '' });
      this.render();
    });
    section.createEl('p', {
      cls: 'setting-item-description',
      text: 'Add membership constraints or transform a field value when this type is applied.',
    });

    for (const [index, rule] of model.rules.entries()) {
      const card = section.createEl('div', { cls: 'ontology-type-editor-field ontology-rule-card' });
      const rowHeader = card.createEl('div', { cls: 'ontology-type-editor-row-header' });
      const ruleName = rule.kind === 'requires' ? 'Requires' : rule.kind === 'excludes' ? 'Excludes' : 'Replaces';
      rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: `${ruleName} rule` });
      this.addItemDeleteButton(rowHeader, 'Remove rule', () => { model.rules.splice(index, 1); this.render(); });

      new Setting(card)
        .setName('Rule type')
        .setDesc('Choose what must be present, what cannot coexist, or what value should be replaced.')
        .addDropdown((dropdown) => dropdown
          .addOption('requires', 'Requires')
          .addOption('excludes', 'Excludes')
          .addOption('replaces', 'Replaces')
          .setValue(rule.kind)
          .onChange((value) => {
            const kind = value as TypeEditorRule['kind'];
            model.rules[index] = kind === 'replaces'
              ? { kind, newValue: model.name, value: rule.value }
              : { kind, value: rule.value };
            this.render();
          }));

      if (rule.kind !== 'replaces') {
        new Setting(card)
          .setName(rule.kind === 'requires' ? 'Required type' : 'Excluded type')
          .setDesc(rule.kind === 'requires'
            ? 'Entities of this type must also belong to this type.'
            : 'Entities cannot belong to this type at the same time.')
          .addText((text) => text
            .setPlaceholder('type name')
            .setValue(rule.value)
            .onChange((value) => { rule.value = value.trim(); }));
        continue;
      }

      const grid = card.createEl('div', { cls: 'ontology-replacement-grid' });
      grid.createEl('span', { cls: 'ontology-replacement-grid-spacer' });
      grid.createEl('span', { cls: 'ontology-replacement-column-label', text: 'Field' });
      grid.createEl('span', { cls: 'ontology-replacement-column-label', text: 'Value' });

      const addInput = (
        rowName: string,
        fieldValue: string,
        fieldPlaceholder: string,
        value: string,
        valuePlaceholder: string,
        onFieldChange: (next: string) => void,
        onValueChange: (next: string) => void,
      ): void => {
        grid.createEl('span', { cls: 'ontology-replacement-row-label', text: rowName });
        const fieldInput = grid.createEl('input', { attr: { 'aria-label': `${rowName} field`, placeholder: fieldPlaceholder, type: 'text' } });
        fieldInput.value = fieldValue;
        fieldInput.addEventListener('input', () => { onFieldChange(fieldInput.value.trim()); });
        const valueInput = grid.createEl('input', { attr: { 'aria-label': `${rowName} value`, placeholder: valuePlaceholder, type: 'text' } });
        valueInput.value = value;
        valueInput.addEventListener('input', () => { onValueChange(valueInput.value.trim()); });
      };

      addInput(
        'Original',
        rule.field ?? '',
        'all type fields',
        rule.value,
        'value to replace',
        (value) => { rule.field = value || undefined; },
        (value) => { rule.value = value; },
      );
      addInput(
        'New',
        rule.newField ?? '',
        'same field',
        rule.newValue ?? '',
        'blank removes only',
        (value) => { rule.newField = value || undefined; },
        (value) => { rule.newValue = value || undefined; },
      );
    }
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

  private addItemDeleteButton(container: HTMLElement, label: string, onDelete: () => void): void {
    const btn = container.createEl('button', { cls: 'clickable-icon ontology-item-delete', attr: { 'aria-label': label } });
    setIcon(btn, 'trash-2');
    btn.addEventListener('click', onDelete);
  }

  private renderFieldSection(containerEl: HTMLElement, title: string, fields: TypeEditorField[], kind: string): void {
    const { typeNames } = this.options;
    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('h3', { text: title });
    const add = header.createEl('button', { cls: 'ontology-editor-add-button', attr: { 'aria-label': `Add ${kind} field` }, text: 'Add field' });
    add.addEventListener('click', () => {
      fields.push(emptyField());
      this.render();
    });
    section.createEl('p', {
      cls: 'setting-item-description ontology-type-editor-section-desc',
      text: kind === 'must-have'
        ? 'Every entity of this type must have these frontmatter fields.'
        : 'Entities of this type may use these frontmatter fields, but they are not required.',
    });

    for (const [index, field] of fields.entries()) {
      const row = section.createEl('div', { cls: 'ontology-type-editor-field' });

      const rowHeader = row.createEl('div', { cls: 'ontology-type-editor-row-header' });
      const rowLabel = rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: field.name || 'New field' });
      this.addItemDeleteButton(rowHeader, 'Remove field', () => { fields.splice(index, 1); this.render(); });

      const primary = row.createEl('div', { cls: 'ontology-field-primary' });
      new Setting(primary)
        .setName('Field name')
        .setDesc('Schema field name. It is also the YAML key unless overridden below.')
        .addText((text) => text
          .setPlaceholder('birth-year')
          .setValue(field.name)
          .onChange((value) => {
            field.name = value.trim();
            rowLabel.textContent = field.name || 'New field';
          }));

      new Setting(primary)
        .setName('Value type')
        .setDesc('Accepted data type. Unions such as “wikilink | string” are supported.')
        .addText((text) => text
          .setPlaceholder('string, number, wikilink…')
          .setValue(field.type)
          .onChange((value) => { field.type = value; }));

      new Setting(primary)
        .setName('Cardinality')
        .setDesc('Whether the field may contain multiple values.')
        .addDropdown((dropdown) => dropdown
          .addOption('', 'Unrestricted')
          .addOption('one', 'One value')
          .addOption('one-to-one', 'One-to-one')
          .setValue(field.cardinality)
          .onChange((value) => { field.cardinality = value; }));

      const advanced = row.createEl('details', { cls: 'ontology-field-advanced' });
      advanced.open = Boolean(
        field.uses
        || field.insert
        || field.frontmatterKey
        || field.includedTypes.length
        || field.excludedTypes.length
        || field.possibleValues.length
      );
      advanced.createEl('summary', { text: 'Advanced field options' });

      new Setting(advanced)
        .setName('Use global field')
        .setDesc('Inherit a definition from the global field registry.')
        .addText((text) => text
          .setPlaceholder('global field name')
          .setValue(field.uses)
          .onChange((value) => { field.uses = value.trim(); }));

      new Setting(advanced)
        .setName('Scaffold value')
        .setDesc('Value inserted when scaffolding an entity that does not have this field.')
        .addText((text) => text
          .setPlaceholder('value or template expression')
          .setValue(field.insert)
          .onChange((value) => { field.insert = value; }));

      new Setting(advanced)
        .setName('Frontmatter key')
        .setDesc('Store this field under a different YAML property name.')
        .addText((text) => text
          .setPlaceholder('defaults to field name')
          .setValue(field.frontmatterKey)
          .onChange((value) => { field.frontmatterKey = value.trim(); }));

      const constraintEl = advanced.createEl('div', { cls: 'ontology-field-tag-group' });

      const incLabel = constraintEl.createEl('span', { cls: 'ontology-field-tag-label', text: 'Allowed linked types' });
      const incWrap = constraintEl.createEl('div');
      new TagInput(incWrap, field.includedTypes, { onChange: (v) => { field.includedTypes = v; }, placeholder: 'Add allowed type', suggestions: typeNames });
      constraintEl.appendChild(incLabel);
      constraintEl.appendChild(incWrap);

      const excLabel = constraintEl.createEl('span', { cls: 'ontology-field-tag-label', text: 'Disallowed linked types' });
      const excWrap = constraintEl.createEl('div');
      new TagInput(excWrap, field.excludedTypes, { onChange: (v) => { field.excludedTypes = v; }, placeholder: 'Add disallowed type', suggestions: typeNames });
      constraintEl.appendChild(excLabel);
      constraintEl.appendChild(excWrap);

      const valLabel = constraintEl.createEl('span', { cls: 'ontology-field-tag-label', text: 'Allowed literal values' });
      const valWrap = constraintEl.createEl('div');
      new TagInput(valWrap, field.possibleValues, { onChange: (v) => { field.possibleValues = v; }, placeholder: 'Add allowed value' });
      constraintEl.appendChild(valLabel);
      constraintEl.appendChild(valWrap);
    }
  }

  private renderRelations(containerEl: HTMLElement): void {
    const { typeNames } = this.options;
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

      const rowHeader = row.createEl('div', { cls: 'ontology-type-editor-row-header' });
      rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: relation.name || 'New relation' });
      this.addItemDeleteButton(rowHeader, 'Remove relation', () => { this.options.model.relations.splice(index, 1); this.render(); });

      new Setting(row)
        .addText((text) => text.setPlaceholder('relation-name').setValue(relation.name).onChange((value) => { relation.name = value.trim(); rowHeader.querySelector('.ontology-type-editor-row-label')!.textContent = value.trim() || 'New relation'; }))
        .addText((text) => text.setPlaceholder('uses').setValue(relation.uses).onChange((value) => { relation.uses = value.trim(); }))
        .addText((text) => text.setPlaceholder('value type').setValue(relation.valueType).onChange((value) => { relation.valueType = value; }))
        .addText((text) => text.setPlaceholder('inverse').setValue(relation.inverse).onChange((value) => { relation.inverse = value.trim(); }));

      const rangeSetting = new Setting(row).setName('Range');
      rangeSetting.controlEl.empty();
      new TagInput(rangeSetting.controlEl, relation.range ? [relation.range] : [], {
        onChange: (v) => { relation.range = v[0] ?? ''; },
        placeholder: 'range type',
        suggestions: typeNames,
      });

      const behaviorSetting = new Setting(row).setName('Behavior');
      behaviorSetting.addDropdown((dropdown) => dropdown
        .addOption('', 'Any cardinality')
        .addOption('one', 'One')
        .addOption('one-to-one', 'One-to-one')
        .setValue(relation.cardinality)
        .onChange((value) => { relation.cardinality = value; }));

      const toggleGroup = behaviorSetting.controlEl.createEl('div', { cls: 'ontology-toggle-group' });
      for (const [label, get, set] of [
        ['Symmetric', () => relation.symmetric, (v: boolean) => { relation.symmetric = v; }],
        ['Transitive', () => relation.transitive, (v: boolean) => { relation.transitive = v; }],
        ['Auto-update', () => relation.autoUpdate, (v: boolean) => { relation.autoUpdate = v; }],
      ] as [string, () => boolean, (v: boolean) => void][]) {
        const item = toggleGroup.createEl('div', { cls: 'ontology-toggle-item' });
        item.createEl('span', { cls: 'ontology-toggle-item-label', text: label });
        new ToggleComponent(item).setValue(get()).onChange(set);
      }
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
