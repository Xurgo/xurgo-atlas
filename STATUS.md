---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Private RC blocker fixes are in progress: quick-start init docs are being corrected, guarded docs are being resynced so MCP readers match source, daemon help is being made non-binding, and default MCP request-body logging is being reduced before any private RC decision"
nextActions:
  - "Finish validating the private RC blocker-fix branch: rerun npm audit, validate:full, daemon help/status checks, and guarded-doc reads before making any private RC recommendation"
  - "Keep storage migration conservative: `storage migrate --apply` remains copy-only, never deletes legacy roots, refuses populated or conflicting Atlas targets, skips runtime artifacts, validates copied stores, and repairs copied Git metadata as needed"
  - "Keep tag, publish, and release actions gated on explicit approval; do not treat this blocker-fix branch itself as a release"
blockers:
  - "Private RC readiness is still pending until `codex/private-rc-readiness-fixes` validates cleanly and guarded docs match source again"
doNotDo:
  - "Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly"
  - "Do not tag, publish, or release without explicit approval"
  - "Do not implement docs.merge_branch or proposal/diff/approval UI unless explicitly requested"
relatedDocs:
  - docs/manifest.yml
  - docs/atlas/setup.md
  - docs/atlas/daemon-mcp.md
  - docs/atlas/storage-migration.md
  - docs/atlas/release-checklist.md
lastUpdated: "2026-06-04"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded document proposals remain the required path for managed docs. Managed storage now defaults to Atlas XDG roots while preserving legacy `docu-guard` fallback discovery for compatibility, and the CLI now supports both read-only storage inspection and a conservative copy-only legacy-to-Atlas apply path.

## Current Focus
The current focus is private RC blocker cleanup rather than new feature expansion. The `codex/private-rc-readiness-fixes` branch is correcting release-facing quick-start examples, resyncing guarded docs so MCP readers match the intended source content again, documenting expected `/mcp` verification behavior, making `xurgo-atlas daemon --help` print help without trying to bind a port, and reducing default MCP transport logging so background daemon logs do not persist full request bodies. No tag, publish, or release action has occurred, and no private RC recommendation should be made until this branch revalidates cleanly.

Storage migration now includes a conservative `xurgo-atlas storage migrate --apply` path. The apply step remains intentionally narrow: it is copy-only, never deletes legacy roots, refuses populated or conflicting Atlas targets instead of merging them, skips runtime artifacts, validates copied project stores, and repairs copied Git metadata such as bare `HEAD`, workdir alternates, and origin remote URLs. Existing protected-doc behavior remains intact: traversal, malformed or prose-only patch input, stale base revisions, and non-applyable patch validation are still enforced, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `b4eb610 merge: storage migration apply copy` merges `73b0acb feat: add storage migration apply copy`, adding the first explicit write-capable storage migration slice as a conservative copy-only apply path.
- `615b1ef merge: storage migration git metadata repair` merges `d936032 fix: repair internal git metadata during storage migration`, repairing copied bare `HEAD`, workdir alternates, and origin remote URLs.
- `177e1a9 merge: remove active legacy naming` merges `96069b7 chore: remove active legacy naming`, keeping intentional compatibility references while making current product-facing naming Atlas-first.
- `4a74ce6 merge: update test dependencies for audit` merges `030b20c fix: update test dependencies for audit`, keeping `npm audit` clean without changing release posture.
- `d726772 merge: release hardening setup docs` merges `a7f4370 docs: harden release setup guidance`, adding setup, daemon/MCP, storage migration, and release checklist reference docs.
- `0a69318 merge: status sync after release docs` merges `a8a3ce2 docs: sync status after release docs`, keeping the guarded status front page moving with the release docs work.

## Next Actions
- Finish validating `codex/private-rc-readiness-fixes` with `npm audit`, `npm run validate:full`, daemon help/status checks, and guarded-doc read verification
- Confirm guarded `docs.read` output for `docs/README.md`, `STATUS.md`, `docs/atlas/setup.md`, and `docs/atlas/daemon-mcp.md` matches the intended source content
- Re-run the private RC readiness audit only after this blocker-fix branch lands cleanly
- Keep future storage migration hardening conservative, especially around reusable managed workdir self-healing

## Blockers
- Private RC readiness is still pending until guarded docs and release-facing docs are back in sync and this branch validates cleanly

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not tag, publish, or release without explicit approval
- Do not implement `docs.merge_branch` unless explicitly asked
- Do not implement proposal/diff/approval UI unless explicitly asked

## Related Documents
- [Documentation Overview](docs/README.md)
- [Setup](docs/atlas/setup.md)
- [Daemon & MCP Configuration](docs/atlas/daemon-mcp.md)
- [Storage Migration](docs/atlas/storage-migration.md)
- [Release Checklist](docs/atlas/release-checklist.md)
- [Implementation Checklist](docs/implementation-checklist.md)
