---
type: field-definitions
fields:
  common-name:
    type: string
    frontmatter-key: common_name
  descriptor:
    type: string
    possible-values:
      - happy
      - sad
      - weird
  birth-year:
    type: number
    cardinality: one
    frontmatter-key: birth_year
  date-start:
    type: date
    insert: date.now()
---
