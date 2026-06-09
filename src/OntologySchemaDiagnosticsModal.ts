import type { App } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { OntologyIndex, OntologyIssue } from './ontology/types.ts';

import { buildSchemaDiagnostics } from './ontology/diagnostics.ts';
import { summarizeIssues } from './ontology/issues.ts';

interface OntologySchemaDiagnosticsModalOptions {
  getIndex: () => OntologyIndex | null;
  onOpenIssues: () => Promise<void>;
  onRebuild: () => Promise<void>;
}

export class OntologySchemaDiagnosticsModal extends Modal {
  public constructor(app: App, private readonly options: OntologySchemaDiagnosticsModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ontology-schema-diagnostics-modal');
    contentEl.createEl('h2', { text: 'Schema Diagnostics' });

    const index = this.options.getIndex();
    if (!index) {
      contentEl.createEl('p', { cls: 'ontology-diagnostics-empty', text: 'Ontology index is not ready.' });
      return;
    }

    const diagnostics = buildSchemaDiagnostics(index);
    const summary = summarizeIssues(diagnostics.issues);
    contentEl.createEl('p', {
      cls: 'ontology-diagnostics-summary',
      text: `${diagnostics.typeFiles} type files, ${diagnostics.concreteTypes} concrete types, ${diagnostics.interfaces} interfaces, ${diagnostics.abstractTypes} abstract types, ${diagnostics.relationDefinitions} global relations.`,
    });
    contentEl.createEl('p', {
      cls: 'ontology-diagnostics-summary',
      text: `${summary.total} schema issues (${summary.errors} errors, ${summary.warnings} warnings). Circular types: ${diagnostics.circularTypes.length}.`,
    });

    this.renderControls(contentEl);
    this.renderCircularTypes(contentEl, diagnostics.circularTypes);
    this.renderIssues(contentEl, diagnostics.issues);
  }

  private renderControls(containerEl: HTMLElement): void {
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
          .setButtonText('Open all issues')
          .onClick(async () => {
            await this.options.onOpenIssues();
          });
      });
  }

  private renderCircularTypes(containerEl: HTMLElement, circularTypes: string[]): void {
    if (circularTypes.length === 0) {
      return;
    }

    const section = containerEl.createEl('div', { cls: 'ontology-diagnostics-section' });
    section.createEl('h3', { text: 'Circular Types' });
    const list = section.createEl('ul');
    for (const typeName of circularTypes) {
      list.createEl('li', { text: typeName });
    }
  }

  private renderIssues(containerEl: HTMLElement, issues: OntologyIssue[]): void {
    const list = containerEl.createEl('div', { cls: 'ontology-issues-list' });
    if (issues.length === 0) {
      list.createEl('p', { cls: 'ontology-diagnostics-empty', text: 'No schema issues found.' });
      return;
    }

    for (const issue of issues) {
      const item = list.createEl('div', { cls: `ontology-issue ontology-issue-${issue.severity}` });
      const header = item.createEl('div', { cls: 'ontology-issue-header' });
      header.createEl('span', { cls: 'ontology-issue-severity', text: issue.severity });
      header.createEl('span', { cls: 'ontology-issue-file', text: issue.file });
      item.createEl('div', { cls: 'ontology-issue-message', text: issue.message });

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
