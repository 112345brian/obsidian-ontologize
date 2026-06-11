# Ontological Markdown — System Specification

## Overview

Ontological Markdown is a local-first, plaintext knowledge system that combines Markdown's durability with ontology-aware querying, inheritance, and structured relationships. All knowledge exists as ordinary Markdown files. The ontology layer is additive rather than foundational.

No proprietary database. No cloud dependency. No vendor lock-in.

### Core Value Proposition

The fundamental problem this solves: **you should not have to repeat yourself**.

If you declare a note as `instance_of: [[Friend]]`, you should never also have to tag it `people`, `friends-and-family`, or any other parent type. The system resolves the full inheritance chain automatically. Querying `type: Person` returns your friend. You said it once.
`instance_of` is the default membership field; vaults can configure different frontmatter fields for ontology membership.

Everything else in this system — validation, relations, queries, migrations — exists to make that inheritance trustworthy at scale. The consistency checker exists not as an end in itself but so that when you query "philosophers who didn't influence Nietzsche who were women" you can trust the answer.

### Day-to-Day Goals

1. **Declare a type once** — never manually maintain what that implies
2. **Auto-scaffold new notes** — setting the configured ontology membership field to `[[Philosopher]]` can fill in the right fields automatically
3. **Auto-maintain relations** — writing `influenced: [[Leibniz]]` on Spinoza's page writes `influenced_by: [[Spinoza]]` on Leibniz's page automatically
4. **Query correctly** — inheritance-aware queries that return the right answer without manual tagging

---

## File Structure

```
vault/
  _types/         # Default configurable type folder
    ontology.schema.yaml  # Optional single-file schema
  _queries/       # Saved queries (first-class entities)
  _migrations/    # Migration history and audit trail
  *.md            # Entity files (regular notes)
```

### V1 Priority

The minimum useful system is:

1. `_types/` folder and/or single schema file with inheritance, interfaces, relations, and property schemas
2. Inheritance resolver (the core engine)
3. Auto-updating inverse relations
4. Built-in scaffolding for newly typed notes
5. Consistency checker

Saved queries, migrations, and the full query language are depth features built on top.

---

## Types

Types are Markdown files in the configured type folder, `_types` by default.
They define inheritance, properties, relations, and constraints.
Alternatively, the same constructors can be declared in one JSON or YAML schema file configured in plugin settings.
See [`schema-api.md`](schema-api.md) for the complete field reference.

### Modular Type File Format

A modular constructor file may define schema in YAML frontmatter or in YAML body text after an optional heading.
Use one style per file.
If frontmatter exists, it is the schema definition and body YAML is ignored.

Frontmatter style:

```markdown
---
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
lock: true
---
```

Body style:

```markdown
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
lock: true
```

### Single Schema File

The optional schema file is a vault-relative JSON or YAML file.
It compiles into the same internal graph as modular `_types/*.md` constructor files.

```yaml
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced
    auto-update: true

interfaces:
  Influenceable:
    lock: true
    relations:
      - influenced_by

types:
  Person:
    lock: true

  Philosopher:
    lock: true
    extends:
      - [[Person]]
    implements:
      - [[Influenceable]]
```

The modular equivalent is:

- `_types/_relations.md`
- `_types/Influenceable.md`
- `_types/Person.md`
- `_types/Philosopher.md`

Both approaches may be used together.
If names collide, the later-loaded modular type file overrides the single schema constructor with the same name.

### Composition And Interfaces

Inheritance is for identity hierarchies.
Composition is for reusable capabilities.

Interfaces are type files that define reusable property and relation contracts but cannot be directly instantiated:

```markdown
# Influenceable
interface: true
relations:
  - influenced_by
```

Concrete types opt into those contracts:

```markdown
# Philosopher
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
```

An instance of `Philosopher` is treated as a `Person` through inheritance and as `Influenceable` through composition.
Queries such as `type: Influenceable` include philosophers that implement that interface.
Validation flattens both `extends` and `implements`.

When multiple inherited or implemented contracts define the same frontmatter key, the composed schema follows these rules:

- Shared universal fields must be declared in a global `fields` registry and referenced with `uses`.
- Local fields from different interfaces are different semantic fields, so they cannot silently share one frontmatter key.
- A compatible `can-have` use of the same global field can be promoted to `must-have`.
- Incompatible definitions for the same semantic field are schema errors.
- `cannot-have` combined with `must-have` or `can-have` for the same key is a schema error.

```yaml
type: field-definitions
fields:
  birth-year:
    type: number
    cardinality: one
    frontmatter-key: birth_year
```

```yaml
must-have:
  birth-year:
    uses: birth-year
```

### Inheritance

```markdown
# Philosopher
extends:
  - [[Person]]
```

Multiple inheritance is supported:

