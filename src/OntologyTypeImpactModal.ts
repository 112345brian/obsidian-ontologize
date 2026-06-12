import type { App } from 'obsidian';

import { Modal, Setting } from 'obsidian';

import type { TypeChangeImpact } from './ontology/impact.ts';
import type { OntologyIssue } from './ontology/types.ts';

export type ImpactResolution = 'proceed' | 'ignore-affected' | 'cancel';

interface OntologyTypeImpactModalOptions {
  typeName: string;
  impact: TypeChangeImpact;
  onResolve: (resolution: ImpactResolution) => void;
}

export class OntologyTypeImpactModal extends Modal {
  public constructor(app: App, private readonly options: OntologyTypeImpactModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.render();
  }

  private resolve(resolution: ImpactResolution): void {
    this.options.onResolve(resolution);
    this.close();
  }

  private render(): void {
    const { contentEl } = this;
    const { impact, typeName } = this.options;
    contentEl.empty();
    contentEl.addClass('ontology-impact-modal');

    contentEl.createEl('h2', { text: `Impact of changing ${typeName}` });

    const hasCoherence = impact.coherenceViolations.length > 0;
    const hasSoft = impact.softBreaking.length > 0;
    const hasFixed = impact.softFixed.length > 0;

    if (!hasCoherence && !hasSoft && !hasFixed) {
      contentEl.createEl('p', { text: 'No entities are affected by this change.' });
      new Setting(contentEl)
        .addButton((b) => b.setButtonText('Proceed').setCta().onClick(() => { this.resolve('proceed'); }))
        .addButton((b) => b.setButtonText('Cancel').onClick(() => { this.resolve('cancel'); }));
      return;
    }

    if (hasCoherence) {
      const section = contentEl.createEl('section', { cls: 'ontology-impact-section ontology-impact-coherence' });
      section.createEl('h3', { text: `Category errors (${impact.coherenceViolations.length})` });
      section.createEl('p', {
        cls: 'ontology-impact-desc',
        text: 'These entities have contradictory type membership. To proceed, mark them ignored (they leave the active ontology) or cancel and fix them first.',
      });
      this.renderIssueList(section, impact.coherenceViolations);
    }

    if (hasSoft) {
      const section = contentEl.createEl('section', { cls: 'ontology-impact-section ontology-impact-soft' });
      section.createEl('h3', { text: `New schema violations (${impact.softBreaking.length})` });
      section.createEl('p', {
        cls: 'ontology-impact-desc',
        text: 'These entities still have coherent type membership but will not satisfy the updated schema.',
      });
      this.renderIssueList(section, impact.softBreaking);
    }

    if (hasFixed) {
      const section = contentEl.createEl('section', { cls: 'ontology-impact-section ontology-impact-fixed' });
      section.createEl('h3', { text: `Existing issues resolved by this change (${impact.softFixed.length})` });
      section.createEl('p', {
        cls: 'ontology-impact-desc',
        text: 'These issues exist in the current ontology. Saving this change will remove them; they are not new problems caused by the change.',
      });
      this.renderIssueList(section, impact.softFixed);
    }

    if (impact.ignoredBreaking.length > 0) {
      contentEl.createEl('p', {
        cls: 'ontology-impact-ignored-note',
        text: `${impact.ignoredBreaking.length} issues on already-ignored entities are not shown.`,
      });
    }

    const actions = new Setting(contentEl);

    if (hasCoherence) {
      // Coherence violations require either ignoring the affected entities or cancelling.
      actions
        .addButton((b) =>
          b.setButtonText('Ignore affected & proceed').setCta().setWarning().onClick(() => {
            this.resolve('ignore-affected');
          }),
        )
        .addButton((b) => b.setButtonText('Cancel').onClick(() => { this.resolve('cancel'); }));
    } else if (hasSoft) {
      actions
        .addButton((b) => b.setButtonText('Proceed').setCta().onClick(() => { this.resolve('proceed'); }))
        .addButton((b) =>
          b.setButtonText('Ignore affected & proceed').onClick(() => {
            this.resolve('ignore-affected');
          }),
        )
        .addButton((b) => b.setButtonText('Cancel').onClick(() => { this.resolve('cancel'); }));
    } else {
      actions
        .addButton((b) => b.setButtonText('Proceed').setCta().onClick(() => { this.resolve('proceed'); }))
        .addButton((b) => b.setButtonText('Cancel').onClick(() => { this.resolve('cancel'); }));
    }
  }

  private renderIssueList(containerEl: HTMLElement, issues: OntologyIssue[]): void {
    const byFile = new Map<string, OntologyIssue[]>();
    for (const issue of issues) {
      const group = byFile.get(issue.file) ?? [];
      group.push(issue);
      byFile.set(issue.file, group);
    }

    const list = containerEl.createEl('ul', { cls: 'ontology-impact-list' });
    for (const [file, fileIssues] of byFile) {
      const item = list.createEl('li');
      item.createEl('span', { cls: 'ontology-impact-file', text: file });
      const msgs = item.createEl('ul');
      for (const issue of fileIssues) {
        msgs.createEl('li', { cls: `ontology-impact-issue ontology-impact-issue-${issue.severity}`, text: issue.message });
      }
    }
  }
}
