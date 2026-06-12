import type { App } from 'obsidian';

import { Modal, Setting } from 'obsidian';

import type { FrontmatterValue, OntologyEntity, OntologyIndex } from './ontology/types.ts';
import type { ScaffoldFieldPlan } from './ontology/mutations.ts';

import { planScaffoldEntity } from './ontology/mutations.ts';

export interface BulkScaffoldEntityDiff {
  name: string;
  path: string;
  plans: ScaffoldFieldPlan[];
}

type Phase = 'select' | 'preview';

function isEntityOfType(entity: OntologyEntity, typeName: string, index: OntologyIndex): boolean {
  return entity.instanceOf.some((t) => t === typeName || (index.ancestorsByType.get(t)?.has(typeName) ?? false));
}

function formatInsert(v: FrontmatterValue | undefined): string {
  if (v === undefined || v === null) {
    return 'null';
  }
  if (typeof v === 'string') {
    return v || '""';
  }
  if (Array.isArray(v)) {
    return v.map(String).join(', ');
  }
  return String(v);
}

export class OntologyBulkScaffoldModal extends Modal {
  private phase: Phase = 'select';
  private selectedTypes = new Set<string>();
  private readonly entityDiffs = new Map<string, BulkScaffoldEntityDiff>();

  public constructor(
    app: App,
    private readonly index: OntologyIndex,
    private readonly onApply: (diffs: BulkScaffoldEntityDiff[]) => Promise<number>,
  ) {
    super(app);
    this.precompute();
  }

  private precompute(): void {
    for (const entity of this.index.entities.values()) {
      const plans = planScaffoldEntity(this.index, entity.path).filter((p) => p.insert !== undefined);
      if (plans.length > 0) {
        this.entityDiffs.set(entity.path, { name: entity.name, path: entity.path, plans });
      }
    }
    for (const type of this.index.types.values()) {
      if (type.isInterface) {
        continue;
      }
      for (const diff of this.entityDiffs.values()) {
        if (isEntityOfType(this.index.entities.get(diff.path)!, type.name, this.index)) {
          this.selectedTypes.add(type.name);
          break;
        }
      }
    }
  }

  public override onOpen(): void {
    this.modalEl.addClass('ontology-bulk-scaffold-shell');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass('ontology-bulk-scaffold');
    if (this.phase === 'select') {
      this.renderSelect();
    } else {
      this.renderPreview();
    }
  }

