---
extends:
  - "[[person]]"
lock: true
can-have:
  school-of-thought: string
  era: string
relations:
  influenced:
    range: "[[philosopher]]"
    inverse: influenced-by
    auto-update: true
  influenced-by:
    range: "[[philosopher]]"
    inverse: influenced
    auto-update: true
---
