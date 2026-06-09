# Obsidian Ontology

Obsidian Ontology is a local-first Obsidian plugin for ontology-aware Markdown notes.
It keeps ontology data in ordinary Markdown and YAML frontmatter, then adds inheritance-aware indexing, validation, inverse relation maintenance, and inline query rendering.

The project was scaffolded from the fork of [`mnaoumov/generator-obsidian-plugin`](https://github.com/mnaoumov/generator-obsidian-plugin) that already exists under this account.

## V1 Features

- Reads type definitions from `_types/*.md`
- Supports `extends`, `abstract`, `disjoint`, `must-have`, `can-have`, `cannot-have`, `relations`, `lock`, and nominal `values`
- Resolves inherited type chains for entities with `instance_of` or `type` frontmatter
- Computes effective lock state from entity/type lock intent and ancestor locks
- Renders inheritance-aware queries in `ontology-query` code blocks
- Writes `.obsidian/ontology-cache.json` after index rebuilds
- Checks schema consistency and relation ranges
- Detects missing inverse/symmetric relation entries
- Provides commands to rebuild, check, scaffold the active note, and fix missing inverses

## Query Blocks

````markdown
```ontology-query
type: Philosopher
AND NOT influenced: [[Nietzsche]]
AND birth-date: EXISTS
```
````

Queries default to locked entities. Add `include: incomplete` or `include: all` to widen results.

Supported V1 clauses:

- `type: Person`
- `instance_of: [[Philosopher]]`
- `property: [[Target]]`
- `property: scalar-value`
- `property: EXISTS`
- `property: NOT EXISTS`
- `NOT property: [[Target]]`
- `include: locked | incomplete | all`

## Commands

- `Obsidian Ontology: Rebuild ontology index`
- `Obsidian Ontology: Check ontology consistency`
- `Obsidian Ontology: Scaffold active ontology note`
- `Obsidian Ontology: Fix missing inverse relations`

## Development

```bash
npm install
npm run build
npx tsc --noEmit
```

Build artifacts are emitted as `main.js`, `manifest.json`, and `styles.css`.

## Spec

The product/system specification lives at [`docs/spec.md`](docs/spec.md).
Architecture notes for the current V1 implementation live at [`docs/architecture.md`](docs/architecture.md).