```markdown
# Singer-Songwriter
extends:
  - [[Singer]]
  - [[Composer]]
```

### Abstract Types

Types that cannot be directly instantiated — only subtyped:

```markdown
# Entity
abstract: true
```

### Disjoint Types

Declaring that two types are mutually exclusive — no entity can be both:

```markdown
# Philosopher
disjoint:
  - [[Musician]]
```

---

## Entities

Regular Markdown notes. All ontology data is stored in **YAML frontmatter** — standard Obsidian frontmatter, compatible with every other plugin that reads it.
An entity enters the ontology when it has one of the configured ontology membership fields.
The default fields are `instance_of` and `type`, checked in that order.

```markdown
---
instance_of: "[[Rationalist]]"
wrote:
  - "[[Ethics]]"
influenced_by:
  - "[[Descartes]]"
---

# Spinoza
```

`type` is supported as a default shorthand alias for `instance_of`.
The membership field list is configurable in plugin settings, so a vault can use a field such as `ontology`, `kind`, or `class` instead.

---

## Property Schemas

Type files define property constraints for their entities.

```markdown
# Philosopher
extends:
  - [[Person]]

must-have:
  time-period: string
  school-of-thought: [[SchoolOfThought]]

can-have:
  magnum-opus: [[Work]]
  nationality: string

cannot-have:
  tag: string == personal
```

### Property Tiers

- `must-have` — required; entity fails validation without it
- `can-have` — optional; valid if present
- `cannot-have` — forbidden; entity fails validation if present (supports value constraints)

### Property Types

- `string`
- `boolean`
- `number`
- `date`
- `[[TypeName]]` — link to an entity of a given type
- `enum` — see Nominals

### Cardinality

```markdown
must-have:
  birth-date:
    type: date
    cardinality: one
  wrote:
    type: [[Work]]
    cardinality: many
```

### Possible Values

Properties can limit values inline with `possible-values`:

```markdown
can-have:
  descriptor:
    type: string
    possible-values:
      - happy
      - sad
      - weird
```

Use `values` only for `type: nominal` constructors, not ordinary property definitions.

### Required Inserted Values

A required property can declare a value that must be present:

```yaml
must-have:
  up:
    insert: "[[Person]]"
    type:
      - wikilink
      - string
```

`insert` is non-destructive.
Scaffolding creates a missing field, appends to an existing list, or converts an existing scalar to a list while preserving it.
Validation fails if the inserted value is absent.
A `type` array accepts a value when any listed type matches.
Inserted constraints participate in inheritance, interface composition, and global field `uses` resolution.
Two definitions of the same semantic field conflict when they specify different inserted values or different accepted type sets.

### Constraint Inheritance

Subtypes may tighten constraints from parent types. A `can-have` in a parent can be promoted to `must-have` in a subtype. Constraints may not be loosened going down the hierarchy.

---

## Nominals

Named enumerations. Can be defined locally inside a type, or globally as their own type files.

### Local Nominal

```markdown
# Philosopher
must-have:
  school-of-thought:
    type: nominal
    values: [rationalism, empiricism, idealism, stoicism]
```

### Global Nominal

Defined as a type file, reusable across types:

```markdown
# _types/SchoolOfThought.md
type: nominal
values: [rationalism, empiricism, idealism, stoicism]
```

Referenced in type definitions:

```markdown
must-have:
  school-of-thought: [[SchoolOfThought]]
```

Global nominals are themselves entities in the system and can have properties and relations like any other type.

---

## Relations

Relations are defined in type files with domain, range, cardinality, and behavior.
Reusable relation definitions can also be declared globally and then implemented by interfaces or concrete types.

### Global Relation Definitions

Global relation definitions live in a type file marked as a relation registry:

```markdown
# _types/_relations.md
type: relation-definitions
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced
    auto-update: true

  influenced:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced_by
    auto-update: true
```

Interfaces or types can reference those global definitions by name:

```markdown
# Influenceable
interface: true
relations:
  - influenced_by
```

The explicit form can override part of the global definition:

```markdown
relations:
  influenced_by:
    uses: influenced_by
    range: [[Philosopher]]
```

```markdown
# Philosopher
relations:
  wrote:
    range: [[Work]]
    cardinality: one-to-many
    inverse: written-by
    auto-update: true

  influenced:
    range: [[Person]]
    inverse: influenced_by
    auto-update: true

  married-to:
    range: [[Person]]
    cardinality: one-to-one
    symmetric: true
```

### Meta-Relation Properties

- `range` — the type the relation must point to (validated against vault)
- `cardinality` — `one-to-one`, `one-to-many`, `many-to-many`
- `inverse` — a separate reciprocal property implied by this relation
- `symmetric` — same property in both directions (no separate inverse needed)
- `transitive` — if A→B and B→C then A→C is implied
- `auto-update` — whether the system automatically writes the inverse/symmetric relation to the target file on commit

