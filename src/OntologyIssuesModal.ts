import type { App } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { IssueFilter } from './ontology/issues.ts';
import type { OntologyIssue } from './ontology/types.ts';

import { filterIssues, summarizeIssues } from './ontology/issues.ts';

interface OntologyIssuesModalOptions {
  getIssues: () => OntologyIssue[];
  initialFilter?: IssueFilter | undefined;
  /** Returns true if the given file path belongs to an ignored entity. */
  isIgnoredFile?: (filePath: string) => boolean;
  onFixInverses: () => Promise<void>;
  onRebuild: () => Promise<void>;
  onRepair?: () => void;
}

export class OntologyIssuesModal extends Modal {
  private filter: IssueFilter & { showIgnored?: boolean | undefined };

  public constructor(app: App, private readonly options: OntologyIssuesModalOptions) {
    super(app);
    this.filter = { ...options.initialFilter };
  }

  public override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ontology-issues-modal');

    contentEl.createEl('h2', { text: 'Ontology Issues' });

    const allIssues = this.options.getIssues();
    const activeIssues = this.filter.showIgnored
      ? allIssues
      : allIssues.filter((i) => !this.options.isIgnoredFile?.(i.file));
    const visibleIssues = filterIssues(activeIssues, this.filter);
    const allSummary = summarizeIssues(allIssues);
    const visibleSummary = summarizeIssues(visibleIssues);
    const ignoredCount = allIssues.length - activeIssues.length;

    contentEl.createEl('p', {
      cls: 'ontology-issues-summary',
      text: `${visibleSummary.total} shown (${visibleSummary.errors} errors, ${visibleSummary.warnings} warnings). Vault total: ${allSummary.total}.${ignoredCount > 0 ? ` ${ignoredCount} suppressed (ignored entities).` : ''}`,
    });

    this.renderControls(contentEl);
    this.renderIssues(contentEl, visibleIssues);
  }

  private renderControls(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Severity')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('all', 'All')
          .addOption('error', 'Errors')
          .addOption('warning', 'Warnings')
          .setValue(this.filter.severity ?? 'all')
          .onChange((value) => {
            if (value === 'all') {
              delete this.filter.severity;
            } else {
              this.filter.severity = value as OntologyIssue['severity'];
            }
            this.render();
          });
      });

    new Setting(containerEl)
      .setName('Autofixable')
      .addToggle((toggle) => {
        toggle
          .setValue(this.filter.autofixable === true)
          .onChange((value) => {
            if (value) {
              this.filter.autofixable = true;
            } else {
              delete this.filter.autofixable;
            }
            this.render();
          });
      });

    if (this.options.isIgnoredFile) {
      new Setting(containerEl)
        .setName('Show ignored')
        .setDesc('Include issues from entities marked ignored.')
        .addToggle((toggle) => {
          toggle
            .setValue(this.filter.showIgnored === true)
            .onChange((value) => {
              this.filter.showIgnored = value ? true : undefined;
              this.render();
            });
        });
    }

    new Setting(containerEl)
      .setName('Actions')
      .addButton((button) => {
        button
          .setButtonText('Rebuild')
          .onClick(async () => {
            await this.options.onRebuild();
            this.render();
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Fix inverses')
          .onClick(async () => {
            await this.options.onFixInverses();
            this.render();
          });
      });

    if (this.options.onRepair) {
      new Setting(containerEl)
        .setName('Ignored entities')
        .setDesc('View and restore entities you have marked ignored.')
        .addButton((button) => {
          button.setButtonText('Open repair').onClick(() => {
            this.options.onRepair!();
          });
        });
    }
  }

  private renderIssues(containerEl: HTMLElement, issues: OntologyIssue[]): void {
    const list = containerEl.createEl('div', { cls: 'ontology-issues-list' });
    if (issues.length === 0) {
      list.createEl('p', { cls: 'ontology-issues-empty', text: 'No ontology issues match the current filter.' });
      return;
    }

    for (const issue of issues) {
      const item = list.createEl('div', { cls: `ontology-issue ontology-issue-${issue.severity}` });
      const header = item.createEl('div', { cls: 'ontology-issue-header' });
      header.createEl('span', { cls: 'ontology-issue-severity', text: issue.severity });
      header.createEl('span', { cls: 'ontology-issue-file', text: issue.file });

      item.createEl('div', { cls: 'ontology-issue-message', text: issue.message });

      const meta = [issue.property, issue.target, issue.autofixable ? 'autofixable' : ''].filter(Boolean).join(' | ');
      if (meta) {
        item.createEl('div', { cls: 'ontology-issue-meta', text: meta });
      }

      if (issue.blame) {
        const { shortHash, author, date, message } = issue.blame;
        item.createEl('div', {
          cls: 'ontology-issue-blame',
          text: `Last changed: ${shortHash} · ${author} · ${date} — ${message}`,
        });
      }

      new Setting(item)
        .addButton((button) => {
          button
            .setButtonText('Open')
            .onClick(async () => {
              try {
                await this.app.workspace.openLinkText(issue.file, '', false);
              } catch {
                new Notice(`Could not open ${issue.file}`);
              }
            });
        });
    }
  }
}
