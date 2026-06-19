# Schema API Reference

This document describes the schema surface the plugin currently detects.
The schema can be authored in either source style:

- A single configured JSON/YAML schema file.
- Modular Markdown constructor files in the configured type folder.

Both styles compile to the same internal ontology graph.

## Schema Linting

The plugin internally lints every modular type file and the configured single schema file.
Linting runs during full index builds and whenever a schema file changes.
Use `Ontologize: Lint ontology schema` to rebuild and open the current report, or open `Schema diagnostics` from plugin settings.

The linter currently reports:

- Malformed YAML or JSON.
- Missing closing YAML frontmatter delimiters.
- Non-map schema/type roots.
- Unknown schema, type, property, and relation fields.
- Invalid `must-have`, `can-have`, `fields`, and `relations` shapes.
- A non-string strict `type`.
- Non-string entries in `included-types`, `excluded-types`, or `possible-values`.
- Unknown function-like `insert` templates.
- Nested arrays caused by unquoted wiki links in YAML.

Errors prevent the malformed constructor or single schema file from entering the ontology graph.
Warnings, such as unknown keys, remain visible but do not block otherwise valid constructors.
Lint findings appear in Schema Diagnostics and the general ontology issue report.

Always quote wiki links in YAML: use `"[[Person]]"`, not bare `[[Person]]`.
Bare wiki-link syntax is interpreted by YAML as a nested sequence rather than a string.

## Settings

The relevant settings are:

| Setting | Default | Purpose |
|---|---|---|
| Type folder | `_types` | Vault-relative folder containing modular Markdown type/interface files. |
| Schema file | `_types/ontology.schema.yaml` | Optional vault-relative JSON/YAML schema file. Leave empty to use only modular files. |
| Entity type fields | `is-instance`, `type` | Ordered frontmatter fields used to read ontology membership from entity notes. |
| Auto-scaffold entities | off | Open a review modal for missing inherited property and relation fields when a note's ontology membership changes. |

The type folder is configurable.
Any Markdown file inside that folder is treated as a schema constructor file instead of an entity note.
Frontmatter property and relation identifiers must use kebab-case.
Use names such as `is-instance`, `birth-year`, and `influenced-by`.
The rules are:

- **Hyphens only** — no underscores, no dots, no camelCase.
- **Lowercase only** — no uppercase letters.
- **No dots** — dots are conceptually reserved as a subfield separator, but subfields are expressed through YAML nesting, not dot-notation keys. A key containing a dot is always a mistake.

The plugin auto-normalizes malformed keys on read — dots, underscores, and camelCase segments are all converted to kebab-case silently. `influence.weight`, `influence_weight`, and `influenceWeight` all become `influence-weight` when parsed. For entity files with malformed keys, the diagnostics panel offers a one-click fix to rewrite the frontmatter in place.

The command palette includes `Create ontology type` and `Edit active ontology type`.
The structured editor manages type/interface flags, inheritance, implemented interfaces, required and optional fields, unions, inserts, aliases, value constraints, and relation behavior without requiring direct YAML editing.
Editing preserves schema keys outside the editor's ownership.

## Schema Sources

### Single Schema File

The single schema file supports four top-level maps:

| Key | Meaning |
|---|---|
| `fields` | Global field definitions reusable by interfaces and types. |
| `relations` | Global relation definitions reusable by interfaces and types. |
| `interfaces` | Reusable composition contracts. These are automatically treated as `interface: true`. |
| `types` | Concrete or abstract type definitions. |

Example:

```yaml
fields:
  birth-year:
    type: number
    cardinality: one
    frontmatter-key: birth-year

relations:
  influenced-by:
    value-type: wikilink
    range: "[[Person]]"
    inverse: influenced

interfaces:
  Influenceable:
    relations:
      - influenced-by

types:
  Person:
    lock: true
  Philosopher:
    extends:
      - "[[Person]]"
    implements:
      - "[[Influenceable]]"
    lock: true
```

### Modular Constructor Files

Modular constructor files are Markdown files in the configured type folder.
The note basename is the constructor name.

Type definitions can be written in exactly one of two places:

- YAML frontmatter.
- YAML body text after an optional `# Heading`.

