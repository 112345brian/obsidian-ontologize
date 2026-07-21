# Cutting a release

[towncrier](https://towncrier.readthedocs.io/) compiles pending changelog fragments into `CHANGELOG.md`, and [release-it](https://github.com/release-it/release-it) bumps the version, commits, and tags — configured in `towncrier.toml` and the `"release-it"` block of [`package.json`](../package.json). A local hook (`scripts/sync-obsidian-manifest.ts`) syncs the new version into `manifest.json` and `versions.json`, since Obsidian reads the plugin version from `manifest.json`, not `package.json`.

Towncrier is a Python CLI tool — it's a **dev-only** dependency, not something the plugin depends on at runtime (the shipped plugin is pure JS/TS, bundled into `main.js`). Install it once with:

```bash
pipx install towncrier
```

(`pip install towncrier` also works if you don't use `pipx`, but `pipx` keeps it in its own isolated environment.)

## Day to day: writing a changelog fragment

Whenever you make a change worth mentioning in the changelog, add one small file to `changelog.d/` in the same commit as the change itself — don't wait until release time to remember what you did.

```
changelog.d/<short-slug>.<type>.md
```

- `<short-slug>` — a few words, hyphenated, describing the change.
- `<type>` — one of `feature`, `fix`, `improvement`, `performance`, `architecture`, `infrastructure`. See [`changelog.d/README.md`](../changelog.d/README.md) for what each means, and `towncrier.toml` for the config.

The file's contents are one or two plain-English sentences in this project's existing `CHANGELOG.md` voice: a bold lead phrase naming the change, then an explanation — **no leading `- ` bullet**, towncrier adds that. Say what changed, not why — the why belongs in the commit message.

**Example** — you just fixed a warning firing too often:

```
$ cat changelog.d/lock-warning-scope.fix.md
**Locked-type warning no longer fires on unrelated edits.** Saving a locked type file used to show the "use the type editor" notice on every save, even when only body prose or non-schema frontmatter changed. The notice now only appears when the type's actual schema fields changed.
```

Commit the fragment alongside your code change. It sits in `changelog.d/` until the next release compiles it in.

## Cutting a release

```bash
# 1. Preview what the changelog entry would look like (no files touched).
towncrier build --draft --version <next-version>

# 2. Bump the version, compile the changelog, sync manifest.json/versions.json,
#    commit, and tag — release-it prompts for patch/minor/major interactively,
#    or pass it directly: npm run bump -- patch
npm run bump

# 3. Push the commit and the new tag.
git push origin main --tags
```

`npm run bump` runs the project's full `npm run check` (lint, typecheck, test, build) before doing anything else, via the `before:init` hook — the release aborts if that fails.

### Preview before you commit to anything

```bash
towncrier build --draft --version <next-version>   # what the changelog entry will look like
npm run bump -- --dry-run                           # what release-it would do, without doing it
```

Both are genuinely safe — release-it's `--dry-run` only *prints* hook commands (including the towncrier build step) rather than running them, since towncrier is invoked as a plain shell hook rather than a release-it plugin. This was a deliberate choice: an earlier attempt using the `news-fragments` release-it plugin turned out to ignore `--dry-run` and mutate files for real (see [gbtech-oss/news-fragments#953](https://github.com/gbtech-oss/news-fragments/issues/953)) — invoking towncrier via `hooks.after:bump` avoids that class of bug entirely, since release-it's own dry-run gating covers hook commands correctly.

## If something looks wrong

- **A fragment doesn't show up in the draft build** — the filename must contain `.{type}` where `{type}` matches one of the six `directory` values configured in `towncrier.toml`'s `[[tool.towncrier.type]]` entries; a typo'd type is silently skipped (or errors on `towncrier check`, if that's ever added to CI).
- **`towncrier: command not found`** — install it with `pipx install towncrier` (see above); it's not an npm dependency, so `npm install` alone won't provide it.
- **`git.requireCleanWorkingDir` aborts the release** — release-it refuses to run on a dirty tree. Commit or stash first; this is an intentional safety net, not a bug.
- **`manifest.json`/`versions.json` didn't update** — `scripts/sync-obsidian-manifest.ts` runs as part of the `after:bump` hook and reads the already-bumped `package.json`; if it silently didn't run, check the hook output with `npm run bump -- --verbose`.
