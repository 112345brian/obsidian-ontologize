import type { App } from 'obsidian';

import { Modal, Notice, Setting } from 'obsidian';

import type { OntologyEntity, OntologyIndex, OntologyIssue } from './ontology/types.ts';

interface OntologyRepairModalOptions {
  getIndex: () => OntologyIndex | null;
  onUnignore: (paths: string[]) => Promise<void>;
}

export class OntologyRepairModal extends Modal {
  private selected = new Set<string>();

  public constructor(app: App, private readonly options: OntologyRepairModalOptions) {
    super(app);
  }

  public override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ontology-repair-modal');

    contentEl.createEl('h2', { text: 'Ignored Entities' });

    const index = this.options.getIndex();
    if (!index) {
      contentEl.createEl('p', { text: 'Ontology index not ready.' });
      return;
    }

    const ignored = [...index.entities.values()].filter((e: OntologyEntity) => e.ignored);
    if (ignored.length === 0) {
      contentEl.createEl('p', { cls: 'ontology-repair-empty', text: 'No ignored entities.' });
      return;
    }

    contentEl.createEl('p', {
      cls: 'ontology-repair-desc',
      text: `${ignored.length} ignored ${ignored.length === 1 ? 'entity' : 'entities'}. Their current violations are shown below. Remove ignored: true from their frontmatter to restore them to the active ontology.`,
    });

    const issuesByFile = new Map<string, OntologyIssue[]>();
    for (const issue of index.issues) {
      const entity = index.entities.get(issue.file);
      if (entity?.ignored) {
        const group = issuesByFile.get(issue.file) ?? [];
        group.push(issue);
        issuesByFile.set(issue.file, group);
      }
    }

    for (const entity of ignored) {
      const issues = issuesByFile.get(entity.path) ?? [];
      const card = contentEl.createEl('div', { cls: 'ontology-repair-card' });
      const header = card.createEl('div', { cls: 'ontology-repair-card-header' });

      const checkbox = header.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
      checkbox.checked = this.selected.has(entity.path);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selected.add(entity.path);
        } else {
          this.selected.delete(entity.path);
        }
      });

      header.createEl('span', { cls: 'ontology-repair-name', text: entity.name });

      if (issues.length === 0) {
        card.createEl('p', { cls: 'ontology-repair-clean', text: 'No current violations — ready to restore.' });
      } else {
        const list = card.createEl('ul', { cls: 'ontology-repair-issues' });
        for (const issue of issues) {
          list.createEl('li', {
            cls: `ontology-repair-issue ontology-repair-issue-${issue.kind ?? 'schema'}-${issue.severity}`,
            text: issue.message,
          });
        }
      }

      new Setting(card)
        .addButton((b) =>
          b.setButtonText('Open').onClick(async () => {
            try {
              await this.app.workspace.openLinkText(entity.path, '', false);
            } catch {
              new Notice(`Could not open ${entity.path}`);
            }
          }),
        )
        .addButton((b) =>
          b.setButtonText('Restore').setCta().onClick(async () => {
            await this.options.onUnignore([entity.path]);
            this.selected.delete(entity.path);
            this.render();
          }),
        );
    }

    if (ignored.length > 1) {
      new Setting(contentEl)
        .setName('Bulk actions')
        .addButton((b) =>
          b.setButtonText('Restore selected').onClick(async () => {
            const paths = [...this.selected];
            if (paths.length === 0) {
              new Notice('No entities selected.');
              return;
            }
            await this.options.onUnignore(paths);
            this.selected.clear();
            this.render();
          }),
        );
    }
  }
}
