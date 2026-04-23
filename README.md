# Blueprint

**Specs are the IP. Code is the throwaway layer.**

Blueprint is a git-native toolchain for spec-driven development. It treats
software specifications as living documents — the durable artefact that
outlives any particular implementation — and gives them first-class tooling:
structured lifecycle tracking, release-aware progress rollups, and a
browsable rendered site that makes the spec corpus navigable.

It's built on a three-layer view of software:

```
Strategy   — Why        (who we serve, what we sell, why)
   ↓
Specs      — What       (the system in enough detail to implement from)
   ↓
Code       — How, now   (the current implementation; increasingly throwaway)
```

In an AI-coding world, the marginal cost of regenerating code from a
sufficient description is collapsing. What outlives the code is the
description. Blueprint treats the spec layer as the primary investment and
gives it the tooling most teams wish their ticket tracker had.

## Status

**Early. Version 0.0.1.** This repo was scaffolded on 2026-04-23. The code
was extracted from an internal tool (kinetiq-business) that has been in
production use for months, but the reusable package is new. Expect rough
edges and API instability through 0.x.

The first consumer is Kinetiq Core. Blueprint's schema, tooling, and
methodology have been developed alongside that work; you're looking at the
generalisation.

## What's in the box

- **A schema** for living specs with `Status × Target × Delivered` tracking
  per subfeature, plus backlog tables with soft release targets.
- **A CLI** with three steps: `collect`, `aggregate`, `generate`.
- **A rendered site generator** that produces a filterable, tree-navigable
  browser of all specs with rollup progress bars, deep links, and
  cross-spec search.
- **Documentation** of the methodology this implements.

## Quick start

```bash
npm install --save-dev @kinetiq-core/blueprint

# In your package.json scripts:
#   "blueprint:refresh": "blueprint refresh"

blueprint refresh
```

See [`docs/getting-started.md`](docs/getting-started.md) for a full walkthrough.

## The methodology

Read [`docs/methodology.md`](docs/methodology.md) for the philosophical
framing: why specs-as-IP makes sense in an AI-coding world, how the
three-layer stack works, and what distinguishes Blueprint from adjacent
patterns like ADRs, RFCs, Shape Up, and classical docs-as-code.

## The schema

Read [`docs/schema.md`](docs/schema.md) for the concrete schema: frontmatter
fields, subfeatures table, backlog table, and the semantics of the `Status`,
`Target`, and `Delivered` columns.

## Licence

MIT — see [`LICENSE`](LICENSE).

## Roadmap

Blueprint's own roadmap is tracked in its own specs (dogfood). See
[`docs/specs/`](docs/specs/) once they're written — currently empty.

Near-term priorities:

- **0.1** — full CLI wiring, kinetiq-business switches over as first
  consumer, basic docs.
- **0.2** — configurable theming, non-Kinetiq consumer onboarding.
- **0.3+** — plugin architecture for custom site themes, integration
  options (GitHub PR comments, release-cut scripts).

## Who's behind this

Built and maintained by [Kinetiq Core](https://github.com/kinetiq-core).
Extracted from the internal tooling used to run spec-driven development on
our own products. Maintained under the `kinetiq-core` organisation until /
unless it outgrows that home.