If frontmatter exists, the frontmatter is the schema definition and body YAML is ignored.
If no frontmatter exists, the parser uses the body text.

Frontmatter form:

```markdown
---
extends:
  - "[[Person]]"
implements:
  - "[[Influenceable]]"
lock: true
---
```

Body form:

```markdown
extends:
  - "[[Person]]"
implements:
  - "[[Influenceable]]"
lock: true
```

## Entity Detection

Entity notes are Markdown files outside the configured type folder.
The plugin indexes an entity note only when its frontmatter contains one of the configured entity type fields.
By default, those fields are `is-instance` and `type`.
The first configured field with a non-empty value wins.

| Field | Meaning |
|---|---|
| `is-instance` | Default direct type field. |
| `type` | Default alias for `is-instance` on entity notes. |
| custom fields | Any configured field, such as `ontology`, `kind`, or `class`. |

Values can be a string, wikilink, or array.

```yaml
---
is-instance:
  - "[[Philosopher]]"
lock: true
influenced-by:
  - "[[Descartes]]"
---
```

Custom field example:

```yaml
---
ontology:
  - "[[Philosopher]]"
lock: true
---
```

Detected entity fields:

| Field | Required | Meaning |
|---|---:|---|
| configured entity type field | yes | Direct ontology type membership. |
| `lock` | no | When `true`, the entity can enter trusted locked query results if its types are locked. |
| Any schema property | no | Validated when declared in `must-have` or `can-have`. |
| Any schema relation | no | Validated when declared in `relations`. |

The query language still uses `type:` and `is-instance:` as semantic type predicates.
Those query operators are independent of the frontmatter field names configured for entity detection.

## Type Constructor Fields

These fields are recognized in type, interface, and single-schema type definitions:

| Field | Value | Meaning |
|---|---|---|
| `extends` | link or array of links | Identity inheritance. The referenced constructors must exist. |
| `implements` | link or array of links | Composition contracts. Referenced constructors should be `interface: true`. |
| `interface` | boolean | Marks the constructor as an interface that cannot be directly instantiated. |
| `abstract` | boolean | Marks the type as non-instantiable but inheritable. |
| `disjoint` | link or array of links | Types/interfaces that cannot appear in the same resolved chain. |
| `must-have` | map | Required frontmatter properties. |
| `can-have` | map | Optional frontmatter properties that should be validated if present. |
| `cannot-have` | array or map | Forbidden frontmatter keys. |
| `fields` | map | Global field definitions when `type: field-definitions`. |
| `relations` | array or map | Relation contracts available to matching entities. |
| `lock` | boolean | Type/interface lock intent. |
| `type` | string | Constructor kind, such as `nominal`, `interface`, `field-definitions`, or `relation-definitions`. |
| `values` | array | Allowed values for `type: nominal`. |
| `requires` | link or array of links | Types that must also appear in an entity's resolved membership for this type to be valid. |
| `excludes` | link or array of links | Types that must not appear in an entity's resolved membership alongside this type. |
| `replaces` | link, array of links, or replacement rule objects | When this type is applied, matching field values are removed or replaced. |
| `template` | link | A Markdown note to use as a body template when this type is first applied to an entity with an empty body. Templater is invoked if available; otherwise the body text is copied verbatim. |
| `implementable-by` | link or array of links | Interfaces only. Restricts which types (or their subtypes) are allowed to implement this interface. A type that implements an interface outside this list is a schema error. |
| `scales` | map | Named scale definitions for weighted property fields. See [Scales and Weighted Properties](#scales-and-weighted-properties). |
| `ingest-from` | map of `field: target` pairs | Sufficient conditions for type membership. If a note's frontmatter field links to the named target, the note is indexed as this type — no explicit `is-instance` needed. |
| `auto-apply` | condition map | Condition-based type detection. When the conditions match, the type is applied and scaffolded. See [Auto-Apply](#auto-apply). |
| `also-apply` | link or array of links | Additional types to apply whenever this type is applied. Use for non-hierarchical co-application. Types in the `extends` chain are always applied automatically and do not need to be listed here. |

### Requires and Excludes

`requires` declares that this type is only meaningful when another type is also present in the entity's resolved membership.
`excludes` declares that this type cannot coexist with another type.

```yaml
# WorkColleague.md
requires:
  - "[[Person]]"
excludes:
  - "[[Enemy]]"
```

Validation warns when a `requires` type is absent and errors when an `excludes` type is present.

### Replaces

When a type is added to an entity, `replaces` finds an original field/value pair and optionally writes a new field/value pair.
If `new-field` is omitted, the new value is written back to the field where the original was found.
If `new-value` is omitted, the rule only removes the original value.

Simple form (removes from all configured entity type fields):

```yaml
# Enemy.md
replaces:
  - "[[Friend]]"
```

Replace in the same field:

```yaml
# Enemy.md
replaces:
  - value: "[[Friend]]"
    field: relationship
    new-value: "[[Enemy]]"
```

Move the replacement to another field:

```yaml
# Enemy.md
replaces:
  - field: relationship
    value: "[[Friend]]"
    new-field: status
    new-value: "[[Enemy]]"
```

### Template

`template` links a Markdown note whose body is injected into a new entity when this type is first applied and the entity body is empty.

```yaml
# Person.md
template: "[[_templates/Person]]"
```

If the Templater plugin is installed, Templater processes the template against the entity file.
Otherwise the raw body text is copied.
The template is only applied once — if the entity already has body text, it is left untouched.

### Extends and Membership Cascade

When a type is applied to an entity, all types in its `extends` chain are also resolved as part of the entity's membership. A philosopher that extends person is automatically also indexed as a person — you do not need `also-apply` or any explicit declaration on the entity note.

This means:
- Queries for `person` return philosopher entities automatically.
- Validation from `person`'s `must-have` and `can-have` applies to philosopher entities.
- Scaffolding walks the full chain and offers inherited fields from every ancestor.

### Ingest-From

`ingest-from` defines **sufficient conditions** for type membership: when a note's frontmatter field contains a link to the named target, the indexer recognises it as this type without any explicit `is-instance` field on the note.

```yaml
# philosopher.md
extends:
  - "[[person]]"
ingest-from:
  up: Philosophers
```

Any note with `up: [[Philosophers]]` in its frontmatter is indexed as a philosopher. The link to the MOC (map of content) *is* the type declaration. The `up` field is a navigation link that also carries the ontological signal — no separate `is-instance` field is needed or written.

Multiple field-target pairs can be listed. A note matching any one of them is indexed as this type:

```yaml
ingest-from:
  up: Philosophers
  member-of: Philosophers
```

`ingest-from` is the preferred detection mechanism for types whose membership is implied by an existing navigation link. Use it when the field that places a note in a context (its MOC link, its collection, its parent) is also the fact that makes it a member of this type.

### Auto-Apply

`auto-apply` defines conditions evaluated against a note's existing frontmatter. When the conditions match, the type is applied and scaffolded automatically.

```yaml
# philosopher.md
auto-apply:
  match: any
  up: "[[Philosophers]]"
```

`match: any` means the type is applied when at least one condition matches. `match: all` requires all conditions to match simultaneously.

**Ingest-from vs. auto-apply:** the two mechanisms overlap for simple cases but serve different roles.

| | `ingest-from` | `auto-apply` |
|---|---|---|
| When it runs | Index build and incremental updates | Triggered when the plugin detects a membership opportunity |
| Effect | Adds the entity to the index silently | Applies the type and may open a scaffold review |
| Condition form | `field: target-note-name` (substring match on link targets) | Arbitrary frontmatter key/value conditions |
| No `is-instance` written | Yes — detection only, nothing is stamped | No — `is-instance` may be written if scaffolding runs |

In practice: use `ingest-from` when you want silent, always-on detection from a link that already exists for navigation purposes. Use `auto-apply` when you want the plugin to actively offer to stamp and scaffold the type when it sees the right conditions.

You can use both on the same type. `ingest-from` ensures the entity is in the index; `auto-apply` triggers the scaffold workflow when conditions are met.

### Also-Apply

`also-apply` lists additional types that are applied whenever this type is applied. Use it for non-hierarchical co-application — types that should always come together but do not share an `extends` ancestor.

```yaml
# field-researcher.md
also-apply:
  - "[[person]]"
  - "[[academic]]"
```

Types already in the `extends` chain do not need to be listed in `also-apply` — they are applied automatically. `also-apply` is for types that should co-apply for semantic reasons that are not expressed through inheritance.

### Composition Constraints

When a type composes multiple parents or interfaces, duplicate frontmatter keys must refer to the same semantic field.
Use global `fields` plus property `uses` when a key means the same thing everywhere.
Local fields from different interfaces are treated as different semantic fields even if their definitions look identical, so composing them under the same frontmatter key is a schema error.
Different `type`, `cardinality`, `frontmatter-key`, or `possible-values` constraints for the same global field are schema errors.
Different `included-types`, `excluded-types`, or `insert` values for the same global field are also schema errors.
Combining `cannot-have` with `must-have` or `can-have` for the same key is also a schema error.

Minimum concrete type:

```yaml
lock: true
```

Minimum useful subtype:

```yaml
extends:
  - "[[Person]]"
lock: true
```

Minimum interface:

```yaml
interface: true
lock: true
relations:
  - influenced-by
```

## Property Definitions

Properties are declared under `must-have` or `can-have`.

Shorthand:

```yaml
must-have:
  birth-date: date
  school: "[[SchoolOfThought]]"
```

Expanded form:

```yaml
must-have:
  birth-date:
    type: date
    cardinality: one
  school:
    type: "[[SchoolOfThought]]"
```

Possible values:

```yaml
can-have:
  descriptor:
    type: string
    possible-values:
      - happy
      - sad
      - weird
```

Global field registry:

```yaml
type: field-definitions
fields:
  birth-year:
    type: number
    cardinality: one
    frontmatter-key: birth-year
```

Using a global field:

```yaml
must-have:
  birth-year:
    uses: birth-year
```

`frontmatter-key` controls how the field is written and validated in entity notes.
If omitted, the property key itself is used.

Recognized property definition fields:

| Field | Meaning |
|---|---|
| `type` | One strict type or a `|` union. A mismatch against every branch is an error. |
| `included-types` | Preferred types. A value matching none of them produces a warning. |
| `excluded-types` | Forbidden types. A value matching any of them produces an error. |
| `cardinality` | Currently validates `one` and `one-to-one` as single-value constraints. |
| `insert` | Literal required member, or registered template used to initialize an empty field. |
| `possible-values` | Inline allowed values for this property. |
| `scaffold` | `true` on a `can-have` field to include it in scaffold as a pre-checked suggestion. See [Scaffold Behaviour](#scaffold-behaviour). |
| `weighted` | `true` to attach the built-in default weight scale to this field. The companion weight map field is named `{field-key}-weight`. |
| `weight-scale` | Name of a scale defined in a `scales` block. Attaches a named weight scale to this field. The companion weight map field is named after the scale. |

Required inserted member:

```yaml
must-have:
  up:
    insert: "[[Person]]"
    type: wikilink | string
    excluded-types:
      - number
```

If `up` is absent, scaffolding creates it with `[[Person]]`.
If `up` already contains another scalar or list value, scaffolding preserves that value and appends `[[Person]]`.
Validation requires the inserted value to remain present.
`type: wikilink | string` is a strict union: each value must match at least one branch.
`included-types` uses OR semantics: matching any listed type is accepted without an issue.
If none match, validation reports a warning.
`excluded-types` also uses OR semantics, but matching any listed type reports an error.
`insert` is inherited and composed like the rest of the property definition, including when it comes from a global field referenced with `uses`.
When an inserted value is a wiki link, membership compares normalized link targets, so aliases and paths resolving to the same note are treated as the same required member.

### Insert Templates

`insert` can also contain a recognized template expression:

```yaml
must-have:
  date-start:
    insert: date.now()
    type: date
```

Supported templates:

| Expression | Result |
|---|---|
| `date.now()` | Current local date in `YYYY-MM-DD` format. |

Templates are evaluated when the scaffold mutation is applied, not when the schema is parsed or the review modal opens.
A template initializes only a missing, null, empty-string, or empty-list field.
It never overwrites or appends to an already populated field.
Validation treats the generated result as an ordinary property value: `must-have`, `type`, included/excluded types, and possible values still apply, but the stored value is not compared to the template expression itself.
Template expressions come from a fixed registry and are never executed as arbitrary JavaScript.
An unknown function-like expression such as `clock.unknown()` is a lint error rather than a literal value.

Use `values` only on `type: nominal` constructors, not on ordinary property definitions.

Detected scalar types:

| Type | Validation |
|---|---|
| `string` or `text` | Value must be a string. |
| `number` | Value must be a YAML number. |
| `boolean` | Value must be a YAML boolean. |
| `date` | Value must parse as a date string. |
| `wikilink` or `link` | Value must contain an asserted Obsidian link. |
| `[[TypeName]]` | Used for nominal lookup when `TypeName` is a `type: nominal`. |

## Scales and Weighted Properties

Many relationships are not binary — the degree of influence, agreement, or association matters.
Scales let you attach a numeric intensity to any link-valued field and query it by name rather than raw number.

### Declaring a Scale

Scales live in a `scales` block on any type or interface constructor file.
The scale name is also the frontmatter key that holds the companion weight map on entity notes.

```yaml
# influence.md
interface: true
can-have:
  influenced-by:
    type: wikilink
    weight-scale: influence-weight
  influence-weight:
    type: object
scales:
  influence-weight:
    min: -2
    max: 2
    neutral: 0
    steps:
      "2":
        - highly influenced
        - strongly influenced
      "1":
        - influenced
        - somewhat influenced
      "0":
        - neutral
      "-1":
        - somewhat opposed
      "-2":
        - reacted against
        - opposed
```

Scale fields:

| Field | Meaning |
|---|---|
| `min` | Minimum allowed numeric value. Values below this are flagged as errors. |
| `max` | Maximum allowed numeric value. Values above this are flagged as errors. |
| `neutral` | The default / zero-point value. Used by the `WEIGHTED` query operator. Defaults to `0`. |
| `steps` | Map of numeric string keys to lists of human-readable aliases. |
| `normalize` | Custom word-strip list for alias matching. Omit to use the built-in default. |

### Using Weights on Entities

The companion weight map key matches the scale name.
Keys in the map are entity names (matching the corresponding link field); values are integers.

```yaml
# nietzsche.md
influenced-by:
  - "[[kant]]"
  - "[[schopenhauer]]"
influence-weight:
  kant: 2
  schopenhauer: 1
```

### Querying Weights

Weight map fields support four query forms:

```
influence-weight: "highly influenced"    → any entry resolves to step 2
influence-weight: "influenced by"        → same — prepositions are stripped before matching
influence-weight: kant                   → kant is present as a key in the map
influence-weight: WEIGHTED               → at least one entry with value ≠ neutral
influence-weight: 2                      → any entry equals 2 directly
```

When a field declares `weight-scale`, you can also query through the link field itself:

```
influenced-by: "highly influenced"       → checks the companion weight map via the declared scale
```

### Alias Normalization

Aliases are matched after stripping common prepositions (`by`, `from`, `of`, `to`, `with`, `at`, `in`, `on`, `into`, `onto`, `via`, `per`) and articles (`a`, `an`, `the`), and lowercasing.
This means `"influenced by"`, `"influenced"`, and `"Influenced By"` all resolve to the same step without requiring you to list every variant explicitly.

The normalization runs on both the stored aliases and the query input, so neither side needs to be written in any particular form.

A custom strip list can be provided per scale with the `normalize` key, but this is rarely needed — the built-in default handles most natural language variation.

### Default Scale

Any field declaring `weighted: true` without a named `weight-scale` uses the built-in default scale:

| Step | Default aliases |
|---|---|
| `2` | high, strong, strongly, significant |
| `1` | moderate, somewhat, partial |
| `0` | neutral |
| `-1` | low, somewhat against |
| `-2` | strongly against, opposed |

Range: `−2` to `2`, neutral at `0`.

### Validation

Weight map values outside the declared `min`/`max` are flagged as errors.
The neutral value is not validated against the range — it is always permitted.

## Relation Definitions

Relations can be defined globally, locally on interfaces, or locally on types.

Global relation:

```yaml
relations:
  influenced-by:
    value-type: wikilink
    range: "[[Person]]"
    inverse: influenced
    auto-update: true
```

Interface usage by shorthand:

```yaml
relations:
  - influenced-by
```

Explicit usage with override:

```yaml
relations:
  influenced-by:
    uses: influenced-by
    range: "[[Philosopher]]"
```

Recognized relation fields:

| Field | Meaning |
|---|---|
| `uses` | Name of a global relation definition to merge with. |
| `value-type`, `type`, or `value` | Scalar value type or `|` union. `value-type` is preferred for relations. |
| `range` | Required target type/interface or `|` union for linked entity targets. |
| `inverse` | Property that should point back from the target note. |
| `symmetric` | When `true`, the relation is its own inverse. |
| `transitive` | Stored in the model for future traversal behavior. |
| `cardinality` | Currently validates `one` and `one-to-one`. |
| `auto-update` | Allows automatic inverse writes when the plugin setting is also enabled. |

## Validation Scope

The plugin validates:

- Unknown parent types.
- Unknown implemented interfaces.
- Circular inheritance.
- Schema composition conflicts from incompatible duplicate interface/inheritance fields.
- Direct instantiation of abstract types or interfaces.
- Disjoint type conflicts.
- Missing `must-have` properties.
- Missing values required by `insert` constraints.
- Present `cannot-have` properties.
- Cardinality violations for `one` and `one-to-one`.
- Scalar value type mismatches.
- Included type warnings when a value matches none of the listed types.
- Excluded type errors when a value matches any listed type.
- Nominal value mismatches.
- Unknown relation targets.
- Ambiguous relation targets when multiple entity notes share a basename.
- Relation targets outside declared `range`.
- Asserted and negated relation conflicts.
- Missing inverse or symmetric relation entries.

Manual inverse fixes are reviewed in a modal before frontmatter is written.

## Scaffolding

The `Scaffold active ontology note` command and the optional `Auto-scaffold entities` setting use the same scaffolder.
The scaffolder adds missing inherited `must-have`, `can-have`, and relation fields with `null` values unless a property defines `insert`.
For a literal `insert`, it creates the field, appends to an existing list, or converts an existing scalar to a list while preserving it.
For a template `insert`, it evaluates the expression at apply time and initializes only an empty field.
It does not overwrite existing frontmatter values.
Both manual and automatic scaffolding open a review modal first.
The modal lists the missing fields, labels them as required, optional, or relation fields, and writes only the selected fields.

Automatic scaffolding runs only after the initial full-vault index rebuild, and only on a membership transition: the note's resolved direct types changed in that edit.
Ordinary edits to a note with missing fields never reopen the review, and closing the review without applying dismisses that note until its membership changes again.
For an automatic scaffold to run, the note must also have valid ontology membership:

- The configured entity type field has at least one value.
- Every direct type exists.
- No direct type is abstract.
- No direct type is an interface.
- No direct type is in a circular inheritance chain.

### Scaffold Behaviour

`must-have`, `can-have`, and relation fields each have different default behaviour in the scaffold modal and during silent scaffold:

| Source | Modal | Pre-checked | Silent scaffold |
|---|---|---|---|
| `must-have` | shown | yes | yes |
| `can-have` + `scaffold: true` | shown | yes | yes |
| `can-have` (no flag) | shown | no | no |
| relation | shown | yes | yes |

`scaffold: true` on a `can-have` field marks it as a strong suggestion: it appears pre-checked in the review modal and is written silently for types detected via `ingest-from` or `auto-apply: true`. Without the flag, the field appears in the modal unchecked — the user can add it manually but it is never written automatically.

```yaml
# person.md
can-have:
  birth-year:
    uses: birth-year
    scaffold: true    # offered pre-checked; written silently for ingest-from entities
  notes:
    type: string      # shown in modal unchecked; never written silently
```

When a type file is saved and the resulting schema change leaves entities with missing fields, the plugin shows a notification with a **Scaffold now** link that opens the bulk scaffold modal for those entities.