---

## Provenance

Relations can carry source and confidence metadata:

```markdown
influenced_by:
  - target: [[Descartes]]
    source: [[Letter-to-Mersenne-1641]]
    confidence: high
```

---

## Temporal Properties

Facts that are true during a period rather than universally:

```markdown
member-of:
  - target: [[RoyalAcademy]]
    from: 1672
    to: 1676
```

---

## Negation

Explicitly asserting that a relation does not hold, distinct from simply omitting it. Matters for consistency checking in the closed world:

```markdown
influenced_by:
  - NOT [[Descartes]]
```

---

## Query Language

Queries are written inside `ontology-query` code blocks. The plugin registers a custom code block processor that parses the query and renders results inline — the same pattern Dataview uses. This is distinct from YAML frontmatter, which remains plain and valid throughout.

````markdown
```ontology-query
type: Philosopher
AND NOT influenced: [[Nietzsche]]
AND instance_of: [[Woman]]
```
````

Queries operate on the type graph rather than raw property values. Inheritance is resolved automatically — `type: Philosopher` returns Rationalists, Empiricists, and all other subtypes. Only locked entities are returned by default — see Lock States for opt-in behavior.

### Basic Type Query

```
type: Person
```

Returns all entities whose resolved type chain includes `Person`.

### Relation Filter

```
influenced_by: [[Descartes]]
```

### Boolean Operators

`AND`, `OR`, and `NOT` are supported across all query expressions:

```
type: Philosopher AND NOT influenced: [[Nietzsche]]

type: Philosopher OR type: Scientist

type: Person AND NOT instance_of: [[Philosopher]]
```

`NOT` on a relation means the relation is either explicitly negated or absent entirely. `NOT` on a type excludes entities whose resolved type chain includes that type.

### Complex Example

```
type: Philosopher
AND NOT influenced: [[Nietzsche]]
AND instance_of: [[Woman]]
```

### Traversal

```
type: Philosopher WHERE influenced_by.school-of-thought == rationalism
```

Traversal supports `AND`, `OR`, and `NOT` within the `WHERE` clause:

```
type: Philosopher
WHERE influenced_by.school-of-thought == rationalism
AND NOT wrote.title == "Ethics"
```

### Existence Checks

```
type: Person AND birth-date: EXISTS
type: Person AND death-date: NOT EXISTS
```

### Future: Bases Integration

Obsidian Bases may serve as an alternative query surface for simple flat queries that don't require inheritance resolution. This is deferred to a later iteration — the custom query block is the foundation.

---

## Saved Queries

Queries are files in `_queries/` and are first-class entities in the system. Other notes can reference or embed them.

```markdown
# _queries/living-rationalists.md
instance_of: [[Query]]

query: |
  type: Rationalist
  AND birth-date: EXISTS
  AND death-date: NOT EXISTS
```

---

## Consistency Checking

The system operates under the **closed world assumption** — the vault is the complete universe of facts. Consistency checking is a graph traversal against the full vault, not a theorem-proving problem.

Consistency checking is **infrastructure for trustworthy queries**, not an end in itself. The goal is that when you ask "philosophers who didn't influence Nietzsche who were women" you get the right answer — not a partial answer because someone was inconsistently tagged or a relation was only written on one side.

Checks performed:

- Entities missing `must-have` properties
- Entities with `cannot-have` properties (including value constraint violations)
- Relation targets that are the wrong type
- Property values outside a nominal's allowed set
- Entities simultaneously claiming disjoint types
- Inheritance conflicts between parent types
- Cardinality violations
- Negation conflicts (a relation both asserted and negated)
- Inverse relations that are missing or inconsistent (auto-fixable)

---

## Migrations

### Conflict Resolution

When a schema change or instantiation produces a conflict — for example, two parent types defining the same property with different constraints — **the older definition wins**. The newer change is flagged as a violation rather than silently overwriting existing data.

This applies to:
- Multiple inheritance conflicts between parent type definitions
- Schema modifications that contradict an existing entity's frontmatter
- Relation type conflicts across the inheritance chain

### Circularity

Circular inheritance is forbidden and checked at the schema level on every type file save. If introducing an `extends` relation would create a cycle in the type graph, the change is rejected before it is written.

```
A extends B
B extends A  ← rejected: circular inheritance
```

Cycle detection runs as a depth-first search over the type graph. The same check applies to transitive relations — a relation declared `transitive: true` with a circular chain would produce infinite inference and is equally forbidden.

No file in a circular chain can ever be locked, so circularity is a hard error rather than a warning.

### Schema Mode

A vault-wide setting controls how notes without `instance_of` are treated:

