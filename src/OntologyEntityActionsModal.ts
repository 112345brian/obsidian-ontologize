import type { App } from 'obsidian';

import { Modal } from 'obsidian';

import type { OntologizeAPI, RegisteredEntityAction } from './ontology/scripting.ts';
import type { OntologyEntity } from './ontology/types.ts';

export class OntologyEntityActionsModal extends Modal {
  public constructor(
    app: App,
    private readonly entity: OntologyEntity,
    private readonly actions: RegisteredEntityAction[],
    private readonly api: OntologizeAPI,
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('ontology-entity-actions-modal');
    contentEl.createEl('h2', { text: `Script actions — ${this.entity.name}` });

    const applicable = this.actions.filter(
      (a) => !a.options.types || a.options.types.some((t) => this.entity.instanceOf.includes(t)),
    );

    if (applicable.length === 0) {
      contentEl.createEl('p', {
        cls: 'ontology-entity-actions-empty',
        text: 'No script actions are registered for this entity.',
      });
      return;
    }

    for (const action of applicable) {
      const section = contentEl.createEl('section', { cls: 'ontology-entity-actions-section' });
      section.createEl('h3', { text: action.label });
      const body = section.createEl('div', { cls: 'ontology-entity-actions-body' });
      void action.options.run(this.entity, body, this.api);
    }
  }

  public override onClose(): void {
    this.contentEl.empty();
  }
}
