---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Packaging now ships a minimal allowlisted runtime package, guarded patch writes are narrowed to curated-owned docs, and storage defaults now prefer Xurgo Atlas roots with legacy docu-guard fallback discovery"
nextActions:
  - "Plan the remaining CLI/internal/config-storage migration work without changing the docs.* namespace"
  - "Evaluate whether future document write modes should expand beyond create-only without adding adopt/update/delete prematurely"
blockers:
doNotDo:
  - "Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly"
  - "Do not merge v0.2-daemon to main without branch-sync resolution"
relatedDocs:
  - docs/manifest.yml
  - docs/implementation-checklist.md
  - docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md
lastUpdated: "2026-06-03"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded create-only document proposals support adding new Atlas Markdown docs. The latest storage-default migration now prefers `~/.config/xurgo-atlas` and `~/.local/share/xurgo-atlas` for fresh installs, auto-discovers legacy `docu-guard` roots for existing installs, and emits a warning when both atlas and legacy roots are populated without moving any storage. Managed docs branches are intentionally independent from source repo branches, and export now refuses cross-branch sync drift instead of writing it silently.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI remain stabilized as a private milestone. The latest completed packaging change now defines `package.json` `files` so published output is a minimal runtime package of `README.md`, `package.json`, and `dist/**`, and `npm pack` no longer falls back to `.gitignore`. The latest guarded write-scope change now uses curated ownership through `isPathOwned(...)` when evaluating `docs.propose_patch` eligibility, so tracked but unowned files are rejected. The storage-default migration now selects atlas roots for fresh installs, discovers legacy roots for existing installs, and keeps explicit `--config-dir` and `--data-dir` overrides authoritative. The branch-safety update now makes missing managed branches explicit in `docs.list`, `docs.read`, `docs.read_section`, `docs.status`, `docs.manifest`, `docs.context_pack`, and `docs.export`, and `docs.export` refuses to write into an existing git worktree when the checked-out source branch does not match the managed branch being exported. Existing protections remain intact: traversal, malformed/prose/`apply_patch` input, stale base revisions, and non-applyable patch validation are still enforced, `.docs-policy.yml` protected-path risk and approval behavior still layers on top, and the `docs.propose_document` create-only flow is unchanged.

## Recently Completed
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.
- `041aa28 fix: align guarded patch scope with curated ownership` narrows `docs.propose_patch` write eligibility to curated-owned docs via `isPathOwned(...)` and rejects patches to tracked but unowned files.
- `7846794 fix: make managed docs export branch-safe` makes managed branch independence explicit, adds clear missing-branch errors to `docs.list`, `docs.read`, `docs.read_section`, `docs.status`, `docs.manifest`, `docs.context_pack`, and `docs.export`, and refuses cross-branch exports into mismatched source worktrees. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`
- `3611143 feat(storage): use xurgo-atlas defaults with legacy fallback` switches fresh installs to Xurgo Atlas config/data roots, discovers legacy `docu-guard` roots for existing installs, keeps explicit overrides authoritative, warns when both roots are populated, and leaves storage files unmoved. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.

## Next Actions
- Plan the remaining CLI/internal/config-storage migration work after the package metadata rename
- Evaluate whether any future guarded document write modes should extend beyond create-only without adding adopt/update/delete prematurely
- Continue to defer proposal/approval UI and `docs.merge_branch` until separately planned

## Blockers
- None currently

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not merge v0.2-daemon to main without resolving the branch-sync gap
- Do not rename CLI/config/storage/MCP namespace/repo mechanically — transition remains gradual after the package metadata rename

## Related Documents
- [Implementation Checklist](docs/implementation-checklist.md)
- [v0.4 Spec](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md)
- [Xurgo Atlas Naming Migration Plan](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#14-xurgo-atlas-naming-migration-plan-post-v04)
- [Naming Migration Readiness Inventory](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#15-migration-implementation-readiness-inventory-phase-b-audit)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
