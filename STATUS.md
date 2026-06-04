---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Storage migration apply-copy is merged and both CachyOS and macOS cutovers are complete. All active storage is migrated from legacy docu-guard roots to xurgo-atlas roots. Legacy roots archived on both machines. Next focus: release hardening, dependency security, and naming cleanup."
nextActions:
  - "Complete active legacy naming cleanup across CLI help text, error messages, and internal references"
  - "Release hardening: review validation tiers, ensure consistent pre-release checks"
  - "Create dependency security branch to address the vitest CVE (GHSA-5xrq-8626-4rwp) without breaking changes to the current release track"
  - "Keep storage migration apply-copy support in place until explicitly removed — do not remove legacy migration code paths yet"
  - "Continue to defer proposal/approval UI and docs.merge_branch until separately planned"
  - "No public release, tag, or publish without explicit approval"
blockers:
doNotDo:
  - "Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch"
  - "Do not implement docs.merge_branch"
  - "Do not implement proposal/diff/approval UI"
  - "Do not rename CLI/config/storage/MCP namespace/repo mechanically — transition remains gradual after the package metadata rename"
relatedDocs:
  - docs/manifest.yml
  - docs/implementation-checklist.md
  - docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md
lastUpdated: "2026-06-04"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded create-only document proposals support adding new Atlas Markdown docs. Storage migration apply-copy (`storage migrate --apply`) is now merged and has been successfully executed on both CachyOS and macOS machines. All active storage has been moved from legacy `docu-guard` config/data roots to `xurgo-atlas` roots. Legacy roots were archived (not deleted) in timestamped backup directories on each machine. The migration is conservative: copy-only, never deletes legacy roots, refuses populated Atlas targets, skips runtime artifacts, and validates copied project stores. Stale registry entries (projects with no matching data directories) were found during cutover and cleaned up to allow migration to succeed. Storage defaults now select Atlas config/data roots first, and both-present states stay on Atlas roots without merging data.

