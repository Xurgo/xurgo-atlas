# Read-Only Identity Tools Plan

## Purpose

This document defines a design-only checkpoint plan for three optional read-only Atlas MCP tools:

- `atlas.project_identity`
- `atlas.project_roots`
- `atlas.lock_status`

The goal is to decide whether each tool is needed, what stable contract it should expose, what it must not do, and what should wait for later lock enforcement work.

This document does not implement new tools, change runtime behavior, or change existing `docs.status`, `docs.preview_export`, or `mcp-config --json` semantics.

## Current Surfaces

Atlas already exposes most of the needed data through existing surfaces:

- `xurgo-atlas mcp-config --json`
- `docs.status.rootContext`
- `docs.status.rootContext.rootLedger`
- `docs.status.rootContext.recovery`
- `docs.preview_export.rootContext`
- `docs.preview_export.rootWarnings`

Those surfaces should remain the primary source of truth unless a narrower read-only tool offers a clear consumer or coordinator benefit.

## Design Principles

- Prefer focused projections over new authority. A new read-only tool may summarize existing state, but it should not become the policy engine that decides write safety.
- Keep recovery and ledger state descriptive until explicit write or export lock enforcement exists.
- Expose stable summaries, not raw storage internals, SQLite row shapes, or cleanup controls.
- Fail clearly when project identity cannot be resolved, but avoid mutating or auto-repairing state during a read-only call.
- Avoid duplicating `mcp-config --json` as the startup and configuration boundary unless there is a clear MCP-consumer need.

## Tool Decisions

### `atlas.project_identity`

Recommendation: implement first, if any new tool is added.

Why it may be needed:

- It provides one compact identity snapshot for agents or coordinators that need the current Atlas binding without stitching together several status surfaces.
- It can reduce repeated client-side parsing of `docs.status.rootContext` and related warnings.
- It is the safest focused addition because it can be implemented as a narrow projection over already-exposed descriptive state.

Intended consumers:

- MCP coordinators that need a single current root-binding snapshot
- agent tooling that wants current identity and safety context before proposing or exporting docs
- future Studio integrations that need a small read-only identity surface

Draft response shape:

```json
{
  "projectId": "xurgo-atlas",
  "projectRoot": "/repo",
  "requestedCwd": "/repo",
  "registeredProjectRoot": "/repo",
  "marker": {
    "path": "/repo/.xurgo-atlas/project.json",
    "projectId": "xurgo-atlas",
    "present": true,
    "matchesProject": true
  },
  "daemon": {
    "projectRoot": null,
    "matchesRequest": true
  },
  "git": {
    "worktreeRoot": "/repo",
    "commonDir": "/repo/.git",
    "branch": "main",
    "head": "<sha>"
  },
  "safety": {
    "safeForWrites": true,
    "ambiguous": false,
    "rootMismatch": false,
    "warnings": []
  },
  "rootLedger": {
    "status": "active",
    "observedRootCount": 1,
    "observedWorktreeCount": 1,
    "observedCommonDirCount": 1
  },
  "recovery": {
    "state": "none",
    "descriptive": true
  }
}
```

Contract rules:

- Keep the response compact and current-state-oriented.
- Reuse existing descriptive field meanings where possible.
- Treat `rootLedger` and `recovery` as summaries, not raw event history.
- Preserve the distinction between descriptive state and enforced lock state.

Must not:

- mutate state
- acquire or release locks
- repair markers, registry entries, or ledger rows
- replace `mcp-config --json` as the startup boundary
- invent stricter write policy than the existing safety model already reports

Visibility recommendation:

- MCP-only first
- hidden or experimental at first release
- no CLI command at first; add CLI parity later only if operators show repeated need for a compact human-facing identity view

### `atlas.project_roots`

Recommendation: do not implement until Atlas decides how much ledger history is stable enough to expose.

Why it may be useful later:

- It gives coordinators a read-only view of observed roots, worktrees, and common directories for one logical project.
- It can support troubleshooting for copied roots, stale worktrees, and ambiguous multi-root observations.
- It is a better fit than overloading `atlas.project_identity` with history or multi-root detail.

Why it should wait:

- The ledger is still evolving, especially around stale versus conflicting versus degraded root states.
- Exposing raw observation history too early would freeze unstable implementation details.
- Existing `docs.status.rootContext` and `rootLedger` summaries already cover the single-root happy path.

Draft response shape:

```json
{
  "projectId": "xurgo-atlas",
  "currentRoot": "/repo",
  "canonicalProjectRoots": ["/repo"],
  "observedRoots": [
    {
      "projectRoot": "/repo",
      "gitWorktreeRoot": "/repo",
      "gitCommonDir": "/repo/.git",
      "status": "active",
      "firstSeenAt": "2026-06-17T12:00:00Z",
      "lastSeenAt": "2026-06-17T12:30:00Z",
      "observationCount": 4,
      "current": true,
      "warnings": []
    }
  ],
  "warnings": []
}
```

Contract rules:

- Expose a stable summary view, not raw ledger rows.
- Keep counts, timestamps, current markers, and high-level warnings.
- Only expose stale-ish hints when they are deterministic and non-destructive.