```yaml
# _types/_config.md
schema-mode: libertarian  # or: authoritarian
```

- **Libertarian** — notes without `instance_of` are outside the ontology entirely; no enforcement; invisible to schema validation. This is the default.
- **Authoritarian** — notes without `instance_of` fail validation.

Either way, untyped notes are still queryable as raw notes. The mode only affects schema enforcement.

### Lock States

Every file in the vault — both type files and entity files — stores a lock *intent* in frontmatter:

```yaml
lock: true
```

The system computes *effective* lock state at query time based on intent plus the full ancestor chain. No files are rewritten when an ancestor changes — the cascade is computed, not stored.

Effective states:

- **Locked** — `lock: true` and all ancestors are locked; schema enforced; appears in trusted query results
- **Incomplete** — `lock: true` but one or more ancestors are not locked; schema enforcement suspended; excluded from trusted query results by default
- **Unlocked** — `lock: false` or no lock field; no enforcement; excluded from trusted query results by default

Lock state propagates bottom-up. `Rationalist` cannot be effectively locked until `Philosopher` is locked; `Philosopher` cannot be locked until `Person` is locked. The practical workflow is to lock from the root of the hierarchy downward.

Unlocking a type is a destructive operation that cascades downward — all subtypes and their instances become incomplete. This requires the same dry-run confirmation as a schema commit, showing how many entities will be affected.

Queries return only locked entities by default. To include other states:

```
type: Philosopher include: incomplete
type: Philosopher include: all
```

### Commit Workflow

Schema changes are not applied automatically. Editing a type file and running commit triggers a dry run:

```
Dry run for changes to Philosopher.md:

  ✓ 12 entities will have time-period added
  ✓ 8 entities already have school-of-thought
  ⚠ 3 entities cannot be updated — has tag: personal
      - Wittgenstein.md
      - my-private-notes.md
      - journal-2023.md

Proceed? [y/n]
```

The user confirms or aborts before any files are modified.

### Migration History

Applied migrations are recorded in `_migrations/` as Markdown files:

```markdown
# _migrations/2024-03-15-philosopher-schema.md

changed: [[Philosopher]]
date: 2024-03-15

added-must-have:
  - time-period: string

affected: 12
skipped: 3
skipped-reason: cannot-have violation (tag: personal)
```

---

## Indexing

The system maintains a type graph serialized to a JSON cache in `.obsidian/ontology-cache.json`. On startup the cache is loaded directly — no full rebuild unless the cache is missing or corrupted. The cache is updated incrementally on file changes.

### Priority Queue

Index freshness is prioritized by:

```
priority = recency_weight * (1 + downstream_count)
```

- **Recency** — recently modified files are indexed first
- **Downstream count** — type files referenced by many entities are higher priority than leaf nodes; a change to `Person.md` propagates everywhere

The hot portion of the graph (recently active notes, high-reference types) stays fresh. The cold tail updates lazily in the background.

### Adaptive Validation Throttling

Schema validation is throttled during normal operation to avoid blocking the editor. When a type file is modified, the system counts entities registered under the affected class:

- **Above threshold** — validation is run immediately and prioritized
- **Below threshold** — validation is throttled and runs lazily in the background

The threshold is configurable in `_types/_config.md`. This ensures that modifying a root type with thousands of children is treated with appropriate urgency, while editing a leaf type with two instances does not block the user.

---

## Implementation Notes

### Core Library

The indexer, type graph, inheritance resolver, query engine, constraint checker, and migration system are implemented as a standalone TypeScript library with no editor dependency. Editor integrations (VS Code extension, CLI tool, etc.) are thin wrappers around this library.

### Editor Integrations

- **VS Code extension** — query block renderer, commit UI, inline validation
- **CLI** — `ontology query "type: Person"`, `ontology check`, `ontology commit`

### Scaffolding

The system watches metadata changes on entity notes.
When `Auto-scaffold entities` is enabled and a note has completed ontology membership frontmatter, the plugin resolves the full type/interface chain and opens a review modal for missing inherited fields.

Completed membership means the configured entity type field has at least one value and every direct type exists, is instantiable, and is not part of a circular inheritance chain.

Scaffolding can add missing inherited `must-have`, `can-have`, and relation fields with empty values.
For properties declaring `insert`, it previews and applies the required value without overwriting existing values.
The review modal labels each field as required, optional, or relation-backed and writes only the selected fields.

Manual scaffolding is also available through the `Scaffold active ontology note` command.

### Prior Art

The system implements a pragmatic subset of OWL (Web Ontology Language) semantics in readable Markdown syntax. Concepts borrowed from OWL include symmetric/transitive/inverse properties, nominals, cardinality restrictions, disjointness, and consistency checking. Full OWL reasoning (universal restrictions, open-world inference, decidability proofs) is explicitly out of scope.
