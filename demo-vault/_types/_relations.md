---
type: relation-definitions
relations:
  observed_by:
    value-type: wikilink
    range: [[person]]
    inverse: observed
    auto-update: true
  observed:
    value-type: wikilink
    range: [[animal]]
    inverse: observed_by
    auto-update: true
  companion_of:
    value-type: wikilink
    range: [[person]]
    inverse: has_companion
  has_companion:
    value-type: wikilink
    range: [[animal]]
    inverse: companion_of
---
