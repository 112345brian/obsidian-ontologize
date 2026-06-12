# Ontologize Scripting

Scripts let you extend the plugin with custom validation logic, derived field computation, external integrations, and custom UI panels — anything the static schema cannot express.

## Setup

1. Create a folder in your vault for scripts, e.g. `_ontologize/scripts`.
2. Go to **Settings → Ontologize → Scripts folder** and enter that path.
3. Add `.js` files to the folder. They are loaded automatically on startup and reloaded whenever a script file is created, modified, or deleted.

Scripts are plain JavaScript. Each file is executed once at load time with a single global injected: `ontologize`. Use it to register hooks and UI extensions.

---

## The `ontologize` API

### `ontologize.index`

Read-only access to the live `OntologyIndex`. Always reflects the most recent rebuild.

```js
const philosophers = [...ontologize.index.entities.values()]
  .filter(e => e.instanceOf.includes('Philosopher'));
```

Key properties on `OntologyIndex`:

| Property | Type | Description |
|---|---|---|
| `entities` | `Map<string, OntologyEntity>` | All indexed entity notes, keyed by vault path |
| `entitiesByName` | `Map<string, OntologyEntity>` | Same entities keyed by bare note name |
| `types` | `Map<string, OntologyType>` | All parsed type definitions |
| `relationDefinitions` | `Map<string, RelationDefinition>` | Global relation definitions |
| `fieldDefinitions` | `Map<string, PropertyDefinition>` | Global field definitions |
| `scales` | `Map<string, Scale>` | All named scales collected from types |
| `issues` | `OntologyIssue[]` | Live validation issue list |
| `effectiveEntityLocks` | `Map<string, EffectiveLockState>` | Lock state per entity path |
| `ancestorsByType` | `Map<string, Set<string>>` | Full ancestor set per type name |

Key properties on `OntologyEntity`:

| Property | Type | Description |
|---|---|---|
| `path` | `string` | Vault-relative path, e.g. `people/Ada.md` |
| `name` | `string` | Bare note name without extension |
| `instanceOf` | `string[]` | Resolved direct type memberships |
| `frontmatter` | `Record<string, unknown>` | Normalized frontmatter (all keys are kebab-case) |
| `lockIntent` | `boolean` | Whether the note has `lock: true` in frontmatter |

---

### `ontologize.query(queryString)`

Run an ontology query string and return matching `OntologyEntity[]`. Uses the same syntax as `ontology-query` code blocks.

```js
const locked = ontologize.query('type: Person AND include: locked');
const recent = ontologize.query('type: Book AND published: 2020|2021|2022');
```

---

### `ontologize.issue(path, message, severity?)`

Push a custom validation issue into the live issue list. Appears in the issues modal and issue counts alongside built-in validation results.

- `path` — vault-relative path of the entity the issue belongs to
- `message` — human-readable description
- `severity` — `'error'` or `'warning'` (default: `'warning'`)

```js
ontologize.issue('people/Ada.md', 'Missing required field: supervisor', 'error');
```

Issues injected during `entity:validate` are cleared and re-run on the next recompute, so they stay in sync. Issues injected outside a hook persist until the next rebuild.

---

### `ontologize.updateFrontmatter(path, update)`

Write one or more frontmatter keys to an entity note. Returns a `Promise`. Obsidian handles the file write and will emit the normal metadata-changed event, which triggers an incremental index update.

```js
await ontologize.updateFrontmatter('people/Ada.md', {
  'advisor': '[[Babbage]]',
  'verified': true,
});
```

---

## Hooks

Hooks are registered at script load time. The plugin calls them at the appropriate moment in the lifecycle. A script can register as many hooks as it needs.

---

### `ontologize.on('index:ready', handler)`

Called once after every full index rebuild — on startup, on settings change, and on schema file changes. Use it for one-shot analysis, bulk operations, or anything that needs the complete index.

```js
ontologize.on('index:ready', (api) => {
  const count = api.index.entities.size;
  console.log(`Ontologize: index ready with ${count} entities`);
});
```

The handler receives the `api` object and may be `async`.

---

### `ontologize.on('entity:save', handler)`

Called whenever an entity note is saved to the vault — after the entity has been upserted into the index. Use it to compute derived fields or trigger side effects.

```js
ontologize.on('entity:save', async (entity, api) => {
  if (!entity.instanceOf.includes('Book')) return;

  // Auto-fill a computed century field based on the year field.
  const year = entity.frontmatter['year'];
  if (typeof year === 'number' && !entity.frontmatter['century']) {
    await api.updateFrontmatter(entity.path, {
      century: `${Math.floor(year / 100) + 1}th`,
    });
  }
});
```

