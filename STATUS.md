---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "v0.4 stabilization audit complete"
nextActions:
  - "Plan mechanical rename/internal migration after the stable private v0.4 milestone"
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
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI are implemented and stabilized as a private milestone. The UI opens to STATUS.md, uses the manifest for navigation, reads documents through the REST context API, and exposes copy actions without editing or write workflows.

## Next Actions
- Plan mechanical rename/internal migration after the stable private v0.4 milestone
- Keep `docs.list` compact/role support as a smaller follow-up if needed for orientation
- Continue to defer proposal/approval UI and `docs.merge_branch` until separately planned

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
