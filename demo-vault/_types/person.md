---
lock: true
must-have:
  full_name: string
can-have:
  birth_year:
    type: number
    cardinality: one
  date-start:
    uses: date-start
relations:
  - observed
  - has_companion
---
