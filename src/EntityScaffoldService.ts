import type {
  App,
  TFile
} from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import { Notice } from 'obsidian';

import { OntologyScaffoldReviewModal } from './OntologyScaffoldReviewModal.ts';
import {
  applyScaffoldPlan,
  planScaffoldEntity,
  shouldAutoApplyScaffold
} from './ontology/mutations.ts';

export class EntityScaffoldService {
  // Paths whose scaffold review was closed without the membership changing
  // since; auto-scaffold stays quiet for them until the entity's types change.
  private readonly dismissedPaths = new Set<string>();
  private readonly reviewOpenPaths = new Set<string>();

  public constructor(
    private readonly app: App,
    private readonly getIndex: () => null | OntologyIndex,
    private readonly getSettings: () => PluginSettings,
    private readonly isIndexReady: () => boolean,
    private readonly onDone: () => Promise<void>
  ) {}

  public clearDismissed(path: string): void {
    this.dismissedPaths.delete(path);
  }

  private canAutoScaffold(file: TFile): boolean {
    const index = this.getIndex();
    const entity = index?.entities.get(file.path);
    if (!index || !entity || entity.instanceOf.length === 0) {
      return false;
    }
    for (const typeName of entity.instanceOf) {
      const type = index.types.get(typeName);
      if (!type || type.abstract || type.isInterface || index.circularTypes?.has(typeName)) {
        return false;
      }
    }
    return true;
  }

  public applyAutoScaffold(file: TFile): void {
    const index = this.getIndex();
    const settings = this.getSettings();
    if (!index || !this.isIndexReady() || !this.canAutoScaffold(file)) {
      return;
    }
    if (!settings.initialScaffoldComplete) {
      return;
    }
    if (this.reviewOpenPaths.has(file.path) || this.dismissedPaths.has(file.path)) {
      return;
    }

    const plans = planScaffoldEntity(index, file.path);
    if (plans.length === 0) {
      return;
    }

    const entity = index.entities.get(file.path);
    if (entity && shouldAutoApplyScaffold(index, entity)) {
      const silentPlans = plans.filter((plan) => plan.kind !== 'optional');
      if (silentPlans.length > 0) {
        void applyScaffoldPlan(this.app, file, silentPlans);
      }
      return;
    }

    if (!settings.autoScaffoldEntities) {
      return;
    }
    new Notice(`Ontology scaffold available: ${plans.length} fields.`);
    this.openReview(file, plans);
  }

  public scaffoldActiveNote(index: OntologyIndex, file: TFile): void {
    if (!index.entities.has(file.path)) {
      new Notice('This note has no ontology type frontmatter.');
      return;
    }
    const plans = planScaffoldEntity(index, file.path);
    if (plans.length === 0) {
      new Notice('No ontology scaffold fields are missing.');
      return;
    }
    this.openReview(file, plans);
  }

  public openReview(file: TFile, plans: ReturnType<typeof planScaffoldEntity>): void {
    if (this.reviewOpenPaths.has(file.path)) {
      return;
    }
    this.reviewOpenPaths.add(file.path);
    new OntologyScaffoldReviewModal(this.app, {
      file,
      onApply: async (selectedPlans) => applyScaffoldPlan(this.app, file, selectedPlans),
      onClosed: () => {
        this.reviewOpenPaths.delete(file.path);
        this.dismissedPaths.add(file.path);
      },
      onDone: this.onDone,
      plans
    }).open();
  }
}
