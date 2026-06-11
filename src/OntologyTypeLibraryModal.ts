import type { App } from 'obsidian';

import { Modal } from 'obsidian';

import type { OntologyIndex, OntologyType } from './ontology/types.ts';

export interface TypeLibraryCallbacks {
  onCreateNew: () => void;
  onCreateSubtype: (parent: OntologyType) => void;
  onEdit: (type: OntologyType) => void;
  onOpenFile: (type: OntologyType) => void;
}

export class OntologyTypeLibraryModal extends Modal {
  private query = '';
  private listEl!: HTMLElement;

  public constructor(
    app: App,
    private readonly index: OntologyIndex,
    private readonly callbacks: TypeLibraryCallbacks,
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass('ontology-type-library-shell');
    const { contentEl } = this;
    contentEl.addClass('ontology-type-library');

    const header = contentEl.createEl('div', { cls: 'ontology-library-header' });
    header.createEl('h2', { text: 'Ontology types' });
    const newBtn = header.createEl('button', { cls: 'mod-cta ontology-library-new-btn', text: 'New type' });
    newBtn.addEventListener('click', () => { this.close(); this.callbacks.onCreateNew(); });

    const search = contentEl.createEl('input', {
      cls: 'ontology-library-search',
      attr: { placeholder: 'Filter types…', type: 'text' },
    });
    search.addEventListener('input', () => { this.query = search.value; this.renderList(); });
    search.focus();

    this.listEl = contentEl.createEl('div', { cls: 'ontology-library-list' });
    this.renderList();
  }

  private renderList(): void {
    this.listEl.empty();

    const allTypes = [...this.index.types.values()].sort((a, b) => a.name.localeCompare(b.name));
    const q = this.query.toLowerCase();
    const types = q ? allTypes.filter((t) => t.name.toLowerCase().includes(q)) : allTypes;

    if (types.length === 0) {
      this.listEl.createEl('div', { cls: 'ontology-library-empty', text: this.query ? 'No types match.' : 'No types in ontology.' });
      return;
    }

    for (const type of types) {
      this.renderRow(this.listEl, type);
    }
  }

  private renderRow(container: HTMLElement, type: OntologyType): void {
    const row = container.createEl('div', { cls: 'ontology-library-row' });

    const info = row.createEl('div', { cls: 'ontology-library-info' });

    const name = info.createEl('span', { cls: 'ontology-library-name', text: type.name });
    name.addEventListener('click', () => { this.close(); this.callbacks.onOpenFile(type); });
    name.setAttribute('tabindex', '0');
    name.setAttribute('role', 'link');
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.close(); this.callbacks.onOpenFile(type); } });

    if (type.isInterface) {
      info.createEl('span', { cls: 'ontology-library-badge ontology-badge-interface', text: 'interface' });
    } else if (type.abstract) {
      info.createEl('span', { cls: 'ontology-library-badge ontology-badge-abstract', text: 'abstract' });
    }

    if (type.typeKind === 'nominal') {
      info.createEl('span', { cls: 'ontology-library-badge ontology-badge-nominal', text: 'nominal' });
    }

    const meta: string[] = [];
    if (type.extends.length > 0) { meta.push(`extends ${type.extends.join(', ')}`); }
    if (type.implements.length > 0) { meta.push(`implements ${type.implements.join(', ')}`); }
    if (meta.length > 0) {
      info.createEl('span', { cls: 'ontology-library-meta', text: meta.join(' · ') });
    }

    const actions = row.createEl('div', { cls: 'ontology-library-actions' });

    if (!type.isInterface) {
      const subtypeBtn = actions.createEl('button', { cls: 'ontology-library-btn', text: 'New subtype' });
      subtypeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.close(); this.callbacks.onCreateSubtype(type); });
    }

    const editBtn = actions.createEl('button', { cls: 'ontology-library-btn', text: 'Edit' });
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.close(); this.callbacks.onEdit(type); });
  }
}
