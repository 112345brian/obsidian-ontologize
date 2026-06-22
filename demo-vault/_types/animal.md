---
ontologize: true
lock: true
implements:
  - "[[observable]]"
must-have:
  common-name:
    uses: common-name
can-have:
  habitat: string
  descriptor:
    uses: descriptor
  paws:
    type: number
    cardinality: one
  conservation-status: "[[conservation-status]]"
---