  private getSelectedDiff(): BulkScaffoldEntityDiff[] {
    const result: BulkScaffoldEntityDiff[] = [];
    for (const diff of this.entityDiffs.values()) {
      const entity = this.index.entities.get(diff.path);
      if (entity && [...this.selectedTypes].some((typeName) => isEntityOfType(entity, typeName, this.index))) {
        result.push(diff);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private selectedTotals(): { entities: number; fields: number } {
    const diff = this.getSelectedDiff();
    return { entities: diff.length, fields: diff.reduce((s, d) => s + d.plans.length, 0) };
  }

  private renderSelect(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Apply schema defaults' });
    contentEl.createEl('p', { cls: 'ontology-bulk-desc', text: 'Select which types to scaffold. Only fields with defined default values will be written.' });

    const summaryEl = contentEl.createEl('div', { cls: 'ontology-bulk-summary' });

    const updateSummary = (): void => {
      const { entities, fields } = this.selectedTotals();
      summaryEl.empty();
      summaryEl.createEl('span', { text: `${this.selectedTypes.size} type${this.selectedTypes.size === 1 ? '' : 's'} selected` });
      summaryEl.createEl('span', { cls: 'ontology-bulk-summary-sep', text: '·' });
      summaryEl.createEl('span', { text: `${entities} ${entities === 1 ? 'entity' : 'entities'}` });
      summaryEl.createEl('span', { cls: 'ontology-bulk-summary-sep', text: '·' });
      summaryEl.createEl('span', { text: `${fields} field${fields === 1 ? '' : 's'}` });
    };

    const listEl = contentEl.createEl('div', { cls: 'ontology-bulk-type-list' });

    const allTypes = [...this.index.types.values()]
      .filter((t) => !t.isInterface)
      .sort((a, b) => a.name.localeCompare(b.name));

    const allRow = listEl.createEl('div', { cls: 'ontology-bulk-type-row ontology-bulk-type-all' });
    const allCheck = allRow.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
    allCheck.checked = allTypes.every((t) => this.selectedTypes.has(t.name));
    allCheck.indeterminate = !allCheck.checked && this.selectedTypes.size > 0;
    allRow.createEl('span', { cls: 'ontology-bulk-type-name', text: 'All types' });
    allCheck.addEventListener('change', () => {
      if (allCheck.checked) {
        for (const t of allTypes) {
          this.selectedTypes.add(t.name);
        }
      } else {
        this.selectedTypes.clear();
      }
      this.render();
    });

    const typeRows = new Map<string, HTMLInputElement>();

    for (const type of allTypes) {
      let entityCount = 0;
      let fieldCount = 0;
      for (const diff of this.entityDiffs.values()) {
        const entity = this.index.entities.get(diff.path);
        if (entity && isEntityOfType(entity, type.name, this.index)) {
          entityCount++;
          fieldCount += diff.plans.length;
        }
      }

      const row = listEl.createEl('div', { cls: 'ontology-bulk-type-row' });
      const checkbox = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
      checkbox.checked = this.selectedTypes.has(type.name);
      checkbox.disabled = entityCount === 0;
      typeRows.set(type.name, checkbox);

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedTypes.add(type.name);
        } else {
          this.selectedTypes.delete(type.name);
        }
        allCheck.checked = allTypes.filter((t) => typeRows.get(t.name)?.disabled !== true).every((t) => this.selectedTypes.has(t.name));
        allCheck.indeterminate = !allCheck.checked && this.selectedTypes.size > 0;
        updateSummary();
      });

      const info = row.createEl('span', { cls: 'ontology-bulk-type-name', text: type.name });
      if (type.isInterface) {
        info.createEl('span', { cls: 'ontology-library-badge ontology-badge-interface', text: 'interface' });
      } else if (type.abstract) {
        info.createEl('span', { cls: 'ontology-library-badge ontology-badge-abstract', text: 'abstract' });
      }

      if (entityCount > 0) {
        row.createEl('span', {
          cls: 'ontology-bulk-type-count',
          text: `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'} · ${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`,
        });
      } else {
        row.createEl('span', { cls: 'ontology-bulk-type-count ontology-bulk-type-count--none', text: 'nothing to add' });
      }
    }

    updateSummary();

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => { this.close(); }))
      .addButton((btn) => btn.setButtonText('Preview changes →').setCta().onClick(() => {
        this.phase = 'preview';
        this.render();
      }));
  }

  private renderPreview(): void {
    const { contentEl } = this;
    const diff = this.getSelectedDiff();
    const totalFields = diff.reduce((s, d) => s + d.plans.length, 0);

    contentEl.createEl('h2', { text: 'Preview changes' });

    if (diff.length === 0) {
      contentEl.createEl('p', { cls: 'ontology-bulk-desc', text: 'No fields to add for the selected types.' });
    } else {
      contentEl.createEl('p', {
        cls: 'ontology-bulk-desc',
        text: `${totalFields} field${totalFields === 1 ? '' : 's'} will be added across ${diff.length} ${diff.length === 1 ? 'entity' : 'entities'}.`,
      });

      const listEl = contentEl.createEl('div', { cls: 'ontology-bulk-preview-list' });
      for (const { name, plans } of diff) {
        const card = listEl.createEl('div', { cls: 'ontology-bulk-preview-card' });
        card.createEl('div', { cls: 'ontology-bulk-preview-name', text: name });
        const fields = card.createEl('ul', { cls: 'ontology-bulk-preview-fields' });
        for (const plan of plans) {
          const li = fields.createEl('li', { cls: 'ontology-bulk-preview-field' });
          li.createEl('code', { cls: 'ontology-bulk-field-key', text: plan.property });
          li.appendText(': ');
          li.createEl('span', { cls: 'ontology-bulk-field-value', text: formatInsert(plan.insert) });
          li.createEl('span', { cls: `ontology-bulk-field-kind ontology-bulk-field-kind--${plan.kind}`, text: plan.kind });
        }
      }
    }

    let applying = false;
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('← Back').onClick(() => {
        this.phase = 'select';
        this.render();
      }))
      .addButton((btn) => {
        btn.setButtonText(`Apply ${totalFields} field${totalFields === 1 ? '' : 's'}`).setCta().setDisabled(diff.length === 0);
        btn.onClick(async () => {
          if (applying) {
            return;
          }
          applying = true;
          btn.setDisabled(true);
          btn.setButtonText('Applying…');
          try {
            await this.onApply(diff);
            this.close();
          } finally {
            applying = false;
          }
        });
      });
  }
}
