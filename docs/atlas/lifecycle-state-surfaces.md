# Lifecycle State Surfaces

## Purpose

This document captures the broader Atlas lifecycle and state-surface hardening plan discovered through recent dogfooding. The concrete examples came from Xurgo Studio and recent Atlas work, but the plan is generic: it applies to Atlas itself and to any project that depends on Atlas-managed docs, exports, and proposal workflows.

The goal is to make it obvious which surface is current, which surface needs reconciliation, and when a user or agent should export, reconcile, or re-read instead of assuming that one representation automatically updates the others.

## Atlas Truth Surfaces

Atlas exposes several different truth surfaces:

| Surface | What it represents | Typical source of truth |
|---------|--------------------|-------------------------|
| Atlas managed/internal state | The canonical state Atlas mutates through guarded tools | Atlas storage / managed branch state |
| Working-tree files | Files on disk in the checked-out repository | Local filesystem |
| Git history and manifest | Versioned history plus the project map | Git commits and `docs/manifest.yml` |
| Proposal/draft state | Pending edits that are not yet committed | Proposal records and lifecycle state |
| Search/index state | Retrieval state and local lexical index freshness | Atlas search/index backend |

The important part is not that these surfaces exist. It is that they can drift independently unless the workflow makes the boundary explicit.

## Boundary Rules

- `docs.commit_patch` updates Atlas-managed state, but working-tree files can remain stale until `docs.export` runs.
- `docs.export` is a reconciliation step from managed state to disk, not a substitute for proposal cleanup.
- If disk content or source `main` is newer than managed state, the correct next step is an explicit reconcile/import workflow, not a blind export.
- Branch and revision mismatches should always fail clearly rather than silently switching the target surface.
- Proposal cleanup and export safety are related but separate concerns. Cleaning up drafts should not hide export drift, and exporting should not implicitly discard proposals.

## Confirmed Gaps Already Fixed

These gaps were surfaced during dogfooding and are now captured as handled behavior or documented workflow:

- Guarded creation now covers initialized policy-allowed docs such as `docs/spec/*.md` through Atlas-managed creation flows.
- `docs.commit_patch` and `docs.export` are documented as separate lifecycle steps, so managed-state updates do not imply the working tree has already been refreshed.
- Proposal cleanup now has first-class list and discard workflow coverage, so pending drafts are easier to inspect and retire safely.
- Node 22 validation guidance is part of the documented release and validation workflow, including the `nvm`-based setup path used for validation commands.
- Atlas retrieval guidance remains scoped to Atlas-managed docs and context, with `docs.search` and `docs.capabilities` still preserved as the lexical retrieval surface.

## Remaining Hardening Items

The next hardening pass should focus on visibility and drift detection rather than new authoring features:

1. Make `docs.status` a stronger single pane of glass, including clearer surface-state signals when managed state, disk, or export state are not aligned.
2. Detect drift between managed state and working-tree files before users assume the branch is clean.
3. Use `docs.preview_export` so users can see what `docs.export` would change before it touches disk, without mutating the working tree.
4. Make export safer when the disk copy is newer than managed state, including explicit refusal or a deliberate reconcile path.
5. Define an explicit reconcile/import workflow from disk or Git back into managed state so recovery does not depend on ad hoc manual steps.
6. Make proposal and export operations branch-aware so branch/revision mismatches fail early and clearly.
7. Expose search/index freshness so users know when retrieval is stale or needs refresh.
8. Add CLI parity for proposal, export, and recovery workflows if the MCP path becomes richer than the command-line path.

## Suggested Follow-Up Branches

These are suggested next slices, not commitments:

- `audit/docs-lifecycle-state-surfaces`
- `feat/docs-export-preview`
- `fix/docs-status-managed-drift`
- `feat/docs-reconcile-managed-state`
- `feat/docs-proposal-cli`

## Working Agreement

When in doubt, read the current surface first, then choose the narrowest safe reconciliation step:

- Read `docs.status` before assuming the project front page is current.
- Read `docs.manifest` before loading a large set of docs.
- Use `docs.read_section` when only one section matters.
- Treat `docs.preview_export` as the read-only first step, then `docs.export` as the mutating boundary.
- Treat `docs.commit_patch` and `docs.export` as separate boundaries.
- Prefer explicit refusal over silent auto-repair when the wrong branch or revision would otherwise be masked.

That keeps Atlas understandable, auditable, and safe when multiple truth surfaces are involved.
