# Architecture Notes

These notes describe the implemented V1 plugin architecture.
The product contract remains [`spec.md`](spec.md); this document explains how the current code maps to that contract.

## Design Goals

- Keep Markdown and YAML frontmatter as the source of truth.
- Keep ontology logic independent from Obsidian UI surfaces where practical.
- Treat indexing as a graph problem over vault files, not a tag expansion problem.
- Make relation writes explicit through a command before enabling automatic mutation.
- Cache derived graph state for startup and debugging.

## Module Layout

- `src/Plugin.ts` is the Obsidian wrapper.
  It registers commands, settings, vault-change listeners, and the `ontology-query` code block processor.
- `src/PluginSettings.ts` and `src/PluginSettingsTab.ts` define user-configurable plugin settings.
- `src/ontology/parser.ts` reads type files and entity frontmatter into typed records.
- `src/ontology/indexer.ts` builds the ontology graph, computes inherited type chains, computes effective lock states, and validates consistency.
- `src/ontology/query.ts` evaluates the V1 query subset against the built index.
- `src/ontology/mutations.ts` performs frontmatter writes for scaffolding and missing inverse relation fixes.
- `src/ontology/cache.ts` serializes the derived index to the configured vault cache path.
- `src/ontology/links.ts` normalizes Obsidian wiki links and extracts relation targets.
- `src/ontology/types.ts` contains the core TypeScript data model.

## Data Flow

1. On layout ready, `Plugin.rebuildIndex()` calls `buildOntologyIndex()`.
2. The indexer scans all Markdown files.
3. Files under the configured type folder, `_types` by default, are parsed as ontology types.
4. Other Markdown files with `instance_of` or `type` frontmatter are parsed as ontology entities.
5. The indexer computes ancestor sets for each type.
6. The indexer computes effective lock states for types and entities.
7. Validation issues are collected into `OntologyIndex.issues`.
8. The cache writer saves the derived index to `.obsidian/ontology-cache.json` by default.
9. Query blocks and commands use the in-memory index, rebuilding if needed.

Vault create, modify, and delete events schedule a debounced rebuild.

## Type Parsing

Type files are regular Markdown files in `_types/`.
The parser accepts either YAML frontmatter or the spec's heading-plus-YAML body style:

```markdown
# Philosopher
extends:
  - [[Person]]
lock: true
```

Implemented fields:

- `extends`
- `abstract`
- `disjoint`
- `must-have`
- `can-have`
- `cannot-have`
- `relations`
- `lock`
- `type`
- `values`

## Entity Parsing

Entities are regular Markdown notes outside the type folder.
An entity participates in the ontology only when its frontmatter contains `instance_of` or `type`.

```yaml
---
instance_of: "[[Rationalist]]"
lock: true
influenced_by:
  - "[[Descartes]]"
---
```

Notes without a type field are ignored by V1 ontology validation and trusted query results.

## Inheritance And Locks

For each type, the indexer stores a transitive ancestor set.
For each entity, query evaluation uses the entity's direct types plus all ancestors.

Effective type lock:

- `locked`: type has `lock: true` and all ancestors have `lock: true`
- `incomplete`: type has `lock: true`, but at least one ancestor is not locked
- `unlocked`: type has no `lock: true`

Effective entity lock:

- `locked`: entity has `lock: true` and all direct types are effectively locked
- `incomplete`: entity has `lock: true`, but at least one direct type is not effectively locked
- `unlocked`: entity has no `lock: true`

Query blocks default to locked results unless the query includes `include: incomplete` or `include: all`.

## Validation

The current checker reports:

- Unknown parent types
- Circular inheritance
- Unknown instantiated types
- Direct instantiation of abstract types
- Disjoint type conflicts
- Missing inherited `must-have` properties
- Present inherited `cannot-have` properties
- Cardinality violations for `one` and `one-to-one`
- Unknown relation targets
- Relation targets outside declared `range`
- Missing inverse or symmetric relation entries

Missing inverse entries are marked autofixable.
They are not silently written during validation.

## Query Engine

V1 query parsing is deliberately small.
It supports conjunctions split by `AND`, unary `NOT`, type filters, property filters, existence checks, and include-mode widening.

Examples:

```text
type: Person
type: Philosopher AND influenced_by: [[Descartes]]
type: Philosopher AND NOT influenced: [[Nietzsche]]
type: Person AND birth-date: EXISTS
type: Philosopher AND include: all
```

`OR`, traversal, saved queries, and comparison expressions from the larger spec are not implemented yet.

## Mutations

The plugin currently mutates frontmatter only through explicit commands:

- `Scaffold active ontology note`
- `Fix missing inverse relations`

Scaffolding adds missing inherited `must-have` and `can-have` fields with `null` values.

Inverse fixing reads validation issues, finds missing inverse or symmetric relation entries, and appends wiki links to the target note's frontmatter.

The `autoUpdateInverses` setting exists as a future switch, but automatic write-on-save behavior is intentionally not active in V1.

## Cache

The cache is derived state, not source of truth.
It is written after rebuilds and contains:

- Type records
- Entity records
- Ancestor sets
- Effective lock states
- Validation issues
- Generation timestamp
- Index settings

The current V1 writes the cache but does not yet load it for startup short-circuiting.

## Known Gaps

- No full parser for `OR`, nested boolean expressions, `WHERE`, traversal, or comparisons.
- No migration dry-run and confirmation workflow.
- No automatic instantiation hook runner.
- No startup cache hydration.
- No adaptive validation priority queue.
- No nominal value validation yet.
- No closed-world negation conflict validation beyond relation target extraction.
- No Obsidian Bases integration.

These are the next implementation layers after the V1 graph, query, validation, and command surface stabilizes.
