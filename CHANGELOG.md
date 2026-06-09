# CHANGELOG

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

- Query result tables include a result count footer.
- Ambiguous entity names produce an informative validation warning that lists all conflicting paths.
- `styles.css` is now emitted by `npm run build` alongside `main.js`.
- Validation threshold setting rejects zero and negative values.
- Auto-update inverse setting description clarified.
