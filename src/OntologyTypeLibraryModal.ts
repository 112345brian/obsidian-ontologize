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
  private viewMode: 'alpha' | 'tree' = 'tree';
  private listEl!: HTMLElement;
  private viewToggleEl!: HTMLButtonElement;

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

    const headerActions = header.createEl('div', { cls: 'ontology-library-header-actions' });
    this.viewToggleEl = headerActions.createEl('button', {
      cls: 'ontology-library-view-toggle',
      text: this.viewMode === 'tree' ? 'A–Z' : 'Tree',
    });
    this.viewToggleEl.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'tree' ? 'alpha' : 'tree';
      this.viewToggleEl.textContent = this.viewMode === 'tree' ? 'A–Z' : 'Tree';
      this.renderList();
    });

    const newBtn = headerActions.createEl('button', { cls: 'mod-cta ontology-library-new-btn', text: 'New type' });
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

    if (q) {
      const filtered = allTypes.filter((t) => t.name.toLowerCase().includes(q));
      if (filtered.length === 0) {
        this.listEl.createEl('div', { cls: 'ontology-library-empty', text: 'No types match.' });
        return;
      }
      for (const type of filtered) {
        this.renderRow(this.listEl, type, 0);
      }
      return;
    }

    if (allTypes.length === 0) {
      this.listEl.createEl('div', { cls: 'ontology-library-empty', text: 'No types in ontology.' });
      return;
    }

    if (this.viewMode === 'alpha') {
      for (const type of allTypes) {
        this.renderRow(this.listEl, type, 0);
      }
      return;
    }

    // Tree view: render each type under its first known parent; roots first.
    const typeNames = new Set(this.index.types.keys());
    const childrenOf = new Map<string, OntologyType[]>();
    const roots: OntologyType[] = [];

    for (const type of allTypes) {
      const knownParent = type.extends.find((p) => typeNames.has(p));
      if (knownParent) {
        const siblings = childrenOf.get(knownParent) ?? [];
        siblings.push(type);
        childrenOf.set(knownParent, siblings);
      } else {
        roots.push(type);
      }
    }

    const renderBranch = (type: OntologyType, depth: number): void => {
      this.renderRow(this.listEl, type, depth);
      for (const child of childrenOf.get(type.name) ?? []) {
        renderBranch(child, depth + 1);
      }
    };

    for (const root of roots) {
      renderBranch(root, 0);
    }
  }

  private renderRow(container: HTMLElement, type: OntologyType, depth: number): void {
    const row = container.createEl('div', { cls: 'ontology-library-row' });
    if (depth > 0) {
      row.style.paddingLeft = `${depth * 1.25}rem`;
    }

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
