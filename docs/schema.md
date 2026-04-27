# Spec schema

Blueprint expects each spec file to be a markdown document with structured
frontmatter and (optionally) two tracking tables in the body: Subfeatures
and Backlog.

## Frontmatter

```yaml
---
roadmap_type: backend | feature | release | ops | future
roadmap_group: <grouping name>
roadmap_item: <spec title>
roadmap_phase: Now | Soon | Later | Parked
maturity: Unassessed | Sketch | Draft | Buildable | Implemented | Trial | Provisional | Validated | Stability Candidate | Stable | Rework Needed
spec_schema: 3
---
```

- **`roadmap_type`** — which cross-spec tracking view this spec belongs to.
- **`roadmap_group`**, **`roadmap_item`** — human-readable categorisation.
- **`roadmap_phase`** — commitment timing, orthogonal to release delivery.
  (Parked wins over everything — a parked spec is not "in flight" regardless
  of Maturity.)
- **`maturity`** — current trust level for the spec as product truth. This is
  separate from work state, release target, and delivery history.
- **`spec_schema: 3`** — tells tooling which schema version this spec uses.
  Keep this current so migration and validation scripts know which vocabulary
  applies.

Maturity levels:

| Level | Label |
| --- | --- |
| 0 | Unassessed |
| 1 | Sketch |
| 2 | Draft |
| 3 | Buildable |
| 4 | Implemented |
| 5 | Trial |
| 6 | Provisional |
| 7 | Validated |
| 8 | Stability Candidate |
| 9 | Stable |
| R | Rework Needed |

## Subfeatures table

Tracks pieces of work scoped to an implementation effort. Append-mostly —
rows are added as work is identified, statuses move as work progresses,
Delivered is stamped once at release cut and then never changes.

```
| Key | Subfeature | Surface | Status | Target | Delivered | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SPM-1 | Pillar engine core | backend | In Progress | v1.0 | — | ... |
```

Column semantics:

- **`Key`** — unique short identifier, usually `<prefix>-<n>`.
- **`Subfeature`** — name.
- **`Surface`** — which surface this touches: `backend`, `mobile`, `web`,
  etc. Free-form.
- **`Status`** — **Planned** | **In Progress** | **Done**. Where the work is
  right now.
- **`Target`** — the release this is aimed at. Free-form string: `v1.0`,
  `v1.1`, `unscheduled`, or `Q2-2026` for non-software cadences. Leave
  blank for specs outside any release model.
- **`Delivered`** — the release this actually shipped in. **Immutable once
  set.** Empty until release cut. Stamping this is the release-cut
  ceremony.
- **`Notes`** — free text. Include section references, rationale, links.

## Backlog table

Tracks questions, dependencies, rejected alternatives, and enhancements
awaiting commitment. Distinct from Subfeatures because the content is
different — a backlog item is "a thing we're tracking, not yet committed
to work".

```
| Key | Type | Item | Status | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| SPM-B1 | decision | Calculation cascade sync vs queued | Triaged | v1.0 | ... |
```

Column semantics:

- **`Type`** — `decision` | `dependency` | `enhancement` | `subfeature`
  (the last being a backlog item that will likely be promoted to a
  Subfeature row when committed).
- **`Status`** — **Open** | **Triaged** | **In Progress** | **Resolved** |
  **Parked**.
- **`Target`** — soft intent ("we'd like this addressed by release X").
  Optional.

## Frontmatter for other tracking views

`roadmap_type: feature` expects:

```yaml
roadmap_feature_group: <group>
roadmap_feature_item: <feature name>
roadmap_feature_phase: Now | Next | Parked
roadmap_mobile: Planned | Alpha | Beta | Ready | -
roadmap_web: Planned | Alpha | Beta | Ready | -
```

`roadmap_type: backend` expects:

```yaml
roadmap_backend_group: <group>
roadmap_backend_item: <capability name>
roadmap_backend_phase: Now | Soon
roadmap_backend_maturity: Planned | Started | Alpha | Beta | Ready
```

(Same pattern for `release`, `ops`, and `future`.)

Note: legacy `roadmap_maturity` and `roadmap_*_maturity` fields are
deprecated. Use frontmatter `maturity` for product-truth confidence, known-work
row `Status` for work state, `Target` for release intent, and `Delivered` for
release history.

## Derived (not stored)

Blueprint's site generator computes these at render time — do not try to
hand-maintain them:

- Spec-level health rollup (count of Planned / In Progress / Done)
- Release composition (filter subfeatures by Target)
- Release delivery log (filter by Delivered)
- Folder-level rollup bars (descendants aggregated)
- Search index (across titles, paths, and snippets)
