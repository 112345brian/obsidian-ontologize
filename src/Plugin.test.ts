import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from 'obsidian';

const hoisted = vi.hoisted(() => ({
  openedModals: [] as { close: () => void }[],
}));

vi.mock('obsidian', () => {
  class TFile {
    public extension: string;
    public path: string;

    public constructor(path = '') {
      this.path = path;
      this.extension = path.split('.').pop() ?? '';
    }
  }

  class Modal {
    public app: unknown;

    public constructor(app: unknown) {
      this.app = app;
    }

    public close(): void {
      this.onClose();
    }

    public onClose(): void {
      // overridden by subclasses
    }

    public onOpen(): void {
      // overridden by subclasses
    }

    public open(): void {
      hoisted.openedModals.push(this);
    }
  }

  class Plugin {
    public app: unknown;

    public constructor(app: unknown) {
      this.app = app;
    }

    public addCommand(): void {
      // not exercised
    }

    public addSettingTab(): void {
      // not exercised
    }

    public loadData(): Promise<unknown> {
      return Promise.resolve({});
    }

    public registerEvent(): void {
      // not exercised
    }

    public registerMarkdownCodeBlockProcessor(): void {
      // not exercised
    }

    public saveData(): Promise<void> {
      return Promise.resolve();
    }
  }

  class FuzzySuggestModal extends Modal {
    public setPlaceholder(): this { return this; }
  }

  class PluginSettingTab {
    public constructor(_app: unknown, _plugin: unknown) {
      // not exercised
    }
  }

  class Setting {
    public constructor(_containerEl: unknown) {
      // not exercised
    }
  }

  return {
    FuzzySuggestModal,
    MarkdownRenderer: { render: vi.fn() },
    Modal,
    Notice: vi.fn(),
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    parseYaml: () => ({}),
  };
});

import { TFile } from 'obsidian';

import { Plugin } from './Plugin.ts';

// The mocked TFile takes a path; the real typings declare a 0-arg constructor.
function makeTFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

interface FakeVault {
  eventLog: string[];
  files: Map<string, string>;
  frontmatterByPath: Map<string, Record<string, unknown>>;
  markdownFiles: TFile[];
  readDelayMs: number;
}

function makeFakeApp(fake: FakeVault): App {
  return {
    fileManager: {
      processFrontMatter: vi.fn().mockResolvedValue(undefined),
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: fake.frontmatterByPath.get(file.path) ?? {} }),
      on: () => ({}),
    },
    vault: {
      adapter: {
        exists: (path: string) => Promise.resolve(fake.files.has(path)),
        mkdir: () => Promise.resolve(),
        read: (path: string) => Promise.resolve(fake.files.get(path) ?? ''),
        write: (path: string, data: string) => {
          fake.files.set(path, data);
          return Promise.resolve();
        },
      },
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => {
        fake.eventLog.push('scan');
        return [...fake.markdownFiles];
      },
      on: () => ({}),
      read: async (file: TFile) => {
        await new Promise((resolve) => setTimeout(resolve, fake.readDelayMs));
        fake.eventLog.push(`read:${file.path}`);
        return fake.files.get(file.path) ?? '';
      },
    },
    workspace: {
      getActiveFile: () => null,
      onLayoutReady: (callback: () => void) => {
        fake.eventLog.push('layout-ready-registered');
        layoutCallbacks.push(callback);
      },
      openLinkText: vi.fn(),
    },
  } as unknown as App;
}

let layoutCallbacks: (() => void)[] = [];

function makeFakeVault(): FakeVault {
  return {
    eventLog: [],
    files: new Map(),
    frontmatterByPath: new Map(),
    markdownFiles: [],
    readDelayMs: 0,
  };
}

