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

### Plugin shell (`src/`)

- `src/Plugin.ts` — Obsidian wrapper. Registers commands, settings, vault-change listeners, and the `ontology-query` code block processor. Owns the serialized task queue that prevents index assignments from racing. Handles all membership-transition side effects: auto-scaffold gating, type replacement, and template injection.
- `src/PluginSettings.ts` — user-configurable settings shape. Includes `initialScaffoldComplete` flag that gates auto-scaffold until the user runs bulk scaffold once.
- `src/PluginSettingsTab.ts` — settings UI.
- `src/main.ts` — plugin entry point.
- `src/templater.ts` — Templater integration. `applyTypeTemplate(app, templateName, entityFile)` resolves the template note, invokes Templater if available (via `create_running_config` + `read_and_parse_template`), and falls back to raw body copy. Only runs when the entity body is empty.

### Modals (`src/`)

- `src/OntologyBulkScaffoldModal.ts` — three-phase bulk scaffold modal: select (per-type entity/field counts + master checkbox) → preview (per-entity field cards) → apply. Exported `BulkScaffoldEntityDiff { name, path, plans }` is the payload passed to `onApply`. Running this modal once sets `initialScaffoldComplete`.
- `src/OntologyScaffoldReviewModal.ts` — per-note scaffold review modal for auto-scaffold and `Scaffold active ontology note`.
- `src/OntologyTypeEditorModal.ts` — structured editor for creating and modifying type constructor files. Manages `extends`, `implements`, `interface`/`abstract`/`lock` flags, `requires`, `excludes`, `replaces`, `template`, `must-have`/`can-have` fields, and relations. Preserves schema keys outside its ownership on save.
- `src/OntologyTypeLibraryModal.ts` — browse and select from existing types.
- `src/OntologyTypeWizardModal.ts` — guided type creation flow.
- `src/OntologyIssuesModal.ts` — entity validation issue list with severity filter, file open, rebuild, and inverse-fix actions.
- `src/OntologySchemaDiagnosticsModal.ts` — schema authoring diagnostics with circular type visibility and schema summary counts.
- `src/OntologyRelationFixModal.ts` — review and apply missing inverse relation fixes.

### Ontology core (`src/ontology/`)

- `src/ontology/types.ts` — core TypeScript data model. Key interfaces: `OntologyType`, `OntologyEntity`, `OntologyIndex`, `PropertyDefinition`, `RelationDefinition`, `TypeReplacement`, `OntologyIssue`, `ScaffoldFieldPlan`, `EffectiveLockState`.
- `src/ontology/parser.ts` — reads type files, the optional single schema file, and entity frontmatter into typed records. Accepts YAML frontmatter or heading-plus-body YAML. Handles all type fields including backward-compatible remove-only and from/to `replaces` rules, `template`, `requires`, and `excludes`. Exports `DEFAULT_BLOCK_PREFIX`.
- `src/ontology/compose.ts` — single home for composition-chain resolution: inheritance plus interface flattening, global field/relation registries, definition merging, frontmatter-key aliasing, and issue deduplication. The indexer, validator, query engine, and mutation planner all resolve through it.
- `src/ontology/schema-linter.ts` — validates source syntax and authoring shapes before constructors enter the graph. Errors block parsing; warnings surface in diagnostics. Validates all type constructor fields including `replaces`, `requires`, `excludes`, `template`. Reports non-kebab identifiers as warnings.
- `src/ontology/indexer.ts` — builds and incrementally updates the ontology graph. Computes ancestor sets, effective lock states, name indexes, and orchestrates derived-state recomputation after any source change.
- `src/ontology/validate.ts` — entity validation and schema composition conflict detection. Merges contracts across all declared types before checking so each issue is reported exactly once.
- `src/ontology/mutations.ts` — frontmatter writes for scaffolding and missing inverse relation fixes. `planScaffoldEntity` builds `ScaffoldFieldPlan[]`. `applyScaffoldPlan` executes selected plans. `shouldAutoApplyScaffold` returns true when any of an entity's types declares `auto-apply: true`.
- `src/ontology/query.ts` — V1 query subset: `AND`, `OR`, `NOT`, type filters, property filters, existence checks, include-mode widening.
- `src/ontology/cache.ts` — hydrates and serializes the derived index at the configured vault cache path. Cache version 1. Discarded when recorded settings differ from current plugin settings.
- `src/ontology/diagnostics.ts` — `buildSchemaDiagnostics` summarizes schema shape and extracts schema-scoped issues.
- `src/ontology/links.ts` — normalizes Obsidian wiki links, extracts relation targets, `containsFrontmatterValue` for idempotent membership checks.
- `src/ontology/templates.ts` — safe insert-template registry. Currently supports `date.now()` → current local `YYYY-MM-DD`.
- `src/ontology/type-editor.ts` — `TypeEditorModel` shape and serialization. `typeEditorModelFromType` converts a parsed `OntologyType` to the editor model. `typeEditorFrontmatter` serializes the model back to YAML-ready frontmatter. `TYPE_EDITOR_KEYS` lists all keys owned by the editor (used to preserve unrelated keys on save).
- `src/ontology/type-expression.ts` — parse and validate `|` union type expressions used in `type`, `value-type`, and `range` fields.
- `src/ontology/issues.ts` — shared issue construction helpers.

