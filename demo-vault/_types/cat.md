# cat
extends:
  - [[mammal]]
implements:
  - [[pet]]
lock: true
disjoint:
  - [[dog]]
can-have:
  indoor: boolean
