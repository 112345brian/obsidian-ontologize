import type { App, TFile } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { ScaffoldFieldPlan } from './ontology/mutations.ts';

interface OntologyScaffoldReviewModalOptions {
  file: TFile;
  onApply: (plans: ScaffoldFieldPlan[]) => Promise<number>;
  onDone: () => Promise<void>;
  plans: ScaffoldFieldPlan[];
}

export class OntologyScaffoldReviewModal extends Modal {
  private readonly selected = new Set<string>();

  public constructor(app: App, private readonly options: OntologyScaffoldReviewModalOptions) {
    super(app);
    for (const plan of options.plans) {
      this.selected.add(plan.property);
    }
  }

  public override onOpen(): void {
    this.render();
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
      new Setting(list)
        .setName(plan.property)
        .setDesc(plan.kind)
        .addToggle((toggle) => {
          toggle
            .setValue(this.selected.has(plan.property))
            .onChange((value) => {
              if (value) {
                this.selected.add(plan.property);
              } else {
                this.selected.delete(plan.property);
              }
            });
        });
    }
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
          .onClick(() => {
            this.close();
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Apply selected')
          .setCta()
          .onClick(async () => {
            const plans = this.options.plans.filter((plan) => this.selected.has(plan.property));
            const added = await this.options.onApply(plans);
            await this.options.onDone();
            new Notice(`Ontology scaffold added ${added} fields.`);
            this.close();
          });
      });
  }
}
