# Architecture Notes

These notes describe the implemented V1 plugin architecture.
The product contract remains [`spec.md`](spec.md); this document explains how the current code maps to that contract.

## Design Goals

- Keep Markdown and YAML frontmatter as the source of truth.
- Keep ontology logic independent from Obsidian UI surfaces where practical.
- Treat indexing as a graph problem over vault files, not a tag expansion problem.
- Keep the in-memory graph hot by applying file-level updates as Obsidian reports changes.
- Support Linter-style path scoping so users can exclude generated notes, templates, archives, or private folders from enforcement.
- Keep automatic relation writes opt-in at both the plugin setting and relation definition levels.
- Cache derived graph state for startup and debugging.

## Module Layout

- `src/Plugin.ts` is the Obsidian wrapper.
  It registers commands, settings, vault-change listeners, and the `ontology-query` code block processor.
- `src/PluginSettings.ts` and `src/PluginSettingsTab.ts` define user-configurable plugin settings.
- `src/ontology/parser.ts` reads type files and entity frontmatter into typed records.
- `src/ontology/indexer.ts` builds and incrementally updates the ontology graph, computes inherited type chains, computes effective lock states, and validates consistency.
- `src/ontology/query.ts` evaluates the V1 query subset against the built index.
- `src/ontology/mutations.ts` performs frontmatter writes for scaffolding and missing inverse relation fixes.
- `src/ontology/cache.ts` hydrates and serializes the derived index at the configured vault cache path.
- `src/ontology/links.ts` normalizes Obsidian wiki links and extracts relation targets.
- `src/ontology/types.ts` contains the core TypeScript data model.

## Data Flow

1. On plugin load, `readOntologyCache()` attempts to hydrate the previous graph from the configured cache path.
2. On layout ready, `Plugin.rebuildIndex()` performs the cold full-vault build with `buildOntologyIndex()`.
3. The indexer scans all Markdown files once.
4. Files under the configured type folder, `_types` by default, are parsed as ontology types.
5. Other Markdown files with `instance_of` or `type` frontmatter are parsed as ontology entities.
6. The indexer computes ancestor sets for each type.
7. The indexer collects global relation definitions from relation-registry type files.
8. The indexer resolves type composition from `extends` and `implements`.
9. The indexer computes effective lock states for types and entities.
10. Validation issues are collected into `OntologyIndex.issues`.
11. If automatic inverse updates are enabled, missing inverse entries are repaired only for relations declaring `auto-update: true`.
12. The cache writer saves the derived index to `.obsidian/ontology-cache.json` by default.
13. Query blocks and commands use the in-memory index, rebuilding only if the index is missing or the user runs the rebuild command.

After the cold build, file events update the hot graph incrementally.
Cache writes are debounced; in-memory graph updates are not.

## Incremental Graph Backend

The backend keeps parsed source records and derived state in the same `OntologyIndex`.
This mirrors the useful part of Breadcrumbs' architecture: the graph stays resident and reacts to Obsidian events instead of treating every edit as a reason to reread the vault.

Event handling:

- `metadataCache.changed` updates an entity from current frontmatter.
- `vault.modify` updates type files, because type definitions can live in Markdown body YAML rather than frontmatter.
- `vault.create` indexes new type files immediately; new entity files enter through metadata cache updates.
- `vault.delete` removes matching entity/type nodes, including descendants when a folder path is deleted.
- `vault.rename` removes the old path and indexes the new path when it is a Markdown file.

Each event applies one raw source change:

- `upsertOntologyFile()` removes stale records for that path and parses the changed file.
- `removeOntologyFile()` removes stale records for that file or folder path.
- `recomputeOntologyDerivedState()` refreshes ancestor sets, name indexes, lock states, and validation from already parsed records.

For entity edits, this avoids rereading unrelated files.
For type edits, the derived pass still revalidates the graph because inheritance and schema changes can affect every downstream entity.
This keeps schema validity current without forcing full vault I/O on every ordinary note edit.

## Linter-Inspired Operational Model

The Obsidian Linter plugin is a useful model for operational control.
For ontology, the equivalent is not formatting text; it is deciding where schema enforcement applies and how checks/fixes are scoped.

Borrowed patterns:

- Ignored folders, ignored file patterns, and ignored frontmatter rules are settings, not ontology facts.
- Commands can target a scope, starting with the active note and the whole vault.
- Issue review uses commands/settings and an Obsidian modal rather than note code blocks.
- Bulk writes remain explicit commands unless both plugin settings and schema relation definitions opt in.
- Settings and cache writes are debounced; validation state stays in memory.

Ignored folders are vault-relative path prefixes.
Ignored file patterns are JavaScript regular expressions matched against vault-relative paths.
Ignored files are skipped during cold indexing and removed from the hot index on incremental updates.

Ignored frontmatter rules apply to entity notes, not type files.
Each rule is either a key presence check or a `key: value` match, for example `up: Philosopher`.
For value rules, scalar values and array entries are compared as strings and as normalized wiki-link targets.

## Issue Review

Validation issues are exposed through:

- `Check ontology consistency`
- `Check active ontology note`
- `Open ontology issues`
- the `Issue report` button in plugin settings

The issue modal shows current in-memory validation results, supports severity and autofixable filters, opens affected files, rebuilds the index, and runs inverse-relation fixes.
This keeps validation review in Obsidian UI instead of requiring users to embed operational code blocks in notes.

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
- `implements`
- `interface`
- `abstract`
- `disjoint`
- `must-have`
- `can-have`
- `cannot-have`
- `relations`
- `lock`
- `type`
- `values`

## Composition And Global Relations

The backend now treats interfaces as first-class schema nodes.
Inheritance still models identity, but reusable capabilities should be represented with `interface: true` and consumed through `implements`.

Example:

```yaml
# _types/Influenceable.md
interface: true
relations:
  - influenced_by
```

```yaml
# _types/Philosopher.md
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
```

Validation flattens both inherited types and implemented interfaces.
Interfaces can contribute `must-have`, `can-have`, `cannot-have`, and `relations` contracts.
Entities cannot directly instantiate interface types.

Reusable relation definitions are declared in type files with `type: relation-definitions`, `type: relation-registry`, or `type: relations`.
Those files are parsed into `OntologyIndex.relationDefinitions`.
Interface and class relation declarations can reference them with shorthand list syntax or with `uses`.

```yaml
# _types/_relations.md
type: relation-definitions
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced
    auto-update: true
```

```yaml
relations:
  - influenced_by
```

The resolver merges the global relation definition with local overrides.
Local declarations win, so an interface can narrow `range` or cardinality without redefining inverse behavior everywhere.
The query engine uses the same composition chain, so `type: Influenceable` matches entities whose direct type implements that interface.

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
- Nominal property values outside allowed values
- Relation values that both assert and explicitly negate the same target
- Missing inverse or symmetric relation entries

Missing inverse entries are marked autofixable.
They are not silently written during validation unless plugin-level automatic inverse updates are enabled and the relation itself declares `auto-update: true`.

## Query Engine

V1 query parsing is deliberately small but supports boolean expressions.
It supports `AND`, `OR`, unary `NOT`, parenthesized groups, type filters, property filters, existence checks, and include-mode widening.

Examples:

```text
type: Person
type: Philosopher AND influenced_by: [[Descartes]]
type: Philosopher AND NOT influenced: [[Nietzsche]]
type: Philosopher OR type: Scientist
(type: Rationalist OR type: Empiricist) AND birth-date: EXISTS
type: Person AND birth-date: EXISTS
type: Philosopher AND include: all
```

Traversal, saved queries, and comparison expressions from the larger spec are not implemented yet.

## Mutations

The plugin mutates frontmatter through explicit commands and one guarded automatic path:

- `Scaffold active ontology note`
- `Fix missing inverse relations`

Scaffolding adds missing inherited `must-have` and `can-have` fields with `null` values.

Inverse fixing reads validation issues, finds missing inverse or symmetric relation entries, and appends wiki links to the target note's frontmatter.

When `autoUpdateInverses` is enabled, rebuilds automatically fix missing inverse entries only for relation definitions with `auto-update: true`.
The automatic path is guarded against recursive write loops.

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

The plugin attempts to load this cache on startup.
Malformed, missing, or version-mismatched cache files are ignored and replaced by a normal rebuild.

## Known Gaps

- No parser for `WHERE`, traversal, comparison expressions, or saved-query composition.
- No migration dry-run and confirmation workflow.
- No automatic instantiation hook runner.
- No adaptive validation priority queue.
- No Obsidian Bases integration.

These are the next implementation layers after the V1 graph, query, validation, and command surface stabilizes.
