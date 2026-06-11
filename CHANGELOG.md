# CHANGELOG

## 0.2.0

Audit-driven correctness, performance, and infrastructure release. Also rolls up the unreleased post-0.1.0 features: schema diagnostics modal, review-first scaffolding, schema composition conflict detection, global field definitions with `frontmatter-key` aliases, `possible-values` constraints, configurable entity type fields, and the demo vault.

### Bug fixes

- **Property and relation types support `|` unions.** Expressions such as `type: wikilink | string`, `value-type: wikilink | string`, and `range: Person | Organization` now normalize and validate as strict alternatives, while malformed unions are reported by the schema linter.
- **Frontmatter schema identifiers now follow kebab-case.** The default membership field is `is-instance`, bundled examples use hyphenated property and relation names, and the internal schema linter warns about non-kebab property names, relation names, inverse names, and aliases.
- **Auto-scaffold now fires only on membership transitions and respects dismissal.** Previously the review modal reopened on every metadata change while a note had missing fields — cancelling it and continuing to edit reopened it immediately. It now opens only when a note's resolved direct types change, and closing it dismisses that note until the membership changes again.
- **Validation reports each entity problem exactly once.** Entities with multiple direct types sharing an ancestor previously produced duplicate "missing required property" and relation issues, inflating issue counts. Contracts are now merged across all declared types before validating, and every issue push is deduplicated.
- **`cannot-have` honors `frontmatter-key` aliases.** A type forbidding a global field's semantic name now catches the aliased frontmatter key, in both entity validation and schema composition conflict detection.
- **Folder renames trigger a full rebuild.** Obsidian does not reliably emit per-child rename events, so renaming a folder of entities previously dropped them from the index until the next manual rebuild.
- **Custom entity type fields work as query predicates.** A configured membership field (for example `is`) now queries the inheritance chain like `type:` and `is-instance:` instead of degrading to a plain property match.

### Performance

- Incremental upserts recompute derived state once per event instead of twice (once for the removal, once for the insert).
- Issue deduplication is O(1) via a keyed seen-set instead of a linear scan per push (previously O(n²) across a recompute).
- Query evaluation and mutation planning no longer mutate the issue list as a side effect; interface declaration problems are reported once per type during recompute.

### Architecture

- New `src/ontology/compose.ts` is the single home for composition-chain resolution, definition merging, and registry collection — the indexer, validator, query engine, and mutation planner all resolve through it, eliminating the three divergent chain implementations.
- Validation moved to `src/ontology/validate.ts`; `indexer.ts` now only builds and derives.
- The scaffold review modal exposes an `onClosed` callback instead of having its `onClose` monkey-patched by the plugin.
- Removed the dead `validationThreshold` setting (it was exposed in the UI but wired to nothing) and the superseded `scaffoldEntity` helper.

### Features

- Property definitions support non-destructive `insert` constraints. Validation requires the configured member, and scaffolding can create, append, or preserve-and-convert existing frontmatter values.
- Added `included-types` and `excluded-types` property constraints. Missing all included types is a warning; matching any excluded type is an error. Scalar `type` remains strict.
- Added safe insert templates. `date.now()` initializes an empty field with the current local `YYYY-MM-DD` date when a scaffold is applied, without evaluating arbitrary JavaScript or overwriting existing values.
- Added an internal schema linter for modular type files and single JSON/YAML schemas, including syntax, shape, unknown-key, constraint-list, and template checks. Errors block malformed constructors; warnings remain visible in Schema Diagnostics.
- Corrected and integration-tested the repo and active-vault examples; YAML wiki links are now quoted, malformed nested arrays are lint errors, and global field overrides retain inherited aliases and constraints.

### Infrastructure

- GitHub Actions CI: lint, type check, tests, and build run on every push and pull request.
- GitHub Actions release workflow: pushing a `v*` tag builds and attaches `main.js`, `styles.css`, and `manifest.json` to a release.
- New test suites: cache write/read round trip, and plugin orchestration (serialized index queue, auto-write gating before first rebuild, stale-settings cache discard, auto-scaffold transitions and dismissal). 48 tests total.
- Bumped the `dompurify` override to 3.2.4 and cleared all `npm audit` advisories.

## 0.1.0

First functional release.

### Bug fixes

- **Circular types can no longer be effectively locked.** Types involved in a circular inheritance chain are tracked in `OntologyIndex.circularTypes`; they and anything that inherits from them compute as `incomplete` regardless of `lock: true`, matching the spec invariant that no file in a cycle may ever be locked.
- **Inverse fixing now uses the same relation resolver as validation.** `planMissingInverses` previously resolved relations by first-match up the ancestor chain, while `validateIndex` resolved by last-match (most-derived wins). When a subtype overrode an `inverse` field the fix would write the wrong property, leaving the original issue unresolved. Both paths now use `resolveEntityRelations` from the indexer, which iterates the composition chain in derived-wins order.
- **Duplicate entity basenames are flagged instead of silently collapsing.** When two notes share a basename, the name is recorded in `OntologyIndex.ambiguousEntityNames`, a vault-level warning is raised, and relation targets pointing at the duplicated name are reported as ambiguous rather than validated against an arbitrary file. Inverse fixes are also skipped for ambiguous targets.
- **`queryOnlyLocked = false` now works.** The locked-only default was encoded in two places: as a hardcoded initial value in `extractOptions` and as a conditional `include: locked` appended in `renderQueryBlock`. The `renderQueryBlock` append was the only path that checked the setting, but `extractOptions` re-defaulted to `locked` anyway. The default is now passed through as `RunQueryOptions.defaultInclude`; `extractOptions` takes it as a parameter and there is one authoritative location.
- **Incremental file events can no longer clobber a newer full rebuild.** All operations that assign `this.index` (rebuild, upsert, delete, rename) are run through a serialized task queue (`Plugin.enqueue`), so a slow incremental upsert that resolves after a full rebuild no longer overwrites the newer graph.
- **Automatic inverse writes are suppressed until after the first cold rebuild.** The hydrated startup cache may not reflect the current vault. Previously, a `metadataCache.changed` event arriving during workspace load could trigger auto-inverse writes against stale cached state. The `indexReady` flag prevents auto-fixes from running until `onLayoutReady` → `rebuildIndex` completes.
- **Stale-settings cache is discarded on load.** A cache built with different ignore rules, type folder, or schema path describes a different graph; hydrating it was misleading. The startup loader now compares cached index settings to current plugin settings and falls back to a cold rebuild on mismatch.

### Improvements

- Added a schema diagnostics modal for type/interface/relation authoring issues, with schema summary counts and circular type visibility.
- Scaffolding is now review-first. Manual scaffolding and auto-scaffold detection both open a modal of missing fields before writing selected frontmatter keys.
- Interface and inheritance composition now detects conflicting duplicate frontmatter contracts while allowing compatible optional-to-required promotion of the same global field.
- Added global field definitions with property `uses` and `frontmatter-key` aliases, so universal fields can be shared across interfaces while local same-key fields remain distinct.
- Query result tables include a result count footer.
- Ambiguous entity names produce an informative validation warning that lists all conflicting paths.
- `styles.css` is now emitted by `npm run build` alongside `main.js`.
- Validation threshold setting rejects zero and negative values.
- Auto-update inverse setting description clarified.
