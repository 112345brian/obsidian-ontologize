# Changelog fragments

One file per change, added in the same commit as the change itself, compiled
into `CHANGELOG.md` by [towncrier](https://towncrier.readthedocs.io/) as part
of `npm run bump` (configured in [`towncrier.toml`](../towncrier.toml)).

**Filename**: `<short-slug>.<type>.md` — `<type>` is one of:

- `feature` — new capability
- `fix` — bug fix
- `improvement` — a change to existing behavior that isn't a new feature or a bug fix
- `performance` — a change made specifically for speed/memory
- `architecture` — internal restructuring with no direct user-facing behavior change, but worth a changelog line (e.g. a parsing model change that affects how future features are built)
- `infrastructure` — build, tooling, CI, dependency, or release-process changes

You can also use `towncrier create <slug>.<type>.md` to scaffold one.

**Content**: a bold lead phrase naming the change, then plain-English
explanation — same voice as existing `CHANGELOG.md` entries. No leading `- `
bullet marker; towncrier adds it. Lead with what changed, not why (the why
belongs in the commit message).

Example: `changelog.d/lock-warning-scope.fix.md`
```
**Locked-type warning no longer fires on unrelated edits.** Saving a locked type file used to show the "use the type editor" notice on every save, even when only body prose or non-schema frontmatter changed. The notice now only appears when the type's actual schema fields changed.
```

**Preview what the next release's changelog entry will look like** (safe, no files touched):
```
towncrier build --draft --version <next-version>
```

**Release recipe** — see [`docs/releasing.md`](../docs/releasing.md).
