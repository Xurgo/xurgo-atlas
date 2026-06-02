---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Implementing docs.status MCP tool (v0.4 Phase 5)"
nextActions:
  - "Implement docs.manifest tool (Phase 6)"
  - "Implement docs.read_section tool (Phase 7)"
  - "Add maxChars/maxBytes options to docs.read (Phase 8)"
  - "Validate self-dogfood with docs.status"
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

## Current Focus
Implementing `docs.status` MCP tool — v0.4 Phase 5 complete. The tool reads STATUS.md front matter + body, with optional truncation via `maxChars`.

## Next Actions
- Implement `docs.manifest` tool to return parsed manifest YAML as JSON
- Implement `docs.read_section` tool for heading-level reads
- Add `maxChars`/`maxBytes` options to `docs.read`
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
