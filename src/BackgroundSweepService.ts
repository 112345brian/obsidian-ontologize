import type { App } from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';

import { revalidateEntityBatch } from './ontology/indexer.ts';

// Sweep 10% of entities every 20 minutes; full vault cycles in ~3.5 hours.
export const SWEEP_INTERVAL_MS = 20 * 60 * 1000;
const SWEEP_BATCH_FRACTION = 0.1;
const SWEEP_MIN_BATCH = 5;

export interface BackgroundSweepResult {
  batch: string[];
  shouldScheduleCacheWrite: boolean;
}

export class BackgroundSweepService {
  // Cursor into the sorted entity-path list; advances by the batch size each sweep
  // so every entity gets revalidated once per full cycle regardless of vault size.
  private sweepCursor = 0;

  public run(app: App, index: null | OntologyIndex, indexReady: boolean): BackgroundSweepResult {
    if (!index || !indexReady) {
      return { batch: [], shouldScheduleCacheWrite: false };
    }

    const paths = [...index.entities.keys()].sort();
    if (paths.length === 0) {
      return { batch: [], shouldScheduleCacheWrite: false };
    }

    const batchSize = Math.max(SWEEP_MIN_BATCH, Math.ceil(paths.length * SWEEP_BATCH_FRACTION));
    const start = this.sweepCursor % paths.length;
    const end = start + batchSize;

    const batch = end <= paths.length
      ? paths.slice(start, end)
      : [...paths.slice(start), ...paths.slice(0, end - paths.length)];

    this.sweepCursor = end % paths.length;

    const { staleCount, removedCount } = revalidateEntityBatch(app, index, batch);
    return {
      batch,
      shouldScheduleCacheWrite: staleCount > 0 || removedCount > 0
    };
  }
}
