# SQLite Root / Worktree Safety Ledger

## Purpose

This document defines the next-step design for Atlas's local root/worktree safety ledger. It is a follow-on to `root-worktree-safety.md` and `lifecycle-state-surfaces.md`.

The goal is narrow:

- keep the normal single-checkout flow simple
- make project/root binding inspectable
- make write and export guards fail closed when root identity is unsafe
- preserve the current registry and marker behavior where it still helps
- avoid turning Atlas into a scheduler or general multiagent coordinator

## Landed Implementation

Atlas has already landed a descriptive ledger in the existing per-project `events.sqlite` store:

- `root_worktree_ledger` is created lazily the first time a project records an observation.
- rows are keyed by `project_id` and `identity_key`; the key fingerprints checkout context so repeat observations merge without becoming an ownership token.
- each observation records requested cwd, canonical root, registry and daemon roots, marker details, Git identity, and the safety snapshot that produced the observation.
- the resulting summary is surfaced on `docs.status.rootContext.rootLedger` and `mcp-config --json.rootLedger`.
- `docs.status.rootContext.recovery` and `docs.preview_export.rootContext.recovery` add descriptive cleanup signals and the latest preview/export recovery observations.
- summary failures are fail-soft: they return warnings or an unavailable summary instead of crashing read-only surfaces.
- distinct-root, distinct-worktree, and distinct-common-dir counts feed coordinator-facing warnings only; they do not override `safeForWrites`.
- recovery state is descriptive and coordinator-facing only. It does not turn the ledger into a lock system, and it does not weaken the managed write/export guard.

## Design Summary

The current model can be summarized as:

- `.xurgo-atlas/project.json` is a tiny ignored local marker that claims a `projectId`
- the existing registry keeps the durable project-id to root binding for compatibility and simple resolution
- the SQLite Atlas store records a descriptive local safety ledger for checkout identity, root observations, recovery breadcrumbs, and coordinator-facing guard signals
- `docs.status.rootContext` and `xurgo-atlas mcp-config --json` remain the public root and ledger read surfaces for now
- `docs.status.rootContext.recovery` and `docs.preview_export.rootContext.recovery` add descriptive cleanup signals and the latest preview/export recovery observations
- future mutating tools may consult ledger and recovery state before writing, but `root-safety` remains the authoritative write and export gate until an explicit lock or enforcement system exists

Atlas should treat the logical project id and the concrete checkout instance as different concepts. `projectId` says which project family the root belongs to. The checkout instance says which filesystem root, worktree, and daemon binding are actually safe.

## Current Registry and Marker Behavior

The current registry model is still useful, but it is too small to carry every safety decision.

What should remain in the registry:

- user-facing project registration
- the legacy one-project-id-to-one-root compatibility map
- the default project fallback used by existing CLI flows
- compatibility data needed to keep `init`, `project list`, and older resolution paths stable

What should move into SQLite:

- root identity observations
- worktree and daemon binding details
- safety state transitions
- guard refusal reasons and warnings
- lock state
- history of stale, ambiguous, removed, or conflicting roots

What should not move into the marker:

- canonical root paths
- Git worktree metadata
- daemon bindings
- managed revision state
- lock ownership
- any long-lived safety record beyond the local `projectId` claim

`.xurgo-atlas/project.json` should remain easy to recreate or repair during `init`. It should not become the durable source of truth for root binding.

## Ledger Scope

The ledger should track the facts needed to decide whether a request root is safe for reads, writes, or export.

| Field | Why it matters |
|------|----------------|
| `projectId` | Logical project family identifier |
| `canonicalProjectRoot` | Resolved filesystem root for the checkout instance |
| `markerPath` | Path to `.xurgo-atlas/project.json` in the checkout |
| `markerProjectId` | The project id claimed by the marker |
| `registeredProjectRoot` | The registry root currently associated with the project id |
| `gitWorktreeRoot` | The checkout root that Git considers the worktree |
| `gitCommonDir` | Shared Git common directory when a worktree is involved |
| `branch` | Branch identity for human review and drift checks |
| `HEAD` | Current commit identity for safety and auditability |
| `daemonBoundRoot` | The root instance the daemon is currently serving |
| `sourceRevision` | Revision of the source surface that produced the managed state |
| `managedRevision` | Revision of the Atlas-managed state that the request would mutate or export |
| `lastSeenAt` | When the root was last observed |
| `safetyState` | Current safety classification for the root instance |
| `warnings` | Reasons the root is degraded, ambiguous, stale, or conflicting |
| `rootStatus` | Human-readable status such as active, stale, removed, ambiguous, or conflicting |

