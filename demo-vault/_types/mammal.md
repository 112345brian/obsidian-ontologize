# mammal
extends:
  - [[animal]]
lock: true
must-have:
  gestation_days:
    type: number
    cardinality: one
can-have:
  fur: boolean
