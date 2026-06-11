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
Frontmatter property and relation identifiers conventionally use kebab-case.
Use names such as `is-instance`, `birth-year`, and `influenced-by`; the internal schema linter warns about underscore or mixed-case schema identifiers.

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
| `replaces` | link, array of links, or array of `{value, field}` objects | When this type is applied to an entity, the listed membership values are removed from entity type fields. |
| `template` | link | A Markdown note to use as a body template when this type is first applied to an entity with an empty body. Templater is invoked if available; otherwise the body text is copied verbatim. |

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

When a type is added to an entity, `replaces` removes listed values from the entity's type membership fields.
This is useful for hygiene — for example, if `Enemy` replaces `Friend`, applying `Enemy` to a note automatically removes `Friend` from its type list.

Simple form (removes from all configured entity type fields):

```yaml
# Enemy.md
replaces:
  - "[[Friend]]"
```

Field-scoped form (removes only from a specific frontmatter field):

```yaml
# Enemy.md
replaces:
  - value: "[[Friend]]"
    field: relationship
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
