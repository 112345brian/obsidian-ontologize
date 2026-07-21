import type { App } from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { PluginSettings } from './PluginSettings.ts';

import { Notice } from 'obsidian';

import {
  readOntologyCache,
  writeOntologyCache
} from './ontology/cache.ts';

const CACHE_WRITE_DEBOUNCE_MS = 800;

export class OntologyCacheService {
  private cacheWriteTimer: null | number = null;

  public constructor(
    private readonly app: App,
    private readonly getIndex: () => null | OntologyIndex,
    private readonly getSettings: () => PluginSettings,
    private readonly getDeviceId: () => string
  ) {}

  private effectiveCachePath(): string {
    const base = this.getSettings().cachePath;
    const withoutExt = base.endsWith('.json') ? base.slice(0, -5) : base;
    return `${withoutExt}-${this.getDeviceId()}.json`;
  }

  public async read(): Promise<null | OntologyIndex> {
    return readOntologyCache(this.app, this.effectiveCachePath());
  }

  // The cache is a startup optimization — a failed write (disk full, network
  // drive dropped) must not abort the operation that triggered it, but the user
  // should hear about it once instead of silently loading a stale index next
  // session.
  public async writeSafely(): Promise<void> {
    const index = this.getIndex();
    if (!index) {
      return;
    }
    try {
      await writeOntologyCache(this.app, this.effectiveCachePath(), index);
    } catch (error) {
      console.error('Ontologize: failed to write ontology cache', error);
      new Notice('Ontologize: failed to write the ontology cache; the next session may start from a stale index.');
    }
  }

  public scheduleWrite(): void {
    if (!this.getIndex()) {
      return;
    }
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
    }
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      void this.writeSafely();
    }, CACHE_WRITE_DEBOUNCE_MS);
  }

  public clearTimer(): void {
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
  }
}
