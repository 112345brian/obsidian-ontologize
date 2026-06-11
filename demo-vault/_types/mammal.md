---
extends:
  - "[[animal]]"
lock: true
must-have:
  gestation-days:
    type: number
    cardinality: one
can-have:
  fur: boolean
---
