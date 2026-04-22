# Diagrams

## `architecture.dot`

[Graphviz](https://graphviz.org/) **DOT** source for the udlo-notifier pipeline. No Node.js or npm is required—only the `dot` binary.

**Install Graphviz** (pick one):

- macOS: `brew install graphviz`
- Ubuntu / Debian: `sudo apt install graphviz`

**Render SVG** (from repo root):

```bash
cd docs && dot -Tsvg architecture.dot -o architecture.svg
```

The root [`README.md`](../README.md) embeds `architecture.svg`. Regenerate that file whenever you change `architecture.dot` so the diagram stays in sync.
