---
extends:
  - "[[mammal]]"
implements:
  - "[[pet]]"
lock: true
disjoint:
  - "[[cat]]"
must-have:
  breed: string
can-have:
  trained: boolean
---
