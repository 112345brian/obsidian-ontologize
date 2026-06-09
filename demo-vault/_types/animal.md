---
lock: true
implements:
  - [[observable]]
must-have:
  common_name: string
can-have:
  habitat: string
  descriptor:
    type: string
    possible-values:
      - happy
      - sad
      - weird
  paws:
    type: number
    cardinality: one
  conservation_status: [[conservation-status]]
---
