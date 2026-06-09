---
lock: true
implements:
  - [[observable]]
must-have:
  common_name: string
can-have:
  habitat: string
  paws:
    type: number
    cardinality: one
  conservation_status: [[conservation-status]]
---
