export interface TagInputOptions {
  suggestions?: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

export class TagInput {
  private values: string[];
  private suggestions: string[];
  private onChange: (values: string[]) => void;
  private wrapEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private dropEl: HTMLElement;
  private focusedIdx = -1;

  public constructor(container: HTMLElement, initialValues: string[], options: TagInputOptions) {
    this.values = [...initialValues];
    this.suggestions = options.suggestions ?? [];
    this.onChange = options.onChange;

    this.wrapEl = container.createEl('div', { cls: 'ontology-tag-input' });
    this.inputEl = this.wrapEl.createEl('input', {
      attr: { placeholder: options.placeholder ?? 'Add…', type: 'text' },
      cls: 'ontology-tag-text',
    });
    this.dropEl = this.wrapEl.createEl('div', { cls: 'ontology-tag-suggestions' });
    this.dropEl.hide();

    this.renderChips();
    this.bindEvents();
  }

  private renderChips(): void {
    for (const child of [...this.wrapEl.children]) {
      if (child !== this.inputEl && child !== this.dropEl) {
        child.remove();
      }
    }
    for (const value of this.values) {
      const chip = createEl('span', { cls: 'ontology-tag-chip' });
      chip.createEl('span', { text: value });
      const remove = chip.createEl('button', { cls: 'ontology-tag-chip-remove', text: '×' });
      remove.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.removeTag(value);
      });
      this.wrapEl.insertBefore(chip, this.inputEl);
    }
  }

  private bindEvents(): void {
    this.inputEl.addEventListener('input', () => {
      this.focusedIdx = -1;
      this.renderDropdown(this.getFiltered(this.inputEl.value.trim()));
    });

    this.inputEl.addEventListener('keydown', (e) => {
      const filtered = this.getFiltered(this.inputEl.value.trim());
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusedIdx = Math.min(this.focusedIdx + 1, filtered.length - 1);
        this.renderDropdown(filtered);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusedIdx = Math.max(this.focusedIdx - 1, -1);
        this.renderDropdown(filtered);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = this.focusedIdx >= 0 ? filtered[this.focusedIdx] : (this.inputEl.value.trim() || undefined);
        if (pick) this.addTag(pick);
      } else if (e.key === 'Escape') {
        this.hideDropdown();
      } else if (e.key === 'Backspace' && !this.inputEl.value) {
        this.removeTag(this.values.at(-1));
      }
    });

    this.inputEl.addEventListener('blur', () => {
      setTimeout(() => this.hideDropdown(), 150);
    });

    this.wrapEl.addEventListener('click', (e) => {
      if (e.target !== this.inputEl) this.inputEl.focus();
    });
  }

  private getFiltered(query: string): string[] {
    const q = query.toLowerCase();
    return this.suggestions.filter(
      (s) => (!q || s.toLowerCase().includes(q)) && !this.values.includes(s),
    );
  }

  private renderDropdown(items: string[]): void {
    this.dropEl.empty();
    if (items.length === 0) {
      this.dropEl.hide();
      return;
    }
    for (const [i, item] of items.entries()) {
      const el = this.dropEl.createEl('div', {
        cls: `ontology-tag-suggestion${i === this.focusedIdx ? ' is-focused' : ''}`,
        text: item,
      });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.addTag(item);
      });
    }
    this.dropEl.show();
  }

  private hideDropdown(): void {
    this.dropEl.hide();
    this.dropEl.empty();
    this.focusedIdx = -1;
  }

  private addTag(value: string): void {
    const trimmed = value.trim();
    if (!trimmed || this.values.includes(trimmed)) return;
    this.values.push(trimmed);
    this.inputEl.value = '';
    this.hideDropdown();
    this.renderChips();
    this.onChange([...this.values]);
  }

  private removeTag(value: string | undefined): void {
    if (!value) return;
    this.values = this.values.filter((v) => v !== value);
    this.renderChips();
    this.onChange([...this.values]);
  }
}
