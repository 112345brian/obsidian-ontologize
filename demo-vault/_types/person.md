# person
lock: true
must-have:
  full_name: string
can-have:
  birth_year:
    type: number
    cardinality: one
relations:
  - observed
  - has_companion