## Data Flow

1. On plugin load, `readOntologyCache()` attempts to hydrate the previous graph from the configured cache path. A hydrated cache is discarded when its recorded index settings (type folder, schema path, ignore rules) differ from the current plugin settings.
2. On layout ready, `Plugin.rebuildIndex()` performs the cold full-vault build with `buildOntologyIndex()`. Until this first cold build completes, automatic inverse writes are suppressed.
3. The indexer scans all Markdown files once.
4. If the configured schema file exists, it is parsed first.
5. Files under the configured type folder (`_types` by default) are parsed as modular ontology types.
6. Other Markdown files with one of the configured entity type frontmatter fields are parsed as ontology entities.
7. The indexer computes ancestor sets for each type.
8. The indexer collects global field and relation definitions from registry type files.
9. The indexer resolves type composition from `extends` and `implements`.
10. The indexer computes effective lock states for types and entities.
11. Validation issues are collected into `OntologyIndex.issues`.
12. If automatic inverse updates are enabled, missing inverse entries are repaired for relations with `auto-update: true`.
13. The cache writer saves the derived index to `.obsidian/ontology-cache.json` by default.
14. Query blocks and commands use the in-memory index.

After the cold build, file events update the hot graph incrementally. Cache writes are debounced; in-memory graph updates are not.

## Incremental Graph Backend

All operations that replace the in-memory index — full rebuilds, incremental upserts, deletes, renames — run through a single serialized task queue inside `Plugin`. This prevents a slow incremental upsert from resolving after a newer full rebuild and overwriting it with a stale graph.

Event handling:

- `metadataCache.changed` → update entity from current frontmatter, then run membership-transition side effects (see below).
- `vault.modify` → update type files (definitions live in body YAML, not frontmatter).
- `vault.create` → index new type files immediately; entity files enter through metadata cache events.
- `vault.delete` → remove matching entity/type nodes, including descendants when a folder path is deleted.
- `vault.rename` → remove old path, index new path. Folder renames trigger full rebuild (Obsidian does not emit per-child events).

Each event applies one raw source change:

- `upsertOntologyFile()` removes stale records for that path and parses the changed file.
- `removeOntologyFile()` removes stale records for that file or folder path.
- `recomputeOntologyDerivedState()` refreshes ancestor sets, name indexes, lock states, and validation from already parsed records.

## Membership-Transition Side Effects

When an entity's resolved direct types change (the set before and after a `metadataCache.changed` event differs), `upsertFileCore` triggers three side effects in order:

1. **Auto-scaffold** — calls `applyAutoScaffold(file)`. Gated by: `initialScaffoldComplete` must be true (the user must have run bulk scaffold at least once), the entity's types must all be concrete and non-circular, and the file must not be in the dismissed set. Types with `auto-apply: true` are scaffolded silently without a review modal. Other types open `OntologyScaffoldReviewModal` if `autoScaffoldEntities` is enabled.

2. **Type replacement** — collects `TypeReplacement[]` from all newly-added types' `replaces` fields. Each rule removes its original value and can add a new value in the same or a different frontmatter field. Legacy rules without `new-value` remain remove-only.

3. **Template injection** — for the first newly-added type that declares a `template`, calls `applyTypeTemplate(app, templateName, file)`. Only runs if the entity body is empty. Templater is used if available; otherwise raw body text is copied.

## Scaffolding

### Bulk scaffold gate

