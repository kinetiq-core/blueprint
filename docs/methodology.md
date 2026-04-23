# The methodology

Blueprint implements a specific position on how software teams should
organise their intellectual artefacts. This document is the position; the
rest of the repo is the toolchain.

## The three-layer stack

```
Strategy   — Why        (who we serve, what we sell, why)
   ↓
Specs      — What       (the system in enough detail to implement from)
   ↓
Code       — How, now   (the current implementation; increasingly throwaway)
```

Three layers, three lifetimes, three kinds of content.

**Strategy** is long-lived. Most strategy decisions outlive a decade of
implementations. It lives as narrative documentation — who the customer
is, what the product is for, what we deliberately don't sell.

**Specs** are medium-lived. A good spec survives a rewrite of the code it
describes. Specs describe the system at a level detailed enough that a
competent engineer (or a coding agent with oversight) can implement from
them — but not so detailed that they become the code. Specs name the
rules, edge cases, thresholds, and invariants; they don't prescribe loop
bounds or variable names.

**Code** is the current implementation. Short-lived in the new economics:
AI-generated, language-churned, framework-churned. Code is how the spec
happens to be realised at this moment — not what the system is.

## The AI-era shift

Historically the scarce, durable artefact was the code. Docs above the
code were double work; teams either skipped them (cowboy) or wrote them
once and let them rot (waterfall). The dominant form of IP capture became
the code itself, with strategy and design in whiteboards and heads.

AI coding inverts the economics. Generating plausible code from a
sufficient description now takes minutes. The load-bearing activity
becomes maintaining the description — the spec — not producing the code
it regenerates.

Stated as a thesis: **in an AI-coding world, code is throwaway; specs are
the IP; strategy is the layer above that tells the specs what to aim for.**

This isn't a fringe claim. It's a sharper version of patterns already
moving in this direction: Architecture Decision Records (ADRs), RFC
processes (Rust, Python PEPs, Django), Shape Up (Basecamp), docs-as-code.
Each has been moving IP one layer above code for a decade. What's new is
the economic pressure that finally makes the upper layers worth the
investment.

## What's in a spec

Blueprint specs are not just requirements documents. They carry:

- **Prose (the design)** — purpose, architecture, data model, interfaces,
  invariants, edge cases. Always reflects the current or target design.
  Rewritten when the design changes. One current description; no
  duplicated version history inline (git preserves prior states).
- **Subfeatures table (the delivery log)** — append-mostly record of what
  work has been done, aimed at which release, and when it actually
  shipped. See [`schema.md`](schema.md).
- **Backlog table** — questions, dependencies, rejected alternatives,
  enhancements awaiting commitment.
- **Technical approach (inline)** — implementation decisions, "why this
  over the obvious alternative", "what would break if you did it
  differently". For cross-cutting decisions, escape to an ADR and link.
- **What we're deliberately not doing** — out-of-scope content, rejected
  alternatives, anti-patterns specific to this feature. This is
  critical for AI-generated code: an agent will confidently produce
  plausibly-wrong code unless told what not to do.

The last point deserves emphasis. **Treat specs with the care you'd treat
a prompt.** AI coding doesn't make specs less important; it makes the
negative-knowledge content in specs — the "don't do Y" — into a
first-class input.

## The living-document lifecycle

Specs evolve. Four scenarios, all handled by the same schema:

### Initial authoring
Spec starts with frontmatter, prose, and an empty Subfeatures table.
Work is added as rows with `Status: Planned, Target: v1.0, Delivered: —`.

### Work completion
Status moves to `In Progress` while active, then `Done` when merged.
Delivered stays empty — work is complete but release not yet cut.

### Release cut
A release is declared (e.g., v1.0 shipping). Every subfeature with
`Status: Done, Target: v1.0` gets `Delivered: v1.0` stamped — a one-time,
immutable operation. A git tag marks the moment; the spec at that tag is
the authoritative v1.0 snapshot.

### Extension and rework
The spec grows as new work is scoped. New subfeatures get new Targets.
Prose updates in-place to reflect the evolving design. Shipped subfeatures
keep their `Delivered: v1.0` — because v1.0 did ship that way, and that
fact is historical record.

**Rework is not supersession.** If a shipped feature needs redesigning, the
prose is rewritten in place, a new subfeature row captures the work with
a reference in Notes ("rewrites §Storage Model; see SPM-1 which shipped
the original"), and the old row's Delivered stays frozen. No formal
"supersedes" relation between rows — rows are delivery log entries, not
design fragments.

## Operating model

- **Single main branch for specs.** No parallel prod branch. Release state
  is captured via git tags + the Delivered column; a "prod branch" would
  just duplicate that.
- **PR-gated edits.** Every spec change lands via pull request. The PR is
  the design review. In-flight drafts live in PR branches or a `drafts/`
  folder — never long-lived branches of the main line.
- **Cross-repo handshake.** Code repos reference specs; specs don't
  reference specific code paths. When code and spec both need to change,
  the spec PR merges first (or concurrently in a linked pair). This is
  the blueprint model — specs lead, code implements.
- **Atomic edits.** A PR that changes prose also updates the relevant
  subfeature's Status or Notes. Reviewers see the design change and its
  delivery implication in one place. The prose and tracking table never
  disagree between commits.

## Lineage

Blueprint sits in a tradition, not a wilderness:

- **Architecture Decision Records (ADRs)** — Michael Nygard, ~2011.
  Markdown decision docs in git.
- **RFC processes** — Rust, Python PEPs, Django, React, TC39. PR-gated
  design review, markdown-first.
- **Shape Up** — Ryan Singer / Basecamp, 2019. Pitches as primary
  artefacts, cycles as release windows, deliberately light tooling.
- **Docs-as-code** — Anne Gentle, Stripe, Backstage's TechDocs. Markdown
  in git, CI-generated sites.

What's distinctively new:

1. **`Status × Target × Delivered` schema** for tracking subfeature
   lifecycle through multiple releases of a living spec.
2. **Three-layer framing with code as the throwaway layer.** Prior
   patterns moved IP up one layer at a time; this frame makes the final
   position explicit.
3. **Aggregator + mirror + renderer toolchain** that operates across
   multiple source repos while keeping the derived site regeneratable
   from committed inputs.

## Further reading

- Ryan Singer, *Shape Up* — basecamp.com/shapeup
- Michael Nygard on ADRs — relevant.ly/documenting-architecture-decisions
- Anne Gentle, *Docs Like Code*
- Rust RFC process — github.com/rust-lang/rfcs
