---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Xurgo Atlas naming migration readiness audit complete"
nextActions:
  - "Use the readiness inventory to scope a small Phase B implementation before any rename work"
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
Xurgo Atlas is the project-context and documentation-safety MCP. The current implementation still uses transitional `docu-guard-mcp` package, CLI, and internal names.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI are implemented and stabilized as a private milestone. The Xurgo Atlas naming migration now has a concrete implementation readiness inventory; implementation remains deferred until a small Phase B slice is explicitly approved.

## Next Actions
- Use the readiness inventory to scope a small Phase B implementation before any rename work
- Keep `docs.list` compact/role support as a smaller follow-up if needed for orientation
- Continue to defer proposal/approval UI and `docs.merge_branch` until separately planned

## Blockers
- None currently

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not merge v0.2-daemon to main without resolving the branch-sync gap
- Do not rename package/CLI/config/storage/MCP namespace mechanically — transition is gradual and requires a separately approved implementation phase

## Related Documents
- [Implementation Checklist](docs/implementation-checklist.md)
- [v0.4 Spec](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md)
- [Xurgo Atlas Naming Migration Plan](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#14-xurgo-atlas-naming-migration-plan-post-v04)
- [Naming Migration Readiness Inventory](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md#15-migration-implementation-readiness-inventory-phase-b-audit)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