`PluginSettings.initialScaffoldComplete` (default: `false`) controls whether auto-scaffold runs. The `Scaffold all entities` command opens `OntologyBulkScaffoldModal` and sets this flag to `true` on apply (even if zero fields were written). Until it is set, `applyAutoScaffold` returns immediately without checking membership.

### Bulk scaffold modal phases

1. **Select** — `precompute()` builds `entityDiffs: Map<string, BulkScaffoldEntityDiff>` filtering to plans with `insert !== undefined`. Per-type rows show entity and field counts. Master checkbox has indeterminate state. Types with at least one actionable entity are pre-selected.
2. **Preview** — scrollable entity cards. Each field shows key, value (colored), and kind label (required/optional/relation).
3. **Apply** — `onApply(diffs)` callback in Plugin calls `applyBulkScaffoldDiffs`, which iterates diffs, calls `applyScaffoldPlan` for each, rebuilds the index, and shows a notice.

## Linter-Inspired Operational Model

Borrowed patterns:

- Ignored folders, ignored file patterns, and ignored frontmatter rules are settings, not ontology facts.
- Commands can target a scope, starting with the active note and the whole vault.
- Issue review uses commands/settings and Obsidian modals rather than note code blocks.
- Bulk writes remain explicit commands unless both plugin settings and schema relation definitions opt in.
- Settings and cache writes are debounced; validation state stays in memory.

Ignored frontmatter rules apply to entity notes, not type files. Each rule is either a key presence check or a `key: value` match. For value rules, scalar values and array entries are compared as strings and as normalized wiki-link targets.

## Issue Review

- `Check ontology consistency` / `Open ontology issues` — entity validation issues with severity/autofixable filters.
- `Check active ontology note` — narrows to the active file.
- `Open ontology schema diagnostics` / `Lint ontology schema` — schema authoring issues with circular type list and summary counts.
- `Issue report` and `Schema diagnostics` buttons in plugin settings.

Schema lint findings are stored in `OntologyIndex.schemaIssues`. `recomputeOntologyDerivedState()` starts with those findings before adding graph and entity validation issues, so incremental updates do not erase source diagnostics. Lint errors block the affected source; warnings preserve the constructor.

## Type Parsing

Type files are regular Markdown files in the configured type folder. The parser accepts YAML frontmatter or the heading-plus-body style — one style per file. If frontmatter exists, body YAML is ignored.

Implemented type constructor fields:

- `extends` — identity inheritance (link or array)
- `implements` — composition contracts (link or array)
- `interface` — marks as interface (cannot be directly instantiated)
- `abstract` — marks as non-instantiable but inheritable
- `disjoint` — mutual exclusion constraints
- `must-have` — required property map
- `can-have` — optional property map
- `cannot-have` — forbidden keys/values
- `fields` — global field definitions when `type: field-definitions`
- `relations` — relation contracts (array shorthand or definition map)
- `lock` — lock intent
- `type` — constructor kind (`nominal`, `interface`, `field-definitions`, `relation-definitions`)
- `values` — allowed values for `type: nominal`
- `auto-apply` — if `true`, scaffold runs silently without review modal
- `requires` — co-required types (validation constraint)
- `excludes` — mutually exclusive types (validation constraint)
- `replaces` — original/new frontmatter field-value transformations applied when this type is added; string entries remain remove-only
- `template` — wikilink to a Markdown note whose body is injected into new entities with empty bodies

The complete authoring reference lives in [`schema-api.md`](schema-api.md).

## Schema Sources

Two authoring styles compile to the same internal records:

- A single configured JSON/YAML schema file (`_types/ontology.schema.yaml` by default).
- Modular constructor files in the configured type folder.

The single schema file supports four top-level maps:

```yaml
fields:
  birth-year:
    type: number
    cardinality: one

relations:
  influenced-by:
    value-type: wikilink
    range: "[[Person]]"
    inverse: influenced

interfaces:
  Influenceable:
    lock: true
    relations:
      - influenced-by

types:
  Philosopher:
    lock: true
    extends:
      - "[[Person]]"
    implements:
      - "[[Influenceable]]"
```

The parser creates synthetic type records: `relations` becomes a relation registry type, `interfaces` become `interface: true` records, `types` become ordinary type records. The schema file is loaded before modular constructor files; if names collide, the later modular file wins. Changing the schema file triggers a full index rebuild.

