---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Release hardening and release-candidate prep: install/setup docs, daemon setup docs, MCP config docs, storage migration docs, and validation/release checklist"
nextActions:
  - "Release hardening / release candidate prep"
  - "Install/setup docs, daemon setup docs, MCP config docs, storage migration docs"
  - "Validation/release checklist"
  - "Keep storage migration support until explicitly removed"
  - "No public release/tag/publish without explicit approval"
blockers:
doNotDo:
  - "Do not implement docs.merge_branch unless explicitly asked"
  - "Do not implement proposal/diff/approval UI unless explicitly asked"
  - "Do not remove legacy migration support yet"
  - "Do not delete machine legacy backup directories yet"
  - "Do not publish/release/tag without explicit approval"
relatedDocs:
  - docs/manifest.yml
  - docs/implementation-checklist.md
  - docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md
lastUpdated: "2026-06-04"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. The storage migration is complete: all active managed storage was copied from legacy `docu-guard` roots to `xurgo-atlas` roots, and the migration now hardens copied project stores by repairing internal Git metadata during staged migration before finalization. Legacy roots were archived (not deleted) and remain accessible if needed. The Vitest dependency was upgraded from 3.x to 4.x to resolve a critical audit vulnerability (GHSA-5xrq-8626-4rwp). The package binary now exposes `xurgo-atlas` only — the legacy `docu-guard` CLI alias has been removed. Active product naming has been cleaned up across README, help text, generated templates, and root AGENTS.md. The `docs.*` MCP namespace remains intentionally unchanged.

## Current Focus
Release hardening and release-candidate preparation. The immediate next work items are install/setup documentation, daemon setup documentation, MCP configuration documentation, storage migration documentation, and a validation/release checklist. Storage migration support (both dry-run and apply-copy) is stable and should be kept in place until explicitly removed.

## Recently Completed
- `177e1a9 merge: remove active legacy naming` removes all active/current-product `docu-guard` and `docu-guard-mcp` naming from README, CLI help text, error messages, generated templates, and tests. The package binary now exposes `xurgo-atlas` only. Root AGENTS.md was updated through the guarded docs workflow. The `docs.*` MCP namespace intentionally remains unchanged. Intentional legacy references are preserved only for migration compatibility, diagnostics explaining old roots, and migration test fixtures.
- `4a74ce6 merge: update test dependencies for audit` resolves a critical npm audit issue (GHSA-5xrq-8626-4rwp) in Vitest. Vitest was upgraded from 3.x to 4.x. npm audit now reports 0 vulnerabilities. Only `package.json` and `package-lock.json` changed. `validate:full` passed before merge.
- `615b1ef merge: storage migration git metadata repair` hardens `xurgo-atlas storage migrate --apply` by repairing internal Git metadata in copied project stores during staged migration before finalization. The repair normalizes bare repo HEAD from stale/nonexistent `master` to `main` when appropriate, fixes workdir object alternates pointing at legacy roots, and fixes workdir origin remote URLs pointing at legacy bare repo paths. Conservative migration behavior is preserved: no deletion of legacy roots, no overwrite/merge behavior, no mutation of legacy source roots.
- `b4eb610 merge: storage migration apply copy` adds conservative copy-only `xurgo-atlas storage migrate --apply` that copies legacy registry and project stores into empty Atlas target roots, rewrites the copied registry to point at Atlas roots, skips runtime artifacts, validates copied project stores, leaves legacy roots untouched, refuses populated/conflict states, and refuses overwrite/merge behavior. Manual isolated QA passed, `validate:quick` and `validate:full` passed after merge.
- `7be26e5 merge: storage migration dry run` adds read-only `xurgo-atlas storage migrate --dry-run`, keeps non-dry-run `xurgo-atlas storage migrate` explicitly failing because write-capable migration is not implemented yet, reports no-legacy roots, legacy-only roots, Atlas-populated targets, both-present roots, partial legacy config/data states, registry presence and readable project counts, project ID conflicts, detectable registry `dataDir` mismatch, and runtime PID/log artifacts as skipped and left untouched, and summarizes blockers, warnings, future copy actions, future skip actions, and the next recommended action without performing writes or creating storage directories/files.
- `1e1c135 merge: propose patch unified diff support` updates `docs.propose_patch` to accept full git-style unified diffs, complete `--- path` / `+++ path` diffs, and complete `--- a/path` / `+++ b/path` diffs, while still rejecting empty or whitespace-only patches, prose-only input, `*** Begin Patch` envelopes, corrupt or truncated hunks, unsafe absolute or `..` header paths, and patches that touch files other than the declared guarded target. Error text now better explains supported and unsupported patch formats.
- `c3da6c5 merge: storage inspection command` adds read-only `xurgo-atlas storage inspect`, reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence, explicitly avoids migration or file modification, and introduces the reusable `inspectManagedStorage()` helper for future migration planning work.
- `22a1488 merge: validation speed tiers` adds `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full`, establishes `validate:quick` as the preferred default development loop, and keeps full validation available for riskier pre-merge or release-like checks.
- `7ddaaec merge: prepare storage migration cleanup` updates `README.md` to Atlas defaults, preserves legacy-only docu-guard fallback discovery, makes both-present states choose Atlas roots without merging, clarifies the pre-v0.3 project-local `.docu-guard/` warning wording, and makes project subcommands consistently pass through `--data-dir`.
- `ad1a0d1 refactor(runtime): clean up legacy docu-guard tokens` retitles safe current-runtime/internal tokens only: temp patch filenames now use xurgo-atlas branding, the init event label now uses `.xurgo-atlas/init`, AGENTS generated-content idempotency now recognizes atlas and legacy generated headers without relying on a loose `docu-guard` substring, and one internal storage comment now says Atlas-managed storage. Compatibility references were intentionally preserved for the temporary `docu-guard` bin alias, legacy storage discovery and diagnostics, project-local `.docu-guard` warnings, registry compatibility hints, and historical/spec docs. No physical storage migration was implemented. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.

## Next Actions
- Release hardening / release candidate prep
- Install/setup docs, daemon setup docs, MCP config docs, storage migration docs
- Validation/release checklist
- Keep storage migration support until explicitly removed
- No public release/tag/publish without explicit approval

## Blockers
- None currently

## Do Not Do
- Do not implement docs.merge_branch unless explicitly asked
- Do not implement proposal/diff/approval UI unless explicitly asked
- Do not remove legacy migration support yet
- Do not delete machine legacy backup directories yet
- Do not publish/release/tag without explicit approval

## Related Documents
- [Implementation Checklist](docs/implementation-checklist.md)
- [v0.4 Spec](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md)
- [Xurgo Atlas Naming Migration Plan](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#14-xurgo-atlas-naming-migration-plan-post-v04)
- [Naming Migration Readiness Inventory](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#15-migration-implementation-readiness-inventory-phase-b-audit)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