Some of those fields are stored facts. Others are derived at observation time. The important part is not whether every field is materialized in exactly one column. The important part is that the ledger keeps enough evidence to answer, "Is this root safe to write to right now?"

## Recommended Tables

The ledger should stay small and composable. A few focused tables are better than a single oversized blob.

### `project_roots`

This is the current root-instance index.

Suggested contents:

- one row per known checkout instance
- the current safety classification for that instance
- the latest observed root, worktree, marker, and daemon metadata
- the current managed and source revision snapshot
- the latest warning set

Good keys and indexes:

- stable internal `rootInstanceId`
- unique lookup on `projectId` plus `canonicalProjectRoot`
- optional lookup on `gitCommonDir` plus `gitWorktreeRoot`
- optional lookup on `daemonBoundRoot` for process binding checks

### `root_observations`

This is the append-only observation history.

Use it for:

- every resolution attempt
- status reads that populate rootContext
- daemon startup checks
- export and proposal preflight checks
- repair or re-registration attempts

Each observation should capture the evidence used to make the safety decision, even if the decision is later superseded.

### `root_safety_events`

This is the append-only safety event log.

Use it for:

- mismatched marker claims
- stale registry entries
- removed or missing roots
- ambiguous duplicate roots
- conflicting daemon bindings
- write refusals
- export refusals
- explicit repairs or reclaims

The event log is where we preserve the auditable story of why a root became unsafe or why a guard blocked a mutation.

### `root_locks`

This is the local advisory lock table.

Use it for:

- write locks
- export locks
- index update locks
- short-lived guard ownership

The lock table should be small, single-machine scoped, and TTL-based. It is not a distributed coordination system.

## Table Roles

| Table | Role | Shape |
|------|------|-------|
| `project_roots` | Current safety state | Materialized current record |
| `root_observations` | Evidence trail | Append-only observation log |
| `root_safety_events` | Audit trail | Append-only event log |
| `root_locks` | Guard coordination | Small advisory lock table |

## Root Status Model

The ledger should support a small state vocabulary rather than inventing many one-off flags.

Recommended states:

- `active`
- `stale`
- `removed`
- `ambiguous`
- `conflicting`
- `unregistered`
- `degraded`

Suggested meanings:

- `active` means the root matches the marker, registry, and current daemon expectations
- `stale` means the root was valid once but current evidence is out of date or incomplete
- `removed` means the checkout no longer exists or is unreachable
- `ambiguous` means more than one root could match the same logical project claim
- `conflicting` means the request root and the registered or daemon-bound root disagree
- `unregistered` means the root looks plausible but is not explicitly claimed in a safe way
- `degraded` means a needed source of evidence is unavailable and the request should be treated cautiously

These states should be visible in `docs.status.rootContext` and `mcp-config --json` so users can tell the difference between "safe but quiet" and "unsafe and blocked."

## Interaction With the Registry

The registry should not disappear. It still has a job.

Keep the registry for:

- compatibility with existing resolution behavior
- the default project lookup path
- explicit project add and list operations
- the small amount of durable user-facing binding that predates the SQLite ledger

Move safety authority into SQLite for:

- current checkout identity
- write eligibility
- daemon binding history
- lock ownership
- stale or conflicting root detection

Migration and backcompat implications:

- existing registry entries should seed the ledger on first open
- seed data should not silently bless unrelated copies or secondary worktrees
- if registry and marker disagree, fail closed rather than auto-healing into a writeable state
- if the ledger is missing or unreadable, read-only surfaces should degrade gracefully when possible, but mutating surfaces should refuse when identity cannot be proven

The practical rule is simple: the registry helps Atlas find the project. The SQLite ledger decides whether the project instance is safe enough to mutate.

## Interaction With `.xurgo-atlas/project.json`

The marker stays tiny.

It should keep only the minimum local claim:

- `schemaVersion`
- `projectId`

That is enough for a normal `init` flow to recreate or repair the local marker. It is not enough to prove write safety on its own.

The marker should not carry:

- canonical roots
- worktree metadata
- daemon roots
- lock ownership
- managed revisions
- any broad safety history

