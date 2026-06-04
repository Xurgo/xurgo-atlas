---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Release hardening setup docs are merged and pushed, the macOS managed docs store can read the new Atlas release docs, and the next step is a release-candidate readiness audit with fresh install, daemon, and storage-doc verification before any private release action"
nextActions:
  - "Run a release-candidate readiness audit without tagging, publishing, or releasing: verify private checklist coverage, confirm validate:full and npm audit remain clean, and keep release actions gated on explicit approval"
  - "Verify install and setup guidance from the new docs/atlas release docs on macOS and again on CachyOS when returning there"
  - "Verify daemon and MCP setup from fresh instructions rather than an already-warmed local environment"
  - "Verify storage migration guidance against current CLI behavior, and defer any keep-vs-delete decision for legacy backup directories until more normal workflows have been exercised"
  - "Keep future storage migration work conservative and explicit: copy-only, never delete legacy roots, refuse populated Atlas targets, skip runtime artifacts, validate copied project stores, and leave legacy roots usable on failure"
blockers:
doNotDo:
  - "Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly"
  - "Do not tag, publish, or release without explicit approval"
  - "Do not implement docs.merge_branch or proposal/diff/approval UI unless explicitly requested"
relatedDocs:
  - docs/manifest.yml
  - docs/atlas/setup.md
  - docs/atlas/release-checklist.md
  - docs/atlas/storage-migration.md
lastUpdated: "2026-06-04"
---

# Project Status

## Project
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded create-only document proposals support adding new Atlas Markdown docs. Storage defaults now document and select Atlas config/data roots first, legacy-only `docu-guard` roots still fall back for compatibility, both-present states intentionally stay on Atlas roots without merging data, and project commands consistently thread `--data-dir` through storage-sensitive paths. The repo also now exposes faster validation tiers for day-to-day work, a read-only storage inspection command, and a read-only storage migration dry-run planner that makes migration state and future actions visible without changing files. Managed docs branches remain intentionally independent from source repo branches, `docs.propose_patch` now accepts standard unified diffs with clearer format guidance, and export still refuses cross-branch sync drift instead of writing it silently.

## Current Focus
The release hardening setup docs are now merged on `main` via `d726772 merge: release hardening setup docs`, carrying feature commit `a7f4370 docs: harden release setup guidance`. The repo now includes `docs/atlas/setup.md`, `docs/atlas/daemon-mcp.md`, `docs/atlas/storage-migration.md`, and `docs/atlas/release-checklist.md`, while `README.md` and `docs/README.md` were updated to point at the new material and `docs/manifest.yml` was updated through the guarded docs workflow. The macOS managed docs store can read all four new `docs/atlas/*` docs, `npm run validate:full` passed before merge, and `npm audit` reports zero vulnerabilities. No public release, tag, or publish step has occurred.

