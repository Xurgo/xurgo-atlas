---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Create-only document creation remains complete, and guarded patch preview/commit validation now rejects non-applyable proposals before commit"
nextActions:
  - "Plan the remaining CLI/internal/config-storage migration work without changing the docs.* namespace"
  - "Decide when curated Atlas ownership should also narrow docs.propose_patch write scope"
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
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, daemon lifecycle commands and curated Atlas document ownership are implemented, guarded create-only document proposals now support adding new Atlas Markdown docs, and guarded patch previews now validate stored proposal applyability before commit.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI remain stabilized as a private milestone. Guarded document creation now also supports `docs.propose_document` in create-only mode: proposals may create new Markdown files only under `docs/atlas/**`, must update `docs/manifest.yml` in the same proposal, preview both file changes together, and commit both managed-store changes atomically. Guarded patch previews now dry-run check applyability with `git apply --check --unidiff-zero` against the managed branch/worktree state, reject empty or non-unified patch bodies during preview, and return structured preview errors that distinguish invalid patches from stale base revisions. `docs.commit_patch` rejects corrupt or non-applyable patches and marks them rejected instead of stale. Validation still rejects traversal, paths outside `docs/atlas/**`, non-Markdown targets, existing files, duplicate manifest entries, and missing or invalid `docs/manifest.yml`. Proposal metadata now supports narrow `document_create` proposals, internal unified diff generation is used instead of shelling out to an external diff tool, `docs.propose_patch` remains backward-compatible, and no adopt/update/delete document tools were added.

## Next Actions
- Plan the remaining CLI/internal/config-storage migration work after the package metadata rename
- Decide when curated Atlas ownership should also narrow `docs.propose_patch` write scope beyond current policy-protected behavior
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
