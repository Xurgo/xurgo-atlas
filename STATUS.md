---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Private RC readiness audit passed as a conditional go for a private RC workflow in the active local development environment: source main and managed docs are aligned, validation is green, and the remaining work is follow-up hardening rather than blocker cleanup"
nextActions:
  - "A private RC workflow may proceed conditionally after this status sync; re-verify install and setup guidance in the active local development environment before broadening confidence"
  - "Keep legacy backup directories in place until more normal Atlas workflows complete, and keep storage migration conservative: `storage migrate --apply` remains copy-only, never deletes legacy roots, refuses populated or conflicting Atlas targets, skips runtime artifacts, validates copied stores, and repairs copied Git metadata as needed"
  - "Track future hardening separately: reusable managed workdirs should self-heal or be recreated when stored Git metadata points at missing legacy paths, and public-release-only polish such as publish guards or LICENSE / packaging cleanup remains later"
blockers:
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
The current focus is moving from blocker cleanup to a controlled private RC workflow in the active local development environment. `main` and `origin/main` are both at `eb9a758 merge: private rc readiness fixes`, the private RC readiness fixes have been merged and pushed, and the managed docs main read path was resynced afterward through the guarded restore workflow. A repeat read-only private RC readiness audit then verified that source `HEAD` and the Atlas-managed MCP read path match in substance for `STATUS.md`, `docs/README.md`, `docs/atlas/setup.md`, `docs/atlas/daemon-mcp.md`, `docs/atlas/storage-migration.md`, and `docs/atlas/release-checklist.md`.

The repeat audit passed as a conditional go for a private RC workflow in the active local development environment. Must-fix blockers before private RC: none. Validation passed cleanly: `npm audit` found 0 vulnerabilities, `npm run validate:full` passed, all 238 tests passed, the build passed, and `npm pack --dry-run` passed. CLI and daemon behavior also matched expectations: main help prints and exits, `daemon --help` prints help without binding or starting, and `daemon status` reports the existing daemon. MCP HTTP behavior and docs were rechecked together: `GET /mcp` may return `404`, `OPTIONS /mcp` may return `204`, raw `POST /mcp` without compatible `Accept` headers may return `406`, and full MCP request-body logging remains off by default unless `XURGO_ATLAS_DEBUG_MCP=1` is set.

Storage migration readiness is solid for a private RC. `xurgo-atlas storage migrate --apply` remains intentionally conservative and copy-only: it never deletes legacy roots, never overwrites or merges into populated or conflicting Atlas targets, skips runtime artifacts, validates copied stores, and repairs copied Git metadata such as bare `HEAD`, workdir alternates, and origin remote URLs. Existing protected-doc behavior remains intact: traversal, malformed or prose-only patch input, stale base revisions, and non-applyable patch validation are still enforced, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `eb9a758 merge: private rc readiness fixes` merges `9685855 fix: resolve private rc readiness blockers`, landing the release-facing setup/doc sync, daemon help, MCP endpoint guidance, and reduced default MCP request logging fixes on `main` and `origin/main`.
- Managed docs main was resynced after the merge via the guarded restore workflow so `docs.status` / `docs.read` now match the intended source `HEAD` content again for the key release-facing docs.
- A repeat read-only private RC readiness audit passed with a conditional-go recommendation for a private RC workflow in the active local development environment and confirmed validation, CLI/daemon behavior, MCP HTTP behavior, logging posture, package hygiene, and storage-migration readiness.
- `b4eb610 merge: storage migration apply copy` merges `73b0acb feat: add storage migration apply copy`, adding the first explicit write-capable storage migration slice as a conservative copy-only apply path.
- `615b1ef merge: storage migration git metadata repair` merges `d936032 fix: repair internal git metadata during storage migration`, repairing copied bare `HEAD`, workdir alternates, and origin remote URLs.
- `177e1a9 merge: remove active legacy naming` merges `96069b7 chore: remove active legacy naming`, keeping intentional compatibility references while making current product-facing naming Atlas-first.
- `4a74ce6 merge: update test dependencies for audit` merges `030b20c fix: update test dependencies for audit`, keeping `npm audit` clean without changing release posture.

## Next Actions
- Proceed with a private RC workflow conditionally in the active local development environment; re-verify install and setup behavior there before broadening confidence
- Keep legacy backup directories until more normal Atlas workflows complete, rather than cleaning them up early
- Keep future storage migration hardening conservative, especially around reusable managed workdir self-healing or clean recreation when stored Git metadata points at missing legacy paths
- Keep public-release-only hardening for later: publish guards and LICENSE / packaging polish if the project moves beyond a private RC

## Blockers
- None for a private RC workflow; no public tag, publish, or release should occur without explicit approval

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
