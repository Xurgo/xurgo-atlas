---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "read-only REST context API implemented"
nextActions:
  - "Add compact and role options to docs.list (Phase 9)"
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
The minimal read-only REST context API is implemented as a facade over the existing MCP context tools. It exposes project listing, status, manifest, bounded document reads, section reads, and context-pack reads without write endpoints.

## Next Actions
- Add `compact` and `role` options to `docs.list`

## Blockers
- None currently

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not merge v0.2-daemon to main without resolving the branch-sync gap
- Do not rename package/CLI/repo mechanically — transition is gradual

## Related Documents
- [Implementation Checklist](docs/implementation-checklist.md)
- [v0.4 Spec](docs/spec/docu-guard-mcp-v0.4-status-manifest-context.md)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
