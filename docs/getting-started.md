# Getting started

> This document is a stub. Version 0.0.1 is a scaffold; the full CLI
> pipeline is not yet wired end-to-end. The reference implementation
> lives in `kinetiq-business/scripts/docs/` and will migrate here in
> subsequent releases.

## Install

```bash
npm install --save-dev @kinetiq-core/blueprint
```

## Configure

Create `blueprint.config.json` at the root of your repo:

```json
{
  "sources": [
    {
      "id": "engine",
      "label": "Engineering specs",
      "root": "../your-other-repo"
    }
  ],
  "paths": {
    "mirror": "docs/specs-mirror",
    "generated": "docs/generated",
    "output": "docs_public"
  }
}
```

`sources[].root` paths are resolved relative to your repo root — so
`../your-other-repo` works when sibling repos are checked out side-by-side.

The `paths` object is optional; defaults shown above.

## Run

```bash
# Pull latest spec files from all configured sources into the mirror
blueprint collect

# Parse the mirror and emit tracking JSON + CSVs
blueprint aggregate

# Build the rendered HTML site
blueprint generate

# Do all three in sequence
blueprint refresh
```

Add to your `package.json`:

```json
{
  "scripts": {
    "specs:refresh": "blueprint refresh",
    "specs:serve": "npx serve docs_public -p 4000"
  }
}
```

## Spec format

See [`schema.md`](schema.md) for the frontmatter fields and table shapes
Blueprint expects.

## Methodology

See [`methodology.md`](methodology.md) for the thinking this tool
implements — the three-layer stack (Strategy / Specs / Code), the living-
document lifecycle, and where Blueprint sits in the lineage of ADRs, RFCs,
and Shape Up.
