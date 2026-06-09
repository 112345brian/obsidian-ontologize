import type { App } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { MissingInverseFixPlan } from './ontology/mutations.ts';

interface OntologyRelationFixModalOptions {
  onApply: (plans: MissingInverseFixPlan[]) => Promise<number>;
  onDone: () => Promise<void>;
  plans: MissingInverseFixPlan[];
}

export class OntologyRelationFixModal extends Modal {
  private applied = false;

  public constructor(app: App, private readonly options: OntologyRelationFixModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ontology-relation-fix-modal');

    contentEl.createEl('h2', { text: 'Review Relation Fixes' });

    const { plans } = this.options;
    if (plans.length === 0) {
      contentEl.createEl('p', {
        cls: 'ontology-fix-empty',
        text: 'No missing inverse relation fixes are available.',
      });
      new Setting(contentEl)
        .addButton((button) => {
          button
            .setButtonText('Close')
            .onClick(() => {
              this.close();
            });
        });
      return;
    }

    contentEl.createEl('p', {
      cls: 'ontology-fix-summary',
      text: `${plans.length} frontmatter ${plans.length === 1 ? 'change' : 'changes'} will be applied.`,
    });

    const list = contentEl.createEl('div', { cls: 'ontology-fix-list' });
    for (const plan of plans) {
      this.renderPlan(list, plan);
    }

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => {
            this.close();
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Apply')
          .setCta()
          .onClick(async () => {
            if (this.applied) {
              return;
            }
            this.applied = true;
            button.setDisabled(true);
            const fixed = await this.options.onApply(plans);
            await this.options.onDone();
            new Notice(`Ontology applied ${fixed} inverse relation ${fixed === 1 ? 'fix' : 'fixes'}.`);
            this.close();
          });
      });
  }

  private renderPlan(containerEl: HTMLElement, plan: MissingInverseFixPlan): void {
    const item = containerEl.createEl('div', { cls: 'ontology-fix-plan' });
    const header = item.createEl('div', { cls: 'ontology-fix-plan-header' });
    header.createEl('span', { cls: 'ontology-fix-target', text: plan.targetPath });
    if (plan.autoUpdate) {
      header.createEl('span', { cls: 'ontology-fix-badge', text: 'auto-update' });
    }

    item.createEl('div', {
      cls: 'ontology-fix-change',
      text: `Add ${plan.inverseProperty}: ${plan.value}`,
    });
    item.createEl('div', {
      cls: 'ontology-fix-meta',
      text: `From ${plan.sourcePath} via ${plan.sourceProperty}.`,
    });
  }
}
