# Root / Worktree Safety Model

## Purpose

This document defines the safety model for Atlas-managed docs when a logical project id can appear in more than one checkout, worktree, or copied root. It is the root/worktree companion to `project-resolution-hardening.md` and the lifecycle surface notes in `lifecycle-state-surfaces.md`.

## What Current Code Does Today

- `.xurgo-atlas/project.json` stores `schemaVersion` and `projectId` only.
- The registry is keyed by `projectId`.
- Project resolution prefers a local marker, then registry roots, then a registry default if explicitly allowed.
- `daemon` records `projectId` and `projectRoot` in its pid file and rejects obvious project mismatches.
- `mcp-config --json` exposes `projectId`, `projectRoot`, `git`, `safety`, and descriptive `rootLedger` history.
- `docs.status` reports managed-vs-working-tree sync together with `rootContext`, including root identity, authoritative safety flags, and descriptive recovery state.
- `atlas.project_identity` provides a compact read-only runtime identity and root-safety snapshot without replacing `mcp-config --json`.
- `docs.read`, `docs.list`, `docs.context_pack`, and `docs.manifest` are read-only against managed state.
- `docs.export` and `docs.preview_export` write or preview into a target directory that defaults to the resolved project root.

## Landed Ledger Semantics

The shipped `rootLedger` surfaces are additive, history-derived context rather than a lock system:

- `docs.status.rootContext.rootLedger` and `mcp-config --json.rootLedger` report the per-project observation ledger.
- `docs.status.rootContext.recovery` and `docs.preview_export.rootContext.recovery` report pending proposal cleanup signals plus the latest preview/export recovery observations.
- `safety.safeForWrites` remains the authoritative write and export gate.
- `rootMismatch` is preserved as a compatibility alias for older consumers, but it does not replace the write gate.
- Recovery summaries are coordinator-facing and descriptive. They do not create locks, and `docs.discard_proposal` remains the cleanup path when pending proposals should be retired. `docs.preview_export` stays read-only with respect to disk, managed docs, manifest state, proposal state, and working-tree files even when it records best-effort internal recovery breadcrumbs.
- Ledger failures should degrade the summary to warnings or unavailable state rather than crash read-only surfaces or falsely certify safety.
- Multiple observed roots, worktrees, or Git common dirs are warning signals for coordinators, not automatic write blockers.

## Safety Problem

A copied repo, a secondary Git worktree, or a duplicated marker can make the project id look correct while the checkout identity is not. Without explicit checkout identity, Atlas cannot safely answer a basic question: which root is about to be read from, mutated, or exported into?

## Single-Agent Default

The normal Atlas flow stays unchanged when there is one checkout, one `.xurgo-atlas/project.json`, one registered root, and one daemon.

In that case, `xurgo-atlas init`, `xurgo-atlas daemon start`, and `xurgo-atlas mcp-config --json` should work without extra worktree-specific flags or registration steps.

Root/worktree metadata should still be visible in `docs.status` and `mcp-config --json`, but only as low-noise context when the binding is already safe and unambiguous.

Write and export tools should only fail closed when root identity is ambiguous, mismatched, copied, stale, or explicitly unsafe.

## Git Tracking Policy

`.xurgo-atlas/` should be treated as local root-bound state and ignored by Git. Normal operation does not require the marker to be committed, and `xurgo-atlas init` should create or repair it on demand.

If a repository already tracks `.xurgo-atlas/`, migrate by adding the ignore rule, untracking it with `git rm --cached -r .xurgo-atlas`, and committing that removal. Existing checkouts can then run `xurgo-atlas init` to recreate the local marker as needed.

Clones, copied checkouts, and secondary worktrees should not inherit a durable marker from Git history. They should get their own local marker only when `init` runs in that checkout.

## Recommended Model

### 1. Treat `projectId` as logical identity only

`projectId` identifies the project family, not the filesystem target.

### 2. Add an explicit checkout instance identity

Atlas should expose and validate the following when available:

- `projectId`
- canonical project root
- Git common dir
- Git worktree dir
- current branch
- current HEAD

### 3. Bind writes and exports to a concrete instance

Mutating tools should proceed only when the resolved checkout instance is explicit and unambiguous. If root identity is unclear, the tool should fail closed before touching disk.

### 4. Keep the current default compatibility rule

Until Atlas has an explicit root-instance registry, a duplicated `projectId` in another root should not silently inherit the original project binding. It should be treated as a separate, unregistered checkout and refused for mutating operations.

### 5. Make multi-root support deliberate

If Atlas later allows the same `projectId` in multiple roots, those roots should become first-class instances under one logical project, registered with distinct root metadata. That mode must be opt-in and inspectable.

## Tool Rules

| Tool group | Behavior |
|------------|----------|
| `docs.status`, `atlas.project_identity`, `docs.capabilities`, `mcp-config --json` | Report binding metadata and whether writes are currently safe. |
| `docs.read`, `docs.read_section`, `docs.list`, `docs.manifest`, `docs.context_pack` | May remain read-only, but must clearly report the resolved root instance. |
| `docs.export`, proposal commit flows, any disk write | Fail closed when the resolved root instance is ambiguous or mismatched. `docs.preview_export` remains read-only and may surface descriptive recovery hints, while `docs.discard_proposal` remains available for pending-proposal cleanup. |
| daemon startup and MCP request binding | Refuse to serve a different root instance than the one the daemon was started for. |

## Specific Answers

1. Should Atlas allow the same `projectId` in multiple roots?
   - Not by default.
2. If yes, should those be first-class root instances under one logical project id?
   - Yes, but only in an explicit multi-root mode.
3. If no, should Atlas reject secondary roots unless explicitly registered?
   - Yes.
4. Should the registry key include both `projectId` and canonical project root?
   - Yes, once the root-instance model is introduced.
5. Should `mcp-config --json` be explicitly root-bound and include root safety metadata?
   - Yes.
6. Should `docs.status` report requested/current cwd, marker root, registered root, daemon root, Git worktree identity, mismatch flags, and write safety?
   - Yes.
7. Should write/export tools refuse to run when the request root does not match the registered root?
   - Yes.
8. Should there be an explicit `--project-root` requirement for ambiguous multi-root situations?
   - Yes.
9. Should Atlas support a deliberate worktree-aware mode for multiagent workflows?
   - Yes, but as an explicit opt-in mode.
10. How should separate clones of the same repo/project be handled?
   - Treat them as separate checkout instances unless explicitly registered together.
11. How should Atlas protect users from cross-agent managed-doc export drift?
   - Surface the active root instance in status/config, require exact root binding for writes, and use preview-before-export as the default operator path.

## Phased Implementation Plan

### Phase 1: Visibility

- Add root/worktree metadata to `docs.status`.
- Add the same metadata to `mcp-config --json`.
- Keep the model read-only and inspectable before any write guard changes.

### Phase 2: Write Safety

- Fail closed in `docs.export`, proposal commit flows, and any other mutating boundary when root identity is ambiguous or mismatched.
- Keep read-only tools available with explicit binding metadata.

### Phase 3: Instance Registration

- Introduce explicit root-instance records for multi-worktree use.
- Key registry state by logical project id plus canonical checkout identity.
- Require deliberate registration for copied roots and secondary worktrees.

### Phase 4: Ergonomics

- Add CLI and doc guidance for multiagent and worktree-aware workflows.
- Document recommended handoff patterns so agents can tell which checkout they own.

## Recommended Follow-Up Branches

- `feat/root-bound-status-metadata`
- `feat/root-bound-write-guards`
- `feat/root-instance-registry`
- `docs/multiagent-worktree-guidance`
