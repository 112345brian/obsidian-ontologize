---
extends:
  - "[[person]]"
lock: true
can-have:
  relationship:
    type: string
    possible-values:
      - parent
      - child
      - sibling
      - spouse
      - grandparent
      - cousin
      - other
---
