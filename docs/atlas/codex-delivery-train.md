# Codex-Only Delivery Train

## Purpose and Status

The Codex-only delivery train is an optional, bounded local-development mode for Xurgo Atlas. It accelerates small, reversible slices while preserving the canonical workflow:

```text
Coordinator → Atlas product session → Codex/local-agent → Atlas assessment → Coordinator
```

It does not replace Atlas product-session assessment, independent assessment, landing gates, release authorization, or Coordinator portfolio reconciliation.

## Startup Entry Point

Before every slice, the conductor must read the active Shadow Ledger item and run fresh local preflight:

1. Confirm the repository root, current branch, HEAD, intended base, and worktree state.
2. Confirm the slice has a bounded objective, allowed files, validation, commit authority, and hard stops.
3. Reconcile managed-doc scope through Atlas guarded tools before changing a managed document.
4. Record observed branch, HEAD, validation evidence, changed files, report path, next safe action, and gate status in the Shadow Ledger.

A missing, contradictory, or unsafe local state stops the current slice. Under local-only standing authority, descriptive base fields may be resolved through read-only local preflight and recorded before work continues.

## Conductor Responsibilities

The conductor owns slice intake, preflight, bounded sub-slice assignment, diff and validation reconciliation, managed-doc/register reconciliation, Shadow Ledger reporting, and stop-gate compliance.

The conductor does not land to `main`, synchronize remotes, create a PR, prepare or perform a release, change a version, tag, publish, use credentials or registries, make readiness/public-capability claims, or mutate canonical Coordinator/product records.

## Slice Contract

Each Shadow Ledger item must record:

| Field | Requirement |
| --- | --- |
| Product, loop, and slice | Exact project, loop ID, and bounded slice ID |
| Objective | One small, user-visible or baseline-preserving outcome |
| Base and working branch | Explicit values or locally discovered values recorded before local-only work |
| Scope | Exact allowed files or bounded discovery rule; explicit forbidden actions |
| Docs/register authority | Exact managed docs/register paths or `none` |
| Notion authority | Exact Shadow Ledger scope; canonical records remain payload-only unless separately authorized |
| Validation | Required local commands or evidence |
| Commit authority | `none`, `local commit allowed`, or an exact rule |
| Continuation rule | Whether the conductor may begin the next local-only item |
| Hard stops and return | Gate conditions and the report/evidence shape |

An omitted permission is not a permission. Keep slices small, complete, reviewable, and reversible.

## Shadow Ledger and Notion Boundary

The Atlas Shadow Ledger is operational state, not the canonical Coordinator or product record. The conductor may record only operational facts there: queue state, branch/HEAD, files changed, validation, reports, blockers, gates, next safe action, and proposed canonical payloads.

Direct Notion update is permitted only for the exact Shadow Ledger page or data source named by the active slice. Canonical tracker, release, readiness, user-acceptance, credential, publication, provider, registry, roadmap, and unrelated product records are read-only or payload-only unless a later packet explicitly grants exact direct authority.

If an exact record ID, property schema, allowed value, or permission is missing, emit a proposed payload instead of inferring a destination.

## Optional Sub-Agents

Use sub-agents only with a written micro-contract that names the parent loop, sub-slice, objective, branch/base constraint, allowed files, forbidden actions, validation, docs/register authority, Notion posture, stops, and evidence return shape.

Sub-agents cannot broaden scope, self-authorize, independently assess readiness, alter canonical records, land, use remote/GitHub/release/publish/credential/registry actions, or hide evidence from the conductor.

## Managed Documentation

Managed documentation is changed only through Atlas guarded tools:

1. Read the current document and revision.
2. Propose a bounded patch or document creation with intent and summary.
3. Preview the diff and review risk.
4. Commit the proposal only when the slice authorizes it.
5. Before export and local commit, classify every managed-doc/export change as required for the slice, valid managed-store/source synchronization, or unrelated stale drift to revert.
6. Report that classification and the final scoped diff.

See [Development Workflow](./development-workflow.md), [Root / Worktree Safety Model](./root-worktree-safety.md), and [Daemon, CLI & MCP Reference](./daemon-mcp.md) for the supporting operational rules.

## Hard Gates

Stop and report before push, pull/fetch, remote sync, landing to `main`, release preparation, version bump, tag, publication, GitHub/hosted release, PR creation, registry/package actions, credential/auth use, live-provider calls, destructive operations, canonical-record mutation, readiness claims, user-acceptance claims, or roadmap expansion beyond current direction.

At a hard gate, mark the Shadow Ledger item `Gate reached`, preserve evidence, and name the next required authority.

## Terminal Report

Each completed or blocked local slice records the slice ID, observed branch and HEAD, changed files, validation run and gaps, local commits, Shadow Ledger writes, proposed canonical payloads, continuation decision, hard gate (if any), report path, next safe action, and required next authority.

Use the compact `Codex YOLO-Local Envelope v0.1` when pausing or handing work back.
