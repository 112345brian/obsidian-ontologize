# Ontologize Demo Vault

This is a small example vault for testing the plugin.
It demonstrates:

- A configurable type folder using `_types`.
- Global field definitions in `_types/_fields.md`.
- Global relation definitions in `_types/_relations.md`.
- Interfaces with `observable` and `pet`.
- Inheritance with `animal -> mammal -> dog/cat`.
- A nominal type with `conservation-status`.
- Entity notes that use `is-instance`, `lock`, properties, and relations.
- One intentionally missing inverse relation for the issue modal.

To try it, open `demo-vault` as an Obsidian vault, install or copy the plugin into `.obsidian/plugins/obsidian-ontologize`, then run `Ontologize: Open ontology issues`.
