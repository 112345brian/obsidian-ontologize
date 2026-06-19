import type { App, TFile } from 'obsidian';

import { AbstractInputSuggest, Modal, Notice, setIcon, Setting, ToggleComponent } from 'obsidian';

import type { OntologyIndex } from './ontology/types.ts';
import type { TypeEditorField, TypeEditorModel, TypeEditorRelation, TypeEditorRule } from './ontology/type-editor.ts';
import { TagInput } from './TagInput.ts';

export interface OntologyTypeEditorModalOptions {
  editing: boolean;
  index: OntologyIndex;
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

type TabId = 'definition' | 'properties' | 'constraints' | 'recognition' | 'formatting';

export class OntologyTypeEditorModal extends Modal {
  private saving = false;
  private activeTab: TabId = 'definition';
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
      { id: 'definition', label: 'Definition' },
      { id: 'properties', label: 'Properties' },
      { id: 'constraints', label: 'Constraints' },
      { id: 'recognition', label: 'Recognition' },
      { id: 'formatting', label: 'Formatting' },
    ];
    for (const tab of tabDefs) {
      const btn = tabs.createEl('button', {
        cls: `ontology-editor-tab${this.activeTab === tab.id ? ' is-active' : ''}`,
        text: tab.label,
      });
      btn.addEventListener('click', () => { this.activeTab = tab.id; this.render(); });
    }

    const withPreview = this.activeTab === 'properties' || this.activeTab === 'constraints';
    const body = contentEl.createEl('div', { cls: withPreview ? 'ontology-editor-body ontology-editor-body--split' : 'ontology-editor-body' });
    const panel = body.createEl('div', { cls: 'ontology-editor-panel' });

    if (this.activeTab === 'definition') { this.renderDefinition(panel); }
    if (this.activeTab === 'properties') {
      this.renderFieldSection(panel, 'Required fields', model.mustHave, 'must-have');
      this.renderFieldSection(panel, 'Optional fields', model.canHave, 'can-have');
      this.renderRelations(panel);
    }
    if (this.activeTab === 'constraints') { this.renderConstraints(panel); }
    if (this.activeTab === 'recognition') { this.renderRecognition(panel); }
    if (this.activeTab === 'formatting') { this.renderFormatting(panel); }

    if (withPreview) {
      const preview = body.createEl('div', { cls: 'ontology-editor-preview' });
      this.renderFrontmatterPreview(preview);
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

  private renderDefinition(panel: HTMLElement): void {
    const { model } = this.options;
    const { typeNames, interfaceNames } = this.options;

    new Setting(panel)
      .setName('Type name')
      .setDesc(this.options.editing ? 'The file name determines the type name.' : 'Creates a Markdown file in the configured type folder.')
      .addText((text) => {
        text.setPlaceholder('journal-entry').setValue(model.name).onChange((value) => { model.name = value.trim(); });
        if (this.options.editing) text.setDisabled(true);
      });

    new Setting(panel).setName('Locked').setDesc('Valid instances participate in locked queries.').addToggle((t) => t.setValue(model.lock).onChange((v) => { model.lock = v; }));
    new Setting(panel).setName('Abstract').setDesc('Cannot be instantiated directly.').addToggle((t) => t.setValue(model.abstract).onChange((v) => { model.abstract = v; }));
    new Setting(panel).setName('Interface').setDesc('Composed via implements rather than instantiated.').addToggle((t) => t.setValue(model.isInterface).onChange((v) => { model.isInterface = v; this.render(); }));

    this.addTagSetting(panel, 'Extends', 'Parent types.', model.extends, typeNames, (v) => { model.extends = v; });
    this.addTagSetting(panel, 'Implements', 'Interfaces this type composes.', model.implements, interfaceNames, (v) => { model.implements = v; });

    if (model.isInterface) {
      this.addTagSetting(panel, 'Implementable by', 'Only these types (and their subtypes) may implement this interface.', model.implementableBy, typeNames, (v) => { model.implementableBy = v; });
    }
  }

  private renderFrontmatterPreview(container: HTMLElement): void {
    const { model, index } = this.options;

    container.createEl('div', { cls: 'ontology-preview-label', text: 'Instance preview' });
    const pre = container.createEl('pre', { cls: 'ontology-preview-yaml' });

    // Collect the inheritance chain from the index
    const chain: Array<{ name: string; fields: Array<{ key: string; value: string; insert: string; required: boolean }> }> = [];
    const visited = new Set<string>();

    const collectType = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);
      const t = index.types.get(name);
      if (!t) return;
      for (const parent of t.extends) { collectType(parent); }
      const fields: Array<{ key: string; value: string; insert: string; required: boolean }> = [];
      for (const [k, def] of t.mustHave) {
        const insert = def.insert !== undefined
          ? (typeof def.insert === 'string' ? def.insert : JSON.stringify(def.insert))
          : '';
        fields.push({ insert, key: k, required: true, value: def.type ?? '' });
      }
      for (const [k, def] of t.canHave) {
        fields.push({ insert: '', key: k, required: false, value: def.type ?? '' });
      }
      if (fields.length > 0) chain.push({ fields, name });
    };

