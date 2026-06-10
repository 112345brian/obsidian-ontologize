# Schema API Reference

This document describes the schema surface the plugin currently detects.
The schema can be authored in either source style:

- A single configured JSON/YAML schema file.
- Modular Markdown constructor files in the configured type folder.

Both styles compile to the same internal ontology graph.

## Settings

The relevant settings are:

| Setting | Default | Purpose |
|---|---|---|
| Type folder | `_types` | Vault-relative folder containing modular Markdown type/interface files. |
| Schema file | `_types/ontology.schema.yaml` | Optional vault-relative JSON/YAML schema file. Leave empty to use only modular files. |
| Entity type fields | `instance_of`, `type` | Ordered frontmatter fields used to read ontology membership from entity notes. |
| Auto-scaffold entities | off | Open a review modal for missing inherited property and relation fields when a note's ontology membership changes. |

The type folder is configurable.
Any Markdown file inside that folder is treated as a schema constructor file instead of an entity note.

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
    frontmatter-key: birth_year

relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced

interfaces:
  Influenceable:
    relations:
      - influenced_by

types:
  Person:
    lock: true
  Philosopher:
    extends:
      - [[Person]]
    implements:
      - [[Influenceable]]
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
  - [[Person]]
implements:
  - [[Influenceable]]
lock: true
---
```

Body form:

```markdown
extends:
  - [[Person]]
implements:
  - [[Influenceable]]
lock: true
```

## Entity Detection

Entity notes are Markdown files outside the configured type folder.
The plugin indexes an entity note only when its frontmatter contains one of the configured entity type fields.
By default, those fields are `instance_of` and `type`.
The first configured field with a non-empty value wins.

| Field | Meaning |
|---|---|
| `instance_of` | Default direct type field. |
| `type` | Default alias for `instance_of` on entity notes. |
| custom fields | Any configured field, such as `ontology`, `kind`, or `class`. |

Values can be a string, wikilink, or array.

```yaml
---
instance_of:
  - [[Philosopher]]
lock: true
influenced_by:
  - [[Descartes]]
---
```

Custom field example:

```yaml
---
ontology:
  - [[Philosopher]]
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

The query language still uses `type:` and `instance_of:` as semantic type predicates.
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

When a type composes multiple parents or interfaces, duplicate frontmatter keys must refer to the same semantic field.
Use global `fields` plus property `uses` when a key means the same thing everywhere.
Local fields from different interfaces are treated as different semantic fields even if their definitions look identical, so composing them under the same frontmatter key is a schema error.
Different `type`, `cardinality`, `frontmatter-key`, or `possible-values` constraints for the same global field are schema errors.
Combining `cannot-have` with `must-have` or `can-have` for the same key is also a schema error.

Minimum concrete type:

```yaml
lock: true
```

Minimum useful subtype:

```yaml
extends:
  - [[Person]]
lock: true
```

Minimum interface:

```yaml
interface: true
lock: true
relations:
  - influenced_by
```

## Property Definitions

Properties are declared under `must-have` or `can-have`.

Shorthand:

```yaml
must-have:
  birth-date: date
  school: [[SchoolOfThought]]
```

Expanded form:

```yaml
must-have:
  birth-date:
    type: date
    cardinality: one
  school:
    type: [[SchoolOfThought]]
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
    frontmatter-key: birth_year
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
| `type` | Scalar type, nominal type, or linked ontology type. |
| `cardinality` | Currently validates `one` and `one-to-one` as single-value constraints. |
| `possible-values` | Inline allowed values for this property. |

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

## Relation Definitions

Relations can be defined globally, locally on interfaces, or locally on types.

Global relation:

```yaml
relations:
  influenced_by:
    value-type: wikilink
    range: [[Person]]
    inverse: influenced
    auto-update: true
```

Interface usage by shorthand:

```yaml
relations:
  - influenced_by
```

Explicit usage with override:

```yaml
relations:
  influenced_by:
    uses: influenced_by
    range: [[Philosopher]]
```

Recognized relation fields:

| Field | Meaning |
|---|---|
| `uses` | Name of a global relation definition to merge with. |
| `value-type`, `type`, or `value` | Scalar value type. `value-type` is preferred for relations. |
| `range` | Required target type/interface for linked entity targets. |
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
- Present `cannot-have` properties.
- Cardinality violations for `one` and `one-to-one`.
- Scalar value type mismatches.
- Nominal value mismatches.
- Unknown relation targets.
- Ambiguous relation targets when multiple entity notes share a basename.
- Relation targets outside declared `range`.
- Asserted and negated relation conflicts.
- Missing inverse or symmetric relation entries.

Manual inverse fixes are reviewed in a modal before frontmatter is written.

## Scaffolding

The `Scaffold active ontology note` command and the optional `Auto-scaffold entities` setting use the same scaffolder.
The scaffolder adds missing inherited `must-have`, `can-have`, and relation fields with `null` values.
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
