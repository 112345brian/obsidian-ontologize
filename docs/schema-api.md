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

The type folder is configurable.
Any Markdown file inside that folder is treated as a schema constructor file instead of an entity note.

## Schema Sources

### Single Schema File

The single schema file supports three top-level maps:

| Key | Meaning |
|---|---|
| `relations` | Global relation definitions reusable by interfaces and types. |
| `interfaces` | Reusable composition contracts. These are automatically treated as `interface: true`. |
| `types` | Concrete or abstract type definitions. |

Example:

```yaml
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

# Philosopher
```

Body form:

```markdown
# Philosopher
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
| `relations` | array or map | Relation contracts available to matching entities. |
| `lock` | boolean | Type/interface lock intent. |
| `type` | string | Constructor kind, such as `nominal`, `interface`, or `relation-definitions`. |
| `values` | array | Allowed values for `type: nominal`. |

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

Recognized property definition fields:

| Field | Meaning |
|---|---|
| `type` | Scalar type, nominal type, or linked ontology type. |
| `cardinality` | Currently validates `one` and `one-to-one` as single-value constraints. |
| `values` | Inline nominal allowed values. |

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
