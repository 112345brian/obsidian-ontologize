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
- Keep automatic scaffolding opt-in and tied to completed ontology membership.
- Cache derived graph state for startup and debugging.

## Module Layout

- `src/Plugin.ts` is the Obsidian wrapper.
  It registers commands, settings, vault-change listeners, and the `ontology-query` code block processor.
- `src/PluginSettings.ts` and `src/PluginSettingsTab.ts` define user-configurable plugin settings.
- `src/ontology/parser.ts` reads type files, the optional single schema file, and entity frontmatter into typed records.
- `src/ontology/indexer.ts` builds and incrementally updates the ontology graph, computes inherited type chains, computes effective lock states, and validates consistency.
- `src/ontology/query.ts` evaluates the V1 query subset against the built index.
- `src/ontology/mutations.ts` performs frontmatter writes for scaffolding and missing inverse relation fixes.
- `src/ontology/cache.ts` hydrates and serializes the derived index at the configured vault cache path.
- `src/ontology/links.ts` normalizes Obsidian wiki links and extracts relation targets.
- `src/ontology/types.ts` contains the core TypeScript data model.

## Data Flow

1. On plugin load, `readOntologyCache()` attempts to hydrate the previous graph from the configured cache path.
   A hydrated cache is discarded when its recorded index settings (type folder, schema path, ignore rules) differ from the current plugin settings, because it describes a different graph.
2. On layout ready, `Plugin.rebuildIndex()` performs the cold full-vault build with `buildOntologyIndex()`.
   Until this first cold build completes, automatic inverse writes are suppressed: the hydrated cache may be stale relative to the vault, and frontmatter writes based on stale state are not recoverable.
3. The indexer scans all Markdown files once.
4. If the configured schema file exists, it is parsed first.
5. Files under the configured type folder, `_types` by default, are parsed as modular ontology types.
6. Other Markdown files with one of the configured entity type frontmatter fields are parsed as ontology entities.
7. The indexer computes ancestor sets for each type.
8. The indexer collects global relation definitions from relation-registry type files.
9. The indexer resolves type composition from `extends` and `implements`.
10. The indexer computes effective lock states for types and entities.
11. Validation issues are collected into `OntologyIndex.issues`.
12. If automatic inverse updates are enabled, missing inverse entries are repaired only for relations declaring `auto-update: true`.
13. The cache writer saves the derived index to `.obsidian/ontology-cache.json` by default.
14. Query blocks and commands use the in-memory index, rebuilding only if the index is missing or the user runs the rebuild command.

After the cold build, file events update the hot graph incrementally.
Cache writes are debounced; in-memory graph updates are not.

## Incremental Graph Backend

The backend keeps parsed source records and derived state in the same `OntologyIndex`.
This mirrors the useful part of Breadcrumbs' architecture: the graph stays resident and reacts to Obsidian events instead of treating every edit as a reason to reread the vault.

All operations that replace the in-memory index — full rebuilds, incremental upserts, deletes, and renames — run through a single serialized task queue inside `Plugin`.
Obsidian events can interleave (an entity edit immediately followed by a schema save, for example), and without ordering, a slow incremental update could resolve after a newer full rebuild and overwrite it with a stale graph.
The queue guarantees that index assignments land in submission order.

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
For single schema file edits, the plugin performs a full rebuild because that file can introduce, remove, or rename many constructors at once.
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

Type files are regular Markdown files in the configured type folder, `_types` by default.
The parser accepts either YAML frontmatter or the spec's heading-plus-YAML body style.
This is an either/or contract per file: if frontmatter exists, it is the schema definition and body YAML is ignored; otherwise the body is parsed after an optional `# Heading`.

```markdown
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

The complete authoring reference lives in [`schema-api.md`](schema-api.md).

## Schema Sources

The ontology supports two schema authoring styles that compile to the same internal records:

- A single configured JSON/YAML schema file, `_types/ontology.schema.yaml` by default.
- Modular constructor files in the configured type folder.

The single schema file supports three top-level maps:

```yaml
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced

interfaces:
  Influenceable:
    lock: true
    relations:
      - influenced_by

types:
  Philosopher:
    lock: true
    extends:
      - [[Person]]
    implements:
      - [[Influenceable]]
```

The parser creates synthetic type records from this file:

- `relations` becomes a relation registry type.
- `interfaces` become `interface: true` type records.
- `types` become ordinary type records.

The schema file is loaded before modular constructor files.
If both sources define the same type name, the later modular file wins.
Changing the schema file triggers a full index rebuild.

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
An entity participates in the ontology only when its frontmatter contains one of the configured entity type fields.
The defaults are `instance_of` and `type`.
The first configured field with a non-empty value wins.

```yaml
---
instance_of: "[[Rationalist]]"
lock: true
influenced_by:
  - "[[Descartes]]"
---
```

Notes without a configured ontology membership field are ignored by V1 ontology validation and trusted query results.

## Inheritance And Locks

For each type, the indexer stores a transitive ancestor set.
For each entity, query evaluation uses the entity's direct types plus all ancestors.

Effective type lock:

- `locked`: type has `lock: true` and all ancestors have `lock: true`
- `incomplete`: type has `lock: true`, but at least one ancestor is not locked
- `unlocked`: type has no `lock: true`

Types that participate in a circular inheritance chain are tracked in `OntologyIndex.circularTypes` and can never be effectively locked, regardless of lock intent.
This upholds the spec rule that no file in a circular chain can ever be locked: the cycle is reported as an error and every member (and everything that inherits from a member) computes as `incomplete` at best, keeping cyclic schemas out of trusted query results.

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
- Property values outside inline or nominal allowed values
- Relation values that both assert and explicitly negate the same target
- Missing inverse or symmetric relation entries
- Duplicate entity names (two notes with the same basename) and relation targets that resolve to a duplicated name

Entity names are resolved by note basename.
When two ontology notes share a basename, the name is recorded in `OntologyIndex.ambiguousEntityNames`, a vault-level warning is raised, and relation targets pointing at that name are flagged as ambiguous instead of being validated against an arbitrary file.
Inverse fixing skips ambiguous targets for the same reason: a write that lands on an arbitrary note is worse than no write.

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

Query blocks default to locked-only results.
The `Default locked query results` plugin setting moves that default: when disabled, blocks without an explicit `include:` evaluate as `include: all`.
An explicit `include:` inside the block always wins over the setting.
The default is applied as an engine option (`runOntologyQuery`'s `defaultInclude`), not by rewriting the query source, so there is exactly one place where the locked-only rule lives.
Rendered result tables end with a result count.

Traversal, saved queries, and comparison expressions from the larger spec are not implemented yet.

## Mutations

The plugin mutates frontmatter through explicit commands and one guarded automatic path:

- `Scaffold active ontology note`
- `Fix missing inverse relations`

Scaffolding adds missing inherited `must-have`, `can-have`, and relation fields with `null` values.
Manual scaffolding runs through `Scaffold active ontology note`.

When `autoScaffoldEntities` is enabled, metadata changes on entity notes can trigger the same scaffold write automatically.
The automatic path only runs after the first full cold-vault rebuild and only when the note has completed ontology membership: the configured entity type field parses to at least one direct type, and every direct type exists, is not abstract, is not an interface, and is not part of a circular inheritance chain.
This lets setting `instance_of`, `type`, or another configured membership field expand the note shape without requiring a command.

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