    for (const parent of model.extends) { collectType(parent); }

    // Own fields from the live model
    const ownFields: Array<{ key: string; value: string; insert: string; required: boolean }> = [
      ...model.mustHave.filter((f) => f.name.trim()).map((f) => ({ insert: f.insert, key: f.name, required: true, value: f.type })),
      ...model.canHave.filter((f) => f.name.trim()).map((f) => ({ insert: f.insert, key: f.name, required: false, value: f.type })),
    ];

    let yaml = '';

    // Track keys already shown so inherited/own fields don't repeat them.
    const shownKeys = new Set<string>();

    // Show ingest-from triggers as the type declaration mechanism.
    // If none are defined, fall back to showing is-instance so the user
    // knows they'll need an explicit declaration.
    if (model.ingestFrom.length > 0) {
      for (const { field, target } of model.ingestFrom) {
        const link = target.startsWith('[[') ? target : `[[${target}]]`;
        yaml += `${field}: "${link}"\n`;
        shownKeys.add(field);
      }
    } else if (model.name) {
      yaml += `is-instance: "[[${model.name}]]"\n`;
      shownKeys.add('is-instance');
    }

    for (const { name, fields } of chain) {
      const visible = fields.filter((f) => !shownKeys.has(f.key));
      if (visible.length === 0) continue;
      yaml += `\n# ↑ inherited from ${name}\n`;
      for (const f of visible) {
        const val = f.insert || (f.value ? `# ${f.value}` : f.required ? '# required' : '# optional');
        yaml += `${f.key}: ${val}\n`;
        shownKeys.add(f.key);
      }
    }

    const visibleOwn = ownFields.filter((f) => !shownKeys.has(f.key));
    if (visibleOwn.length > 0) {
      yaml += chain.length > 0 ? '\n# ── this type ──\n' : '';
      for (const f of visibleOwn) {
        const val = f.insert || (f.value ? `# ${f.value}` : f.required ? '# required' : '# optional');
        yaml += `${f.key}: ${val}\n`;
      }
    }

    if (model.rules.some((r) => r.kind === 'requires')) {
      yaml += '\n# ── constraints ──\n';
      for (const r of model.rules.filter((r) => r.kind === 'requires')) {
        const auto = model.alsoApply.includes(r.value);
        yaml += `# requires: [[${r.value}]]${auto ? ' (auto-applied)' : ''}\n`;
      }
    }

    if (!yaml.trim()) {
      yaml = '# No fields defined yet';
    }

