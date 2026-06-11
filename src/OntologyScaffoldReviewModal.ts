import type { App, TFile } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { ScaffoldFieldPlan } from './ontology/mutations.ts';

interface OntologyScaffoldReviewModalOptions {
  file: TFile;
  onApply: (plans: ScaffoldFieldPlan[]) => Promise<number>;
  onClosed?: () => void;
  onDone: () => Promise<void>;
  plans: ScaffoldFieldPlan[];
}

function flattenToStrings(value: unknown): string[] {
  if (value == null) { return []; }
  if (Array.isArray(value)) { return value.flatMap(flattenToStrings); }
  return [String(value)];
}

function displayInsert(plan: ScaffoldFieldPlan): string {
  return typeof plan.insert === 'string' ? plan.insert : JSON.stringify(plan.insert);
}

export class OntologyScaffoldReviewModal extends Modal {
  private readonly selected = new Set<string>();
  private readonly selectedValues = new Map<string, Set<string>>();

  public constructor(app: App, private readonly options: OntologyScaffoldReviewModalOptions) {
    super(app);
    for (const plan of options.plans) {
      if (!plan.candidates?.length) {
        this.selected.add(plan.property);
      } else {
        const preChecked = new Set<string>();
        if (plan.existingValue != null) {
          for (const v of flattenToStrings(plan.existingValue)) {
            if (plan.candidates.includes(v)) { preChecked.add(v); }
          }
        }
        this.selectedValues.set(plan.property, preChecked);
      }
    }
  }

  public override onOpen(): void {
    this.render();
  }

  public override onClose(): void {
    this.options.onClosed?.();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ontology-scaffold-modal');
    contentEl.createEl('h2', { text: 'Review Scaffold Fields' });
    contentEl.createEl('p', {
      cls: 'ontology-scaffold-summary',
      text: `${this.options.file.path}: ${this.options.plans.length} missing fields.`,
    });

    if (this.options.plans.length === 0) {
      contentEl.createEl('p', { cls: 'ontology-scaffold-empty', text: 'No scaffold fields are currently missing.' });
      return;
    }

    this.renderFieldList(contentEl);
    this.renderActions(contentEl);
  }

  private renderFieldList(containerEl: HTMLElement): void {
    const list = containerEl.createEl('div', { cls: 'ontology-scaffold-list' });
    for (const plan of this.options.plans) {
      if (plan.candidates?.length) {
        this.renderCandidateField(list, plan);
      } else {
        this.renderToggleField(list, plan);
      }
    }
  }

  private renderToggleField(containerEl: HTMLElement, plan: ScaffoldFieldPlan): void {
    new Setting(containerEl)
      .setName(plan.property)
      .setDesc(plan.insert === undefined ? plan.kind : `${plan.kind} · insert ${displayInsert(plan)}`)
      .addToggle((toggle) => {
        toggle
          .setValue(this.selected.has(plan.property))
          .onChange((value) => {
            if (value) { this.selected.add(plan.property); } else { this.selected.delete(plan.property); }
          });
      });
  }

  private renderCandidateField(containerEl: HTMLElement, plan: ScaffoldFieldPlan): void {
    const vals = this.selectedValues.get(plan.property)!;
    const wrap = containerEl.createEl('div', { cls: 'ontology-scaffold-candidate-field' });

    const header = wrap.createEl('div', { cls: 'ontology-scaffold-candidate-header' });
    header.createEl('span', { cls: 'ontology-scaffold-candidate-name', text: plan.property });
    header.createEl('span', { cls: 'ontology-scaffold-candidate-kind', text: plan.kind });

    if (plan.existingValue != null) {
      const incompatible = flattenToStrings(plan.existingValue).filter((v) => !plan.candidates!.includes(v));
      if (incompatible.length > 0) {
        const row = wrap.createEl('div', { cls: 'ontology-scaffold-existing-incompatible' });
        row.createEl('span', { cls: 'ontology-scaffold-existing-label', text: 'current: ' });
        for (const v of incompatible) {
          row.createEl('code', { cls: 'ontology-scaffold-bad-value', text: String(v) });
        }
      }
    }

    const grid = wrap.createEl('div', { cls: 'ontology-scaffold-candidates' });
    for (const candidate of plan.candidates!) {
      const label = grid.createEl('label', { cls: 'ontology-scaffold-candidate' });
      const cb = label.createEl('input', { attr: { type: 'checkbox' } });
      cb.checked = vals.has(candidate);
      cb.addEventListener('change', () => {
        if (cb.checked) { vals.add(candidate); } else { vals.delete(candidate); }
      });
      label.createEl('span', { text: candidate });
    }
  }

  private buildApplyPlans(): ScaffoldFieldPlan[] {
    const result: ScaffoldFieldPlan[] = [];
    for (const plan of this.options.plans) {
      if (plan.candidates?.length) {
        const vals = [...(this.selectedValues.get(plan.property) ?? [])];
        if (vals.length === 0) { continue; }
        result.push({ ...plan, insert: vals.length === 1 ? vals[0] : vals });
      } else if (this.selected.has(plan.property)) {
        result.push(plan);
      }
    }
    return result;
  }

  private renderActions(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Actions')
      .addButton((button) => {
        button
          .setButtonText('Open note')
          .onClick(async () => {
            await this.app.workspace.openLinkText(this.options.file.path, '', false);
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => { this.close(); });
      })
      .addButton((button) => {
        button
          .setButtonText('Apply selected')
          .setCta()
          .onClick(async () => {
            const plans = this.buildApplyPlans();
            const added = await this.options.onApply(plans);
            await this.options.onDone();
            new Notice(`Ontology scaffold added ${added} fields.`);
            this.close();
          });
      });
  }
}
