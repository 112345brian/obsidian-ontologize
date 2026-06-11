---
type: relation-definitions
relations:
  observed-by:
    value-type: wikilink
    range: "[[person]]"
    inverse: observed
    auto-update: true
  observed:
    value-type: wikilink
    range: "[[animal]]"
    inverse: observed-by
    auto-update: true
  companion-of:
    value-type: wikilink
    range: "[[person]]"
    inverse: has-companion
  has-companion:
    value-type: wikilink
    range: "[[animal]]"
    inverse: companion-of
---