    pre.textContent = yaml;
  }

  private renderFormatting(panel: HTMLElement): void {
    const { model } = this.options;

    new Setting(panel)
      .setName('Template')
      .setDesc('Markdown template applied once when an instance is first recognized or typed.')
      .addText((text) => {
        text.setPlaceholder('Templates/Person').setValue(model.template).onChange((value) => { model.template = value.trim(); });
        this.templateSuggest = new TemplateFileSuggest(
          this.app,
          text.inputEl,
          () => this.app.vault.getMarkdownFiles(),
          (linkpath) => { model.template = linkpath; },
        );
      });

    this.renderAutoApplyScaffold(panel);
    this.renderReplacements(panel);
  }

  private renderConstraints(containerEl: HTMLElement): void {
    const { model } = this.options;
    const constraints = model.rules.filter((r) => r.kind !== 'replaces');
    const constraintIndices = model.rules.map((r, i) => r.kind !== 'replaces' ? i : -1).filter((i) => i !== -1);

    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Constraints' });
    const add = header.createEl('button', { cls: 'ontology-editor-add-button', attr: { 'aria-label': 'Add constraint' }, text: 'Add constraint' });
    add.addEventListener('click', () => { model.rules.push({ kind: 'requires', value: '' }); this.render(); });
    section.createEl('p', { cls: 'setting-item-description', text: 'Membership rules: what other types must or cannot coexist with this one.' });

    for (const [i, rule] of constraints.entries()) {
      const index = constraintIndices[i];
      const card = section.createEl('div', { cls: 'ontology-type-editor-field ontology-rule-card' });
      const rowHeader = card.createEl('div', { cls: 'ontology-type-editor-row-header' });
      rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: rule.kind === 'requires' ? 'Requires' : 'Excludes' });
      this.addItemDeleteButton(rowHeader, 'Remove constraint', () => { model.rules.splice(index, 1); this.render(); });

      new Setting(card)
        .setName('Kind')
        .addDropdown((d) => d
          .addOption('requires', 'Requires')
          .addOption('excludes', 'Excludes')
          .setValue(rule.kind)
          .onChange((value) => {
            const prev = rule.value;
            model.rules[index] = { kind: value as 'requires' | 'excludes', value: prev };
            if (value === 'excludes') {
              model.alsoApply = model.alsoApply.filter((t) => t !== prev);
            }
            this.render();
          }));

      new Setting(card)
        .setName(rule.kind === 'requires' ? 'Required type' : 'Excluded type')
        .setDesc(rule.kind === 'requires' ? 'Lint error if an instance does not also belong to this type.' : 'Lint error if an instance belongs to this type at the same time.')
        .addText((text) => text.setPlaceholder('type name').setValue(rule.value).onChange((v) => {
          const prev = rule.value;
          rule.value = v.trim();
          const idx = model.alsoApply.indexOf(prev);
          if (idx !== -1) { model.alsoApply[idx] = rule.value; }
        }));

      if (rule.kind === 'requires') {
        new Setting(card)
          .setName('Apply on construction')
          .setDesc('When this type is applied, also stamp the required type automatically.')
          .addToggle((t) => t
            .setValue(model.alsoApply.includes(rule.value))
            .onChange((on) => {
              if (on) {
                if (rule.value && !model.alsoApply.includes(rule.value)) {
                  model.alsoApply.push(rule.value);
                }
              } else {
                model.alsoApply = model.alsoApply.filter((t) => t !== rule.value);
              }
            }));
      }
    }
  }

  private renderReplacements(containerEl: HTMLElement): void {
    const { model } = this.options;
    const replacements = model.rules.filter((r): r is Extract<TypeEditorRule, { kind: 'replaces' }> => r.kind === 'replaces');
    const replacementIndices = model.rules.map((r, i) => r.kind === 'replaces' ? i : -1).filter((i) => i !== -1);

    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const header = section.createEl('div', { cls: 'ontology-type-editor-header' });
    header.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Field replacements' });
    const add = header.createEl('button', { cls: 'ontology-editor-add-button', attr: { 'aria-label': 'Add replacement' }, text: 'Add replacement' });
    add.addEventListener('click', () => { model.rules.push({ kind: 'replaces', newValue: model.name, value: '' }); this.render(); });
    section.createEl('p', { cls: 'setting-item-description', text: 'When this type is applied, replace old field values with new ones.' });

    for (const [i, rule] of replacements.entries()) {
      const index = replacementIndices[i];
      const card = section.createEl('div', { cls: 'ontology-type-editor-field ontology-rule-card' });
      const rowHeader = card.createEl('div', { cls: 'ontology-type-editor-row-header' });
      rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: 'Replaces' });
      this.addItemDeleteButton(rowHeader, 'Remove replacement', () => { model.rules.splice(index, 1); this.render(); });

      const grid = card.createEl('div', { cls: 'ontology-replacement-grid' });
      grid.createEl('span', { cls: 'ontology-replacement-grid-spacer' });
      grid.createEl('span', { cls: 'ontology-replacement-column-label', text: 'Field' });
      grid.createEl('span', { cls: 'ontology-replacement-column-label', text: 'Value' });

      const addInput = (rowName: string, fieldValue: string, fieldPlaceholder: string, value: string, valuePlaceholder: string, onFieldChange: (next: string) => void, onValueChange: (next: string) => void): void => {
        grid.createEl('span', { cls: 'ontology-replacement-row-label', text: rowName });
        const fieldInput = grid.createEl('input', { attr: { 'aria-label': `${rowName} field`, placeholder: fieldPlaceholder, type: 'text' } });
        fieldInput.value = fieldValue;
        fieldInput.addEventListener('input', () => { onFieldChange(fieldInput.value.trim()); });
        const valueInput = grid.createEl('input', { attr: { 'aria-label': `${rowName} value`, placeholder: valuePlaceholder, type: 'text' } });
        valueInput.value = value;
        valueInput.addEventListener('input', () => { onValueChange(valueInput.value.trim()); });
      };

      addInput('Original', rule.field ?? '', 'all type fields', rule.value, 'value to replace', (v) => { rule.field = v || undefined; }, (v) => { rule.value = v; });
      addInput('New', rule.newField ?? '', 'same field', rule.newValue ?? '', 'blank removes only', (v) => { rule.newField = v || undefined; }, (v) => { rule.newValue = v || undefined; });
    }
  }

  private renderRecognition(containerEl: HTMLElement): void {
    const { model } = this.options;

    const ingestSection = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    const ingestHeader = ingestSection.createEl('div', { cls: 'ontology-type-editor-header' });
    ingestHeader.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Ingest from fields' });
    const ingestAdd = ingestHeader.createEl('button', { cls: 'ontology-editor-add-button', attr: { 'aria-label': 'Add ingest rule' }, text: 'Add rule' });
    ingestAdd.addEventListener('click', () => { model.ingestFrom.push({ field: '', target: '' }); this.render(); });
    ingestSection.createEl('p', {
      cls: 'setting-item-description ontology-type-editor-section-desc',
      text: 'When a note\'s frontmatter field links to the target note, it is recognized as this type. Formatting is applied automatically once recognized.',
    });
    for (const [i, entry] of model.ingestFrom.entries()) {
      const row = ingestSection.createEl('div', { cls: 'ontology-type-editor-field' });
      const rowHeader = row.createEl('div', { cls: 'ontology-type-editor-row-header' });
      rowHeader.createEl('span', { cls: 'ontology-type-editor-row-label', text: entry.field ? `${entry.field} → ${entry.target}` : 'New rule' });
      this.addItemDeleteButton(rowHeader, 'Remove rule', () => { model.ingestFrom.splice(i, 1); this.render(); });
      new Setting(row)
        .setName('Field')
        .setDesc('Frontmatter key to watch (e.g. up, parent).')
        .addText((text) => text
          .setPlaceholder('up')
          .setValue(entry.field)
          .onChange((v) => { entry.field = v.trim(); rowHeader.querySelector('.ontology-type-editor-row-label')!.textContent = entry.field ? `${entry.field} → ${entry.target}` : 'New rule'; }));
      new Setting(row)
        .setName('Target note')
        .setDesc('The note name or path that the field must link to.')
        .addText((text) => text
          .setPlaceholder('archive/Philosophers')
          .setValue(entry.target)
          .onChange((v) => { entry.target = v.trim(); rowHeader.querySelector('.ontology-type-editor-row-label')!.textContent = entry.field ? `${entry.field} → ${entry.target}` : 'New rule'; }));
    }
  }

  private renderAutoApplyScaffold(containerEl: HTMLElement): void {
    const { model } = this.options;

    const section = containerEl.createEl('section', { cls: 'ontology-type-editor-section' });
    section.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Scaffold' });

    if (model.ingestFrom.length > 0) {
      new Setting(section)
        .setName('When to scaffold')
        .setDesc('Scaffold runs automatically on detection because this type uses ingest-from rules — membership is certain as soon as the trigger field is set.');
    } else {
      new Setting(section)
        .setName('When to scaffold')
        .setDesc('Automatically fill in missing fields when an entity of this type is saved.')
        .addDropdown((dropdown) => {
          dropdown
            .addOption('never', 'Never')
            .addOption('always', 'Always')
            .addOption('conditional', 'When extra conditions match')
            .setValue(model.autoApplyMode)
            .onChange((value) => {
              model.autoApplyMode = value as TypeEditorModel['autoApplyMode'];
              this.render();
            });
        });
    }

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
      condHeader.createEl('span', { cls: 'ontology-type-editor-sublabel', text: 'Extra conditions' });
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
