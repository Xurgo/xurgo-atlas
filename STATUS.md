---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Daemon lifecycle commands and curated Atlas document ownership are complete"
nextActions:
  - "Plan the remaining CLI/internal/config-storage migration work without changing the docs.* namespace"
  - "Decide when curated Atlas ownership should also narrow docs.propose_patch write scope"
  - "Keep docs.list compact/role support as a smaller follow-up if needed for orientation"
blockers:
doNotDo:
  - "Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly"
  - "Do not merge v0.2-daemon to main without branch-sync resolution"
relatedDocs:
  - docs/manifest.yml
  - docs/implementation-checklist.md
  - docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md
lastUpdated: "2026-06-02"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, daemon lifecycle commands and curated Atlas document ownership are implemented, and transitional CLI/internal naming remains where compatibility still matters.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI are implemented and stabilized as a private milestone. The daemon now supports `xurgo-atlas daemon start`, `xurgo-atlas daemon stop`, and `xurgo-atlas daemon status` while preserving the original foreground `xurgo-atlas daemon` behavior, and its PID file lives under managed runtime data outside the repo working tree. Curated Atlas document ownership is also implemented separately from `.docs-policy.yml` `protected_paths`: read-oriented surfaces now use canonical Atlas-owned paths plus `docs/atlas/**` and explicit `documents[].path` manifest entries for `docs.list`, `docs.read`, `docs.read_section`, `docs.context_pack`, MCP resources, REST reads, and the CLI list command. The package metadata rename remains complete: the package name is `xurgo-atlas`, the bins are `xurgo-atlas` and temporary legacy alias `docu-guard`, the MCP namespace remains `docs.*`, and config/storage paths remain unchanged.

## Next Actions
- Plan the remaining CLI/internal/config-storage migration work after the package metadata rename
- Decide when curated Atlas ownership should also narrow `docs.propose_patch` write scope beyond current policy-protected behavior
- Keep `docs.list` compact/role support as a smaller follow-up if needed for orientation
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