## Current Focus
The storage migration apply-copy is merged and both platform cutovers are complete. Focus now shifts to release hardening, dependency security, and active legacy naming cleanup. The vitest CVE (GHSA-5xrq-8626-4rwp, critical, CVSS 9.8) affecting the `vitest` devDependency (current: ^3.1.1, fixed in 4.1.8) should be reviewed and addressed on a separate dependency-security branch without breaking changes to the current release track. Storage migration apply-copy support should remain in place until explicitly removed to avoid premature deletion of migration code paths. Existing protections remain intact: traversal, malformed/prose/`apply_patch` input, stale base revisions, and non-applyable patch validation are still enforced, `.docs-policy.yml` protected-path risk and approval behavior still layers on top, the `docs.propose_document` create-only flow is unchanged, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `b4eb610 merge: storage migration apply copy` adds conservative copy-only `xurgo-atlas storage migrate --apply` that copies legacy registry and project stores into empty Atlas target roots, rewrites the copied registry to point at Atlas roots, skips runtime artifacts, validates copied project stores, leaves legacy roots untouched, refuses populated/conflict states, and refuses overwrite/merge behavior. Manual isolated QA passed, `validate:quick` and `validate:full` passed after merge.
- `7be26e5 merge: storage migration dry run` adds read-only `xurgo-atlas storage migrate --dry-run`, keeps non-dry-run `xurgo-atlas storage migrate` explicitly failing because write-capable migration is not implemented yet, reports no-legacy roots, legacy-only roots, Atlas-populated targets, both-present roots, partial legacy config/data states, registry presence and readable project counts, project ID conflicts, detectable registry `dataDir` mismatch, and runtime PID/log artifacts as skipped and left untouched, and summarizes blockers, warnings, future copy actions, future skip actions, and the next recommended action without performing writes or creating storage directories/files.
- `CachyOS cutover` completed and accepted: repo clean on main at b4eb610, storage migrated from legacy docu-guard roots to xurgo-atlas roots, 4 real project stores migrated (http-test, test-project, docs-mcp, xurgo-atlas), 5 stale legacy registry entries without matching data directories found during cutover and cleaned up (original registry backed up before cleanup), legacy roots archived (not deleted) at `~/xurgo-atlas-legacy-backups/20260604-003905/`, daemon restarted and reported running at http://127.0.0.1:3737/mcp, opencode MCP config updated with xurgo-atlas remote enabled (old docu-guard-mcp entry disabled, not removed), read-only docs tools verified through the xurgo-atlas MCP endpoint.
- `macOS cutover` completed and accepted: repo clean on main at b4eb610, storage migrated from legacy docu-guard roots to xurgo-atlas roots, 1 project store migrated, runtime artifacts skipped and not copied, legacy roots archived (not deleted) at `/Users/jasoncoate/xurgo-atlas-legacy-backups/20260604-003924`, daemon restarted and reported running at http://127.0.0.1:3737/mcp, Codex MCP config already had the live xurgo-atlas MCP entry (no live docu-guard/docu-guard-mcp entry needed removal), read-only docs tools verified through the xurgo-atlas MCP endpoint.
- `1e1c135 merge: propose patch unified diff support` updates `docs.propose_patch` to accept full git-style unified diffs, complete `--- path` / `+++ path` diffs, and complete `--- a/path` / `+++ b/path` diffs, while still rejecting empty or whitespace-only patches, prose-only input, `*** Begin Patch` envelopes, corrupt or truncated hunks, unsafe absolute or `..` header paths, and patches that touch files other than the declared guarded target. Error text now better explains supported and unsupported patch formats.
- `c3da6c5 merge: storage inspection command` adds read-only `xurgo-atlas storage inspect`, reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence, explicitly avoids migration or file modification, and introduces the reusable `inspectManagedStorage()` helper for future migration planning work.
- `22a1488 merge: validation speed tiers` adds `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full`, establishes `validate:quick` as the preferred default development loop, and keeps full validation available for riskier pre-merge or release-like checks.
- `7ddaaec merge: prepare storage migration cleanup` updates `README.md` to Atlas defaults, preserves legacy-only docu-guard fallback discovery, makes both-present states choose Atlas roots without merging, clarifies the pre-v0.3 project-local `.docu-guard/` warning wording, and makes project subcommands consistently pass through `--data-dir`.
- `ad1a0d1 refactor(runtime): clean up legacy docu-guard tokens` retitles safe current-runtime/internal tokens only: temp patch filenames now use xurgo-atlas branding, the init event label now uses `.xurgo-atlas/init`, AGENTS generated-content idempotency now recognizes atlas and legacy generated headers without relying on a loose `docu-guard` substring, and one internal storage comment now says Atlas-managed storage. Compatibility references were intentionally preserved for the temporary `docu-guard` bin alias, legacy storage discovery and diagnostics, project-local `.docu-guard` warnings, registry compatibility hints, and historical/spec docs. No physical storage migration was implemented. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.

## Next Actions
- Complete active legacy naming cleanup across CLI help text, error messages, and internal references
- Release hardening: review validation tiers, ensure consistent pre-release checks
- Create dependency security branch to address the vitest CVE (GHSA-5xrq-8626-4rwp) without breaking changes to the current release track
- Keep storage migration apply-copy support in place until explicitly removed — do not remove legacy migration code paths yet
- Continue to defer proposal/approval UI and `docs.merge_branch` until separately planned
- No public release, tag, or publish without explicit approval

## Blockers
- None currently

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not implement docs.merge_branch
- Do not implement proposal/diff/approval UI
- Do not rename CLI/config/storage/MCP namespace/repo mechanically — transition remains gradual after the package metadata rename

## Related Documents
- [Implementation Checklist](docs/implementation-checklist.md)
- [v0.4 Spec](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md)
- [Xurgo Atlas Naming Migration Plan](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#14-xurgo-atlas-naming-migration-plan-post-v04)
- [Naming Migration Readiness Inventory](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#15-migration-implementation-readiness-inventory-phase-b-audit)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
