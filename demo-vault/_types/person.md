---
ontologize: true
lock: true
must-have:
  full-name: string
  up:
    type: wikilink
    cardinality: one
can-have:
  birth-year:
    type: number
    cardinality: one
  date-start:
    uses: date-start
relations:
  - observed
  - has-companion
---