Must not:

- delete stale roots
- clean registry entries
- acquire or release locks
- mark a root unsafe on its own outside the existing safety model
- expose low-level storage internals that Atlas may still need to change

Visibility recommendation:

- MCP-only if implemented
- hidden or experimental initially
- no CLI surface until the summary model proves stable and useful

### `atlas.lock_status`

Recommendation: document the future contract now, but do not implement the tool until real lock semantics exist.

Why it is not needed yet:

- Atlas does not yet have explicit write or export lock enforcement.
- Current recovery state is descriptive and should not be mislabeled as lock enforcement.
- A premature tool that mostly returns `not implemented` would add surface area without improving safety.

Near-term design requirement:

- Reserve the meaning of the tool name now so future lock semantics can land without re-litigating the contract.
- Make the descriptive-versus-enforced distinction explicit in the future response shape.

Draft response shape before lock implementation:

```json
{
  "available": false,
  "implemented": false,
  "enforced": false,
  "descriptiveOnly": true,
  "recovery": {
    "state": "none",
    "descriptive": true
  }
}
```

Draft response shape after lock implementation:

```json
{
  "available": true,
  "implemented": true,
  "enforced": true,
  "lock": {
    "type": "write",
    "targetRoot": "/repo",
    "owner": "session-or-agent-if-designed",
    "acquiredAt": "2026-06-17T12:00:00Z",
    "expiresAt": "2026-06-17T12:05:00Z",
    "stale": false
  },
  "recovery": {
    "state": "none",
    "descriptive": false
  },
  "advisory": false
}
```

Must not:

- acquire or release locks
- imply that lock enforcement already exists
- collapse descriptive recovery breadcrumbs into an enforced lock contract
- expose agent or session ownership until Atlas explicitly designs that behavior

Visibility recommendation:

- no public tool yet
- re-evaluate MCP and CLI exposure only after write or export lock semantics are implemented

## Relationship to Existing Surfaces

`atlas.project_identity` should only exist if it offers a smaller and easier consumer contract than assembling data from `mcp-config --json` plus `docs.status.rootContext`.

`atlas.project_roots` should only exist if Atlas needs a stable multi-root summary that does not fit naturally in `docs.status.rootContext`.

`atlas.lock_status` should not ship as a public compatibility promise before Atlas implements real lock semantics.

None of these tools should change or replace:

- `mcp-config --json` as the startup and configuration surface
- `docs.status` as the broad front-door status surface
- `docs.preview_export` as the read-only export-safety preview
- existing root safety or recovery semantics

## Compatibility and Failure Modes

Compatibility rules:

- Prefer additive fields and reuse existing terminology such as `safeForWrites`, `ambiguous`, and descriptive `recovery` state.
- Keep tool names Atlas-specific and read-only.
- Start hidden or experimental so contracts can mature before broad adoption.

Failure-mode expectations:

- unresolved project identity should fail clearly and say which evidence was missing
- degraded or ambiguous identity should return descriptive warnings without mutating state
- lock-related responses should distinguish `not implemented`, `implemented but inactive`, and `implemented and enforced`
- read-only tools should never auto-repair drift, clear warnings, or clean stale roots

## Rollout Order

1. Keep using existing surfaces while the ledger stabilizes.
2. If consumer demand exists, implement `atlas.project_identity` first as a compact read-only MCP projection.
3. Validate whether that tool removes real coordinator or client complexity before adding more read-only tools.
4. Decide which ledger facts are stable enough for exposure, then consider `atlas.project_roots`.
5. Design write or export lock semantics first, then implement `atlas.lock_status` only after those semantics are real.

## Future Implementation Tests

If Atlas implements any of these tools later, tests should cover:

- parity between `atlas.project_identity` and the corresponding `docs.status.rootContext` or `mcp-config --json` facts
- copied-root, secondary-worktree, stale-registry, and daemon-mismatch scenarios
- descriptive recovery state remaining non-authoritative before lock enforcement exists
- `atlas.project_roots` returning stable summaries without leaking raw ledger internals
- `atlas.lock_status` clearly separating unimplemented, advisory, inactive, stale, and enforced states
- confirmation that all three tools remain read-only and do not mutate ledger, proposal, export, or daemon state

## Studio Coordination Before Implementation

Do not coordinate with Studio in this branch.

Before implementing any of these tools, Atlas should coordinate with Studio and other agent consumers about:

- the expected Git workflow and Atlas-managed docs workflow
- the current comment standard: explain why, safety boundaries, invariants, failure modes, lifecycle behavior, and public-surface semantics
- the expectation that docs update when behavior or public surfaces change
- the expectation that `AGENTS.md` carries concise comment and docs guidance
- the rule that recovery and ledger state remain descriptive until explicit lock enforcement exists
- the rule that read-only identity tools should help coordinators inspect state without mutating it

## Explicit Non-Goals

- implementing new MCP tool handlers
- changing runtime behavior
- adding write or export locks
- adding mutating lock acquire or release tools
- adding automatic cleanup or stale-root deletion
- adding active writer ownership or session ownership
- changing `mcp-config --json`
- changing `docs.status` or `docs.preview_export` runtime behavior