The next focus is a release-candidate readiness audit rather than new source features: verify the install/setup docs on macOS and again on CachyOS when returning there, verify daemon and MCP setup from fresh instructions, verify the storage migration docs against current CLI behavior, and prepare a private release checklist while keeping all release actions gated on explicit approval. Existing protections remain intact: traversal, malformed/prose/`apply_patch` input, stale base revisions, and non-applyable patch validation are still enforced, `.docs-policy.yml` protected-path risk and approval behavior still layers on top, the `docs.propose_document` create-only flow is unchanged, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `d726772 merge: release hardening setup docs` merges `a7f4370 docs: harden release setup guidance` into `main`, adds `docs/atlas/setup.md`, `docs/atlas/daemon-mcp.md`, `docs/atlas/storage-migration.md`, and `docs/atlas/release-checklist.md`, updates `README.md` and `docs/README.md` to point at the new docs, updates `docs/manifest.yml` through the guarded workflow, confirms the macOS managed docs store can read all four release docs, passes `npm run validate:full` before merge, and keeps `npm audit` at 0 vulnerabilities without any tag, publish, or release step.
- `7be26e5 merge: storage migration dry run` adds read-only `xurgo-atlas storage migrate --dry-run`, keeps non-dry-run `xurgo-atlas storage migrate` explicitly failing because write-capable migration is not implemented yet, reports no-legacy roots, legacy-only roots, Atlas-populated targets, both-present roots, partial legacy config/data states, registry presence and readable project counts, project ID conflicts, detectable registry `dataDir` mismatch, and runtime PID/log artifacts as skipped and left untouched, and summarizes blockers, warnings, future copy actions, future skip actions, and the next recommended action without performing writes or creating storage directories/files.
- `1e1c135 merge: propose patch unified diff support` updates `docs.propose_patch` to accept full git-style unified diffs, complete `--- path` / `+++ path` diffs, and complete `--- a/path` / `+++ b/path` diffs, while still rejecting empty or whitespace-only patches, prose-only input, `*** Begin Patch` envelopes, corrupt or truncated hunks, unsafe absolute or `..` header paths, and patches that touch files other than the declared guarded target. Error text now better explains supported and unsupported patch formats.
- `c3da6c5 merge: storage inspection command` adds read-only `xurgo-atlas storage inspect`, reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence, explicitly avoids migration or file modification, and introduces the reusable `inspectManagedStorage()` helper for future migration planning work.
- `22a1488 merge: validation speed tiers` adds `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full`, establishes `validate:quick` as the preferred default development loop, and keeps full validation available for riskier pre-merge or release-like checks.
- `7ddaaec merge: prepare storage migration cleanup` updates `README.md` to Atlas defaults, preserves legacy-only docu-guard fallback discovery, makes both-present states choose Atlas roots without merging, clarifies the pre-v0.3 project-local `.docu-guard/` warning wording, and makes project subcommands consistently pass through `--data-dir`.
- `ad1a0d1 refactor(runtime): clean up legacy docu-guard tokens` retitles safe current-runtime/internal tokens only: temp patch filenames now use xurgo-atlas branding, the init event label now uses `.xurgo-atlas/init`, AGENTS generated-content idempotency now recognizes atlas and legacy generated headers without relying on a loose `docu-guard` substring, and one internal storage comment now says Atlas-managed storage. Compatibility references were intentionally preserved for the temporary `docu-guard` bin alias, legacy storage discovery and diagnostics, project-local `.docu-guard` warnings, registry compatibility hints, and historical/spec docs. No physical storage migration was implemented. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.

## Next Actions
- Run a release-candidate readiness audit without tagging, publishing, or releasing
- Verify install and setup guidance from `docs/atlas/setup.md` on macOS and again on CachyOS when returning there
- Verify daemon and MCP setup from `docs/atlas/daemon-mcp.md` using fresh instructions
- Verify storage migration guidance in `docs/atlas/storage-migration.md` against current CLI behavior
- Decide whether to keep or delete legacy backup directories only after more normal workflows have been exercised
- Prepare a private release checklist from `docs/atlas/release-checklist.md`, but do not tag, publish, or release without explicit approval

## Blockers
- None currently

## Do Not Do
- Do not edit STATUS.md, manifest.yml, or .docs-policy.yml directly — always use docs.propose_patch
- Do not tag, publish, or release without explicit approval
- Do not implement `docs.merge_branch` unless explicitly asked
- Do not implement proposal/diff/approval UI unless explicitly asked

## Follow-Up Notes
- The macOS managed docs workdir had stale legacy `docu-guard` paths and was safely quarantined and regenerated during the managed-doc sync.
- A future hardening item should make managed reusable workdirs self-heal or be recreated when stored Git metadata still points at missing legacy paths.
- The CachyOS managed store may need a refresh when returning there, because it previously had a local `add-atlas-docs` managed branch during the `docs/atlas` sync attempt.

## Related Documents
- [Release Setup](docs/atlas/setup.md)
- [Daemon & MCP Configuration](docs/atlas/daemon-mcp.md)
- [Storage Migration](docs/atlas/storage-migration.md)
- [Release Checklist](docs/atlas/release-checklist.md)
- [Vision: Project Context MCP](docs/vision/project-context-mcp.md)
- [Xurgo Integration](docs/vision/xurgo-integration.md)