async function settle(plugin: Plugin): Promise<void> {
  // Drain the serialized index queue plus trailing microtasks.
  await plugin['indexTask'];
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPlugin(fake: FakeVault, savedSettings: Record<string, unknown> = {}): Promise<Plugin> {
  const plugin = new Plugin(makeFakeApp(fake), { id: 'obsidian-ontologize' } as never);
  plugin.loadData = () => Promise.resolve(savedSettings);
  await plugin.onload();
  return plugin;
}

beforeEach(() => {
  hoisted.openedModals.length = 0;
  layoutCallbacks = [];
  (globalThis as Record<string, unknown>)['window'] ??= { clearTimeout, setTimeout };
});

describe('Plugin orchestration', () => {
  it('discards a hydrated cache whose settings differ from current plugin settings', async () => {
    const mismatched = makeFakeVault();
    mismatched.files.set('.obsidian/ontology-cache.json', JSON.stringify({
      cacheVersion: 1,
      settings: {
        entityTypeFields: ['is-instance', 'type'],
        filesToIgnore: [],
        foldersToIgnore: ['SomewhereElse'],
        frontmatterIgnoreRules: [],
        schemaPath: '_types/ontology.schema.yaml',
        typeFolder: '_types',
      },
    }));
    const pluginWithMismatch = await loadPlugin(mismatched);
    expect(pluginWithMismatch.index).toBeNull();

    const matched = makeFakeVault();
    matched.files.set('.obsidian/ontology-cache.json', JSON.stringify({
      cacheVersion: 1,
      settings: {
        autoApplyBlockPrefix: 'condition-',
        entityTypeFields: ['is-instance', 'type'],
        filesToIgnore: [],
        foldersToIgnore: [],
        frontmatterIgnoreRules: [],
        schemaPath: '_types/ontology.schema.yaml',
        typeFolder: '_types',
      },
    }));
    const pluginWithMatch = await loadPlugin(matched);
    expect(pluginWithMatch.index).not.toBeNull();
  });

  it('serializes index work so a slow incremental upsert cannot clobber a newer rebuild', async () => {
    const fake = makeFakeVault();
    fake.readDelayMs = 20;
    const typeFile = makeTFile('_types/Dog.md');
    fake.files.set('_types/Dog.md', '{"lock": true}');
    const plugin = await loadPlugin(fake);

    // Slow type-file upsert immediately followed by a full rebuild over an
    // empty vault. The rebuild must run after the upsert and win.
    const upsert = plugin['handleVaultModify'](typeFile);
    const rebuild = plugin.rebuildIndex(false);
    await Promise.all([upsert, rebuild]);
    await settle(plugin);

    const readIndex = fake.eventLog.indexOf('read:_types/Dog.md');
    const scanIndex = fake.eventLog.lastIndexOf('scan');
    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(scanIndex).toBeGreaterThan(readIndex);
    expect(plugin.index?.types.size).toBe(0);
  });

  it('suppresses automatic inverse writes until the first cold rebuild completes', async () => {
    const fake = makeFakeVault();
    fake.frontmatterByPath.set('Spinoza.md', { influenced: ['[[Leibniz]]'], 'is-instance': '[[Philosopher]]' });
    const entityFile = makeTFile('Spinoza.md');
    const plugin = await loadPlugin(fake, { autoUpdateInverses: true });
    const processFrontMatter = (plugin.app as App).fileManager.processFrontMatter;

    await plugin['handleMetadataChanged'](entityFile);
    await settle(plugin);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(plugin['indexReady']).toBe(false);

    for (const callback of layoutCallbacks) {
      callback();
    }
    await settle(plugin);
    expect(plugin['indexReady']).toBe(true);
  });

  it('auto-scaffolds on membership transitions and stays dismissed after close', async () => {
    const fake = makeFakeVault();
    fake.files.set('_types/Dog.md', '{"lock": true, "must-have": {"breed": "string"}}');
    fake.files.set('_types/Cat.md', '{"lock": true, "must-have": {"whiskers": "string"}}');
    fake.markdownFiles = [makeTFile('_types/Dog.md'), makeTFile('_types/Cat.md')];
    const rexFile = makeTFile('Rex.md');
    fake.frontmatterByPath.set('Rex.md', {});

    const plugin = await loadPlugin(fake, { autoScaffoldEntities: true, initialScaffoldComplete: true });
    for (const callback of layoutCallbacks) {
      callback();
    }
    await settle(plugin);
    expect(plugin['indexReady']).toBe(true);
    expect(plugin.index?.types.size).toBe(2);

    // Ordinary edit without membership: no modal.
    await plugin['handleMetadataChanged'](rexFile);
    await settle(plugin);
    expect(hoisted.openedModals).toHaveLength(0);

    // Membership transition: modal opens once.
    fake.frontmatterByPath.set('Rex.md', { 'is-instance': '[[Dog]]' });
    await plugin['handleMetadataChanged'](rexFile);
    await settle(plugin);
    expect(hoisted.openedModals).toHaveLength(1);

    // Close without applying, then keep editing: stays dismissed.
    hoisted.openedModals[0]!.close();
    fake.frontmatterByPath.set('Rex.md', { 'is-instance': '[[Dog]]', mood: 'good' });
    await plugin['handleMetadataChanged'](rexFile);
    await settle(plugin);
    expect(hoisted.openedModals).toHaveLength(1);

    // Membership change clears the dismissal.
    fake.frontmatterByPath.set('Rex.md', { 'is-instance': '[[Cat]]' });
    await plugin['handleMetadataChanged'](rexFile);
    await settle(plugin);
    expect(hoisted.openedModals).toHaveLength(2);
  });
});
