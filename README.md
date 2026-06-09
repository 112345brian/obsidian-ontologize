# Obsidian Ontology

Obsidian Ontology is a local-first Obsidian plugin for ontology-aware Markdown notes.
It keeps ontology data in ordinary Markdown and YAML frontmatter, then adds inheritance-aware indexing, validation, inverse relation maintenance, and inline query rendering.

## Features

- Reads type definitions from `_types/*.md` or a single `_types/ontology.schema.yaml`
- Supports `extends`, `abstract`, `interface`, `implements`, `disjoint`, `must-have`, `can-have`, `cannot-have`, `relations`, `lock`, and nominal `values`
- Resolves inherited and composed type chains for entities with configured ontology membership frontmatter fields
- Computes effective lock state from entity/type lock intent and ancestor locks
- Keeps a hot in-memory ontology graph updated from Obsidian file and metadata events; all graph writes are serialized to prevent stale state from clobbering a newer rebuild
- Suppresses automatic inverse writes until after the first full cold-vault rebuild, preventing frontmatter edits based on a stale startup cache
- Supports Linter-style ignored folders, ignored file path patterns, and ignored frontmatter rules
- Renders inheritance-aware queries in `ontology-query` code blocks with a result count footer
- Writes `.obsidian/ontology-cache.json` after rebuilds; discards cached graphs whose settings differ from current plugin settings
- Validates schema consistency: inheritance, circular types (never locked), unknown types, abstract/interface instantiation, disjoint conflicts, must-have/cannot-have properties, cardinality, relation ranges, nominal values, negation conflicts, and missing inverse/symmetric entries
- Flags duplicate entity basenames and ambiguous relation targets instead of silently resolving to an arbitrary file
- Inverse relation fixing uses the same composition-chain resolution as validation, so the fix always writes the property that the issue reported
- Can automatically repair inverse relations that declare `auto-update: true`
- Provides an issue report modal with severity/autofix filters and file navigation
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
The `Default locked query results` plugin setting changes the default for blocks that omit `include:`; an explicit `include:` in the block always takes precedence.

Supported V1 clauses:

- `type: Person`
- `instance_of: [[Philosopher]]`
- `property: [[Target]]`
- `property: scalar-value`
- `property: EXISTS`
- `property: NOT EXISTS`
- `NOT property: [[Target]]`
- `AND`, `OR`, `NOT`, and parenthesized groups
- `include: locked | incomplete | all`

## Type Files

Types live in the configured type folder, `_types` by default.
Each modular type file may define its schema in frontmatter or in body YAML after the heading.
Use one style per file; frontmatter wins if both are present.

Example:

```markdown
# Philosopher
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
lock: true
must-have:
  school-of-thought: [[SchoolOfThought]]
can-have:
  magnum-opus: [[Work]]
relations:
  influenced:
    range: [[Person]]
    inverse: influenced_by
    auto-update: true
```

Or declare everything in one schema file (`_types/ontology.schema.yaml`):

```yaml
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced
    auto-update: true

interfaces:
  Influenceable:
    relations:
      - influenced_by

types:
  Person:
    lock: true
  Philosopher:
    extends: ["[[Person]]"]
    implements: ["[[Influenceable]]"]
    lock: true
```

## Commands

- `Obsidian Ontology: Rebuild ontology index`
- `Obsidian Ontology: Check ontology consistency`
- `Obsidian Ontology: Check active ontology note`
- `Obsidian Ontology: Open ontology issues`
- `Obsidian Ontology: Scaffold active ontology note`
- `Obsidian Ontology: Fix missing inverse relations`

## Settings

| Setting | Default | Description |
|---|---|---|
| Type folder | `_types` | Folder containing type definition files |
| Schema file | `_types/ontology.schema.yaml` | Optional single-file schema |
| Entity type fields | `instance_of`, `type` | Frontmatter fields used to read entity ontology membership |
| Cache path | `.obsidian/ontology-cache.json` | Derived-state cache |
| Default locked query results | on | Query blocks default to locked-only results |
| Auto-update inverse relations | off | Write missing inverses after rebuilds for `auto-update: true` relations |
| Validation threshold | 100 | Entity count where validation is treated as urgent |
| Ignored folders | — | Vault-relative folder prefixes excluded from indexing |
| Ignored file patterns | — | JavaScript regexes matched against vault-relative paths |
| Frontmatter ignore list | — | `key` or `key: value` matchers; matching notes are excluded |

## Development

```bash
npm install
npm run build      # emits main.js and styles.css
npx tsc --noEmit   # type-check
npm test           # unit tests
```

## Docs

- [`docs/spec.md`](docs/spec.md) — product and system specification
- [`docs/schema-api.md`](docs/schema-api.md) — field-by-field schema authoring reference
- [`docs/architecture.md`](docs/architecture.md) — V1 implementation architecture notes
