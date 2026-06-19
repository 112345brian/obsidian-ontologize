# CHANGELOG

## 0.3.0

### Features

- **`ingest-from` detection.** Types can declare `ingest-from` as a map of `field: target` pairs. Any entity note whose frontmatter field links to the named target is automatically indexed as that type — no `is-instance` field is written or required. The link to the MOC is the type declaration. Detection runs on every incremental update and full rebuild.
- **`extends` cascade for entity membership.** When the indexer resolves an entity as type X, it now automatically also resolves it as every type in X's `extends` chain. A philosopher entity is also a person entity with no extra configuration. Queries, validation, and scaffolding all see the full resolved membership.
- **`also-apply` field on types.** Lists additional types to co-apply whenever this type is applied. Covers non-hierarchical co-application not expressed through `extends`.
- **Type editor modal reorganised into tabs.** The type editor now has five tabs — Definition, Properties, Constraints, Recognition, Formatting — matching the logical order of type construction. Each tab is focused; unrelated fields do not appear.
- **Two-panel instance preview on Properties and Constraints tabs.** A live frontmatter preview renders alongside the editor on tabs where schema decisions affect what an instance looks like. The preview shows ingest-from triggers as the type declaration, then inherited fields from the full `extends` chain labeled by source type, then own fields, then constraint annotations.
- **"Apply on construction" toggle on `requires` constraints.** A requires rule in the Constraints tab can be toggled to also add the required type to `also-apply`. This links validation (the type must be present) with construction (it is stamped automatically), in a single place.
- **Instance preview reflects ingest-from, not `is-instance`.** The preview no longer shows `is-instance` as a field the user should write. For types with `ingest-from` rules it shows those field-target pairs instead — matching what the entity note actually needs to contain.

### Bug fixes

- **`detectTypeFromIngestFields` normalizes link targets before comparing.** Stored paths such as `archive/philosophers` are now normalized to their basename before comparison against extracted link targets, so ingest-from detection works regardless of whether the target was stored as a full path or a bare name.
- **`revalidateEntityBatch` compares expanded `instanceOf` consistently.** The background sweep now expands the fresh entity's `instanceOf` through the `extends` chain before comparing against the stored entity, preventing spurious stale-count increments caused by the stored entity already having its ancestors expanded.

## Unreleased (rolled into 0.3.0)

### Features

- **Weighted properties and scales.** Any property can declare `weighted: true` to pair it with a companion weight map (e.g. `influenced-by-weight: {Kant: 2, Hume: -1}`). Scale definitions live under `scales:` on a type and describe step labels, aliases, and optional `min`/`max`/`neutral` bounds. A built-in default scale (-2 to 2) applies when no named scale is specified. Alias matching strips prepositions and articles so "strongly influenced by" resolves the same as "strongly". The `WEIGHTED` query token matches entities with at least one non-neutral map entry.
- **`implementable-by` field on types.** Restricts which types may implement an interface, validated at schema composition time.
- **Kebab-case auto-normalization.** All frontmatter keys, property names, relation names, and `inverse` values are silently normalized to kebab-case on read (`influence_weight` → `influence-weight`, `influenceWeight` → `influence-weight`). The schema linter warns on non-kebab identifiers rather than erroring, matching the parser's lenient behavior.
- **`replaces` rules support from/to substitution.** In addition to simple removal (`- "[[OldType]]"`), replacement rules now accept `new-field` and `new-value` to move a value to a different field and/or substitute a new value: `{value: "[[Colleague]]", field: relationship, new-field: connection, new-value: "[[Friend]]"}`. Remove-only rules remain backward-compatible.
- **Bulk scaffold modal.** `Scaffold all entities` opens a three-phase modal: select types (with affected entity/field counts), preview per-entity changes, then apply. Running it once enables auto-scaffold going forward; until then the plugin watches for membership changes but does not open per-note review modals automatically.
- **`requires` and `excludes` fields on types.** `requires` warns when a co-required type is absent; `excludes` errors when a forbidden type is present in the same resolved membership.
- **`template` field on types.** Links a Markdown note whose body is injected into a new entity with an empty body when the type is first applied. Templater is used if available; otherwise body text is copied verbatim.
- **Type editor unifies requires, excludes, and replaces into a single rules list.** The structured type editor now manages all three as a single ordered list of rules with a kind selector (`requires` / `excludes` / `replaces`). Field-scoped and from/to replacement rules are fully editable; they were previously dropped silently on save.
- **User scripting system.** Set a scripts folder in settings (e.g. `_ontologize/scripts`) and drop `.js` files there. Each file is executed at startup with `ontologize` injected as a global, giving access to the live index, query runner, issue injection, `updateFrontmatter`, and lifecycle hooks (`index:ready`, `entity:save`, `entity:validate`). Scripts reload automatically on file changes. UI extension point: `ontologize.ui.registerEntityAction` registers custom panels shown via the "Open script actions for active note" command. See `docs/scripting.md` for full API reference.
- **Type editor modal layout.** The delete button on field and relation cards is now a small icon in the card header rather than a full-width control inside the input grid. Behavior toggles (Symmetric, Transitive, Auto-update) now show inline text labels instead of tooltip-only unlabeled switches.
- **Impact modal clarity.** The "Resolved issues" section now includes a description clarifying that these are pre-existing problems the change fixes, not new problems it introduces. The "Ignore affected" button no longer appears when there are no soft-breaking changes.

### Bug fixes

- **`replaces` now executes.** A `.size` check on an array (which has no `.size` property) silently prevented `removeTypeMemberships` from ever being called. Fixed to `.length`.
- **Template application no longer drops `replaces` entries from subsequent types.** An early `break` after finding the first template caused the loop to exit before collecting `replaces` entries from any additional added types.
- **Relation validation correctly matches normalized frontmatter keys.** Relation names and `inverse` values are now normalized at parse time, so validation lookups against entity frontmatter (which is also normalized) always find the right key.
- **`new-value` in replacement rules no longer silently drops types named `"0"`.** The parser used `normalizeLinkTarget(value) || undefined`, which treated the falsy string `"0"` as absent. Fixed to an explicit empty-string check.

## 0.2.0

Audit-driven correctness, performance, and infrastructure release. Also rolls up the unreleased post-0.1.0 features: schema diagnostics modal, review-first scaffolding, schema composition conflict detection, global field definitions with `frontmatter-key` aliases, `possible-values` constraints, configurable entity type fields, and the demo vault.

### Bug fixes

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

- **Types can be created and modified through a structured modal.** Command-palette actions now edit inheritance, interfaces, fields, inserts, type unions, value constraints, and relations without requiring users to manipulate YAML directly.
- **Property and relation types support `|` unions.** Expressions such as `type: wikilink | string`, `value-type: wikilink | string`, and `range: Person | Organization` now normalize and validate as strict alternatives, while malformed unions are reported by the schema linter.
- **Frontmatter schema identifiers now follow kebab-case.** The default membership field is `is-instance`, bundled examples use hyphenated property and relation names, and the internal schema linter warns about non-kebab property names, relation names, inverse names, and aliases.
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