This keeps the marker cheap to repair, easy to inspect, and safe to discard if a checkout is copied or recreated.

## Interaction With Worktrees

Worktrees are the reason the safety ledger exists.

The default behavior should stay simple for a single checkout:

- one root
- one marker
- one registry binding
- one daemon binding
- one obvious safe write target

Secondary worktrees must be explicit safety contexts.

Rules for worktrees:

- the same `projectId` in another root should not silently authorize writes
- a copied repo should not inherit safety just because the marker or registry name matches
- a secondary worktree should be treated as a distinct root instance until it is explicitly registered
- worktree-aware support should be deliberate and inspectable, not implicit
- if the worktree identity is known, the ledger should record it; if it is not known, the request should fail closed for mutating paths rather than guessing

This is also where the ledger should distinguish between "same logical project" and "same filesystem root." Those are not equivalent.

## Interaction With Daemon Binding

The daemon needs to know which root instance it serves.

The binding rules should be:

- the daemon is bound to one root instance unless multi-root serving is explicitly designed and declared
- startup should record the bound root in the safety ledger
- requests should be checked against that bound root before any mutation
- a request for a different root should fail clearly instead of falling through to a compatible-looking project id

The current default should remain single-root daemon binding. A future daemon that serves multiple worktrees safely would need explicit routing to a concrete root instance, not just a shared `projectId`.

That keeps the coordinator role outside Atlas. Atlas should know how to protect a root. It should not become the scheduler that decides which agent gets which checkout.

## Safe For Writes

A mutating tool should treat a request as safe only when the following are true:

- the request root resolves to a concrete checkout instance
- the marker project id matches the resolved request project id
- the resolved root matches the registered root or an explicitly registered worktree instance
- the daemon bound root is compatible with the request root
- the Git worktree identity is known, or it is safely unavailable in a context where the other checks still prove identity
- no conflicting active lock exists
- the current root status is not ambiguous, conflicting, removed, or otherwise degraded in a way that could cause cross-root writes
- no broad export drift risk is detected that would make a write or export unsafe

When in doubt, the tool should fail closed.

This applies to current and future mutating boundaries, including:

- `docs.export`
- `docs.propose_patch`
- `docs.propose_document`
- `docs.commit_patch`
- any future docs or project mutation tool

`docs.preview_export` should remain the preferred first step when a user wants to understand whether an export is safe. It stays read-only, remains available when the root context is unsafe, and may surface descriptive `rootContext.recovery` hints about pending proposal cleanup or recent unsafe preview observations. `docs.export` should be the mutating boundary that actually reconciles managed state to disk.

## Interaction With MCP Surfaces

Current public surfaces are enough for now:

- `xurgo-atlas mcp-config --json`
- `docs.status.rootContext`
- `docs.export`
- `docs.preview_export`
- `docs.propose_patch`
- `docs.commit_patch`
- `docs.propose_document`
- `docs.read`
- `docs.read_section`

As the ledger matures, these surfaces should remain audit-friendly and conservative. They should explain when the checkout instance is unsafe, stale, or ambiguous instead of hiding that state behind a generic failure. The recovery summaries exposed on `docs.status.rootContext` and `docs.preview_export` should stay descriptive and additive rather than becoming silent write locks.

## Rollout Shape

The rollout should happen in layers.

Suggested order:

1. add the SQLite tables and make them read-only where possible
2. seed the ledger from the existing registry and marker data
3. teach read surfaces to report the ledger state
4. gate write and export paths behind the safety check
5. add repair and re-registration flows for known-good worktrees

Each layer should preserve the current single-checkout path until the next layer is proven.

## Guard Rails

The first implementation should obey these guard rails:

- never silently bless a copied checkout
- never let a marker alone authorize writes
- never let a stale registry entry overwrite a different root
- never convert an ambiguous root into an active one without explicit evidence
- never treat the ledger as a scheduler

If the design ever has to choose between convenience and evidence, choose evidence.

## Open Questions

These are intentionally left for implementation review:

- how much of the current registry lookup should remain as a compatibility fallback
- whether root observations need a compact JSON evidence payload or a normalized evidence table
- which mutation paths should be gated first beyond export and document writes
- how daemon restart behavior should reconcile a previously bound root against current observations
- whether the rollback path for a bad seed should be a repair record or a fresh observation record

The design is intentionally conservative so these details can be refined without changing the core safety model.