The handler receives `(entity, api)` and may be `async`. Be careful not to trigger infinite loops: writing frontmatter triggers another `entity:save`, so guard with a presence check before writing.

---

### `ontologize.on('entity:validate', handler)`

Called for every entity during validation — after a full rebuild and after each incremental upsert. Use it to add custom validation rules that depend on field values or cross-entity relationships.

The handler must be **synchronous**. Call `api.issue()` to report problems.

```js
ontologize.on('entity:validate', (entity, api) => {
  if (!entity.instanceOf.includes('Student')) return;

  const advisor = entity.frontmatter['advisor'];
  if (!advisor) {
    api.issue(entity.path, 'Student is missing an advisor', 'error');
    return;
  }

  // Check that the advisor is actually a Professor.
  const advisorName = typeof advisor === 'string'
    ? advisor.replace(/^\[\[|\]\]$/g, '')
    : null;
  if (advisorName) {
    const advisorEntity = api.index.entitiesByName.get(advisorName);
    if (advisorEntity && !advisorEntity.instanceOf.includes('Professor')) {
      api.issue(entity.path, `Advisor ${advisorName} is not a Professor`, 'warning');
    }
  }
});
```

---

## UI Extensions

### `ontologize.ui.registerEntityAction(label, options)`

Register a custom action panel that appears when the user runs the **"Open script actions for active note"** command on an entity note.

`options`:
- `types` — optional string array; if provided, the action only appears for entities whose `instanceOf` includes at least one of these type names
- `run(entity, container, api)` — called when the modal opens; render whatever UI you need into `container` (a plain `HTMLElement`). May be `async`.

```js
ontologize.ui.registerEntityAction('Fetch Wikipedia summary', {
  types: ['Person', 'Organization'],
  async run(entity, container, api) {
    const btn = container.createEl('button', { text: 'Fetch' });
    const output = container.createEl('p', { text: 'Click to fetch.' });

    btn.addEventListener('click', async () => {
      output.textContent = 'Fetching…';
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.name)}`
        );
        const data = await res.json();
        output.textContent = data.extract ?? 'No summary found.';
        await api.updateFrontmatter(entity.path, { 'wikipedia-summary': data.extract });
      } catch (e) {
        output.textContent = `Error: ${e.message}`;
      }
    });
  },
});
```

The command only appears in the command palette when the active note is an indexed entity **and** at least one action is registered, so it won't clutter the palette for vaults with no scripts.

---

## Lifecycle order

```
Vault opens
  → index rebuilt
  → scripts loaded (each script file executed top-to-bottom)
  → index:ready fires
  → entity:validate fires for every entity

Entity note saved
  → entity upserted into index
  → entity:save fires for that entity
  → entity:validate fires for that entity

Script file created / modified / deleted
  → all hooks cleared
  → all script files reloaded
  → index:ready fires (if index exists)
```

---

## Complete example

```js
// _ontologize/scripts/academic.js
//
// Validates that every Student has an advisor who is a Professor.
// Adds a Wikipedia fetch action to the entity actions modal for people.

ontologize.on('entity:validate', (entity, api) => {
  if (!entity.instanceOf.includes('Student')) return;

  const advisor = entity.frontmatter['advisor'];
  if (!advisor) {
    api.issue(entity.path, 'Student requires an advisor field', 'error');
    return;
  }

  const name = String(advisor).replace(/^\[\[|\]\]$/g, '');
  const target = api.index.entitiesByName.get(name);
  if (target && !target.instanceOf.includes('Professor')) {
    api.issue(entity.path, `Advisor "${name}" is not typed as Professor`, 'warning');
  }
});

ontologize.on('entity:save', async (entity, api) => {
  if (!entity.instanceOf.includes('Publication')) return;

  const year = entity.frontmatter['year'];
  if (typeof year === 'number' && !entity.frontmatter['decade']) {
    await api.updateFrontmatter(entity.path, {
      decade: `${Math.floor(year / 10) * 10}s`,
    });
  }
});

ontologize.ui.registerEntityAction('Look up on Wikipedia', {
  types: ['Person'],
  async run(entity, container, api) {
    const btn = container.createEl('button', { text: 'Fetch summary' });
    const out = container.createEl('p', { cls: 'u-muted', text: 'Press the button to fetch.' });

    btn.addEventListener('click', async () => {
      out.textContent = 'Fetching…';
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.name)}`
        );
        const data = await res.json();
        out.textContent = data.extract ?? 'No article found.';
        if (data.extract) {
          await api.updateFrontmatter(entity.path, { 'wikipedia-summary': data.extract });
        }
      } catch (e) {
        out.textContent = `Fetch failed: ${e.message}`;
      }
    });
  },
});
```
