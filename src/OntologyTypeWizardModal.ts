import type { App } from 'obsidian';

import { FuzzySuggestModal, Modal } from 'obsidian';

import type { OntologyType } from './ontology/types.ts';
import type { TypeEditorModel } from './ontology/type-editor.ts';
import { emptyTypeEditorModel } from './ontology/type-editor.ts';

export class OntologyTypeWizardModal extends Modal {
  public constructor(
    app: App,
    private readonly types: OntologyType[],
    private readonly onSelect: (model: TypeEditorModel) => void,
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('ontology-type-wizard');
    contentEl.createEl('h2', { text: 'Create ontology type' });
    contentEl.createEl('p', { cls: 'ontology-wizard-desc', text: 'Choose what kind of type to create.' });

    this.addCard(contentEl, 'Standalone type', 'A new independent type with no parent.', () => {
      this.close();
      this.onSelect(emptyTypeEditorModel());
    });

    this.addCard(contentEl, 'Subtype of…', 'Inherits fields, relations, and lock state from a parent type.', () => {
      this.close();
      new OntologyTypePickerModal(this.app, this.types.filter((t) => !t.isInterface), 'Pick a parent type', (parent) => {
        const model = emptyTypeEditorModel();
        model.extends = [parent.name];
        this.onSelect(model);
      }).open();
    });

    this.addCard(contentEl, 'Interface', 'A composable contract that types can implement. Cannot be instantiated directly.', () => {
      this.close();
      const model = emptyTypeEditorModel();
      model.isInterface = true;
      this.onSelect(model);
    });
  }

  private addCard(container: HTMLElement, title: string, desc: string, onClick: () => void): void {
    const card = container.createEl('div', { cls: 'ontology-wizard-card' });
    card.createEl('div', { cls: 'ontology-wizard-card-title', text: title });
    card.createEl('div', { cls: 'ontology-wizard-card-desc', text: desc });
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
  }
}

export class OntologyTypePickerModal extends FuzzySuggestModal<OntologyType> {
  public constructor(
    app: App,
    private readonly types: OntologyType[],
    placeholder: string,
    private readonly onChoose: (type: OntologyType) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  public getItems(): OntologyType[] {
    return this.types;
  }

  public getItemText(type: OntologyType): string {
    const parents = type.extends.length > 0 ? ` — extends ${type.extends.join(', ')}` : '';
    return `${type.name}${parents}`;
  }

  public override onChooseItem(type: OntologyType): void {
    this.onChoose(type);
  }
}
