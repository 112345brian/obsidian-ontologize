---
lock: true
must-have:
  full-name: string
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