## Composition And Global Relations

`compose.ts` is the single resolver. Inheritance models identity (`extends`); reusable capabilities use `interface: true` + `implements`. Validation flattens both.

Global field registries (`type: field-definitions`) are parsed into `OntologyIndex.fieldDefinitions`. Property definitions reference them with `uses`. The resolved definition carries a `frontmatter-key` alias. Compatible optional/required uses of the same global field collapse to the stricter contract; incompatible duplicates are schema issues. Local fields from different interfaces are different semantic fields — composing them to the same frontmatter key is a schema issue.

Global relation definitions (`type: relation-definitions`) are parsed into `OntologyIndex.relationDefinitions`. Interface and class relation declarations reference them by name. Local declarations win over global defaults.

## Entity Parsing

Entities are Markdown files outside the type folder with one of the configured entity type fields. Defaults are `is-instance` and `type`; the first configured field with a non-empty value wins. External YAML identifiers use kebab-case; TypeScript model properties use camelCase internally.

## Inheritance And Locks

For each type, the indexer stores a transitive ancestor set. For each entity, query evaluation uses direct types plus all ancestors.

Effective type lock:

- `locked` — `lock: true` and all ancestors locked
- `incomplete` — `lock: true` but at least one ancestor not locked
- `unlocked` — no `lock: true`

Types in a circular inheritance chain are tracked in `OntologyIndex.circularTypes` and can never be effectively locked, regardless of lock intent.

Effective entity lock:

- `locked` — `lock: true` and all direct types effectively locked
- `incomplete` — `lock: true` but at least one direct type not effectively locked
- `unlocked` — no `lock: true`

Query blocks default to locked results unless the query includes `include: incomplete` or `include: all`.

## Validation

Entity contracts are merged across every declared type before validating, so each problem is reported exactly once. All issue pushes are deduplicated in O(1) through a keyed seen-set.

The checker reports:

- Unknown parent types; circular inheritance
- Unknown instantiated types; direct instantiation of abstract types
- Disjoint type conflicts
- `requires` co-membership violations (warning)
- `excludes` co-membership conflicts (error)
- Missing inherited `must-have` properties
- Present inherited `cannot-have` properties
- Cardinality violations for `one` and `one-to-one`
- Unknown relation targets; relation targets outside declared `range`
- Property values outside inline or nominal allowed values
- Relation values that both assert and explicitly negate the same target
- Missing inverse or symmetric relation entries (autofixable)
- Duplicate entity basenames; relation targets that resolve to a duplicated name

## Query Engine

V1 query parsing supports `AND`, `OR`, unary `NOT`, parenthesized groups, type filters, property filters, existence checks, and include-mode widening.

The `Default locked query results` setting controls the default include mode. An explicit `include:` inside the block always wins. The default is applied as an engine option, not by rewriting query source.

Traversal, saved queries, and comparison expressions from the spec are not implemented yet.

## Mutations

Scaffolding adds missing inherited fields with `null` values. Properties with `insert` plan a required-member mutation: create, append to an existing list, or convert scalar to list while preserving it. `applyScaffoldPlan` executes selected plans.

`shouldAutoApplyScaffold` returns `true` when any of an entity's types has `auto-apply: true` (or an `auto-apply` block that evaluates to true against the entity's frontmatter). These types bypass the review modal and write directly.

Inverse fixing reads validation issues and appends wiki links to the target note's frontmatter. The automatic path is guarded against recursive write loops.

## Cache

The cache is derived state, not source of truth. Written after rebuilds and incremental updates (debounced). Contains:

- Type records (with all fields including `replaces`, `requires`, `excludes`, `template`)
- Entity records
- Ancestor sets per type
- Effective lock states for types and entities
- Field definitions and relation definitions (global registries)
- Validation issues and schema issues
- `ambiguousEntityNames` and `circularTypes` sets
- Generation timestamp
- Index settings (used to detect stale cache on startup)
- `cacheVersion: 1`

Malformed, missing, or version-mismatched cache files are ignored and replaced by a normal rebuild.

## Known Gaps

- No parser for `WHERE`, traversal, comparison expressions, or saved-query composition.
- No migration dry-run and confirmation workflow.
- No adaptive validation priority queue.
- No Obsidian Bases integration.

These are the next implementation layers after the V1 graph, query, validation, and command surface stabilizes.
