---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Unified diff support for docs.propose_patch and the read-only storage migration dry-run planner are merged, no write-capable storage migration exists yet, and the next step should be cautious planning for the first explicit apply/copy migration slice"
nextActions:
  - "Plan the first write-capable storage migration slice conservatively: copy-only, never delete legacy roots, refuse populated Atlas targets, skip runtime artifacts, validate copied project stores, and leave legacy roots usable on failure"
  - "Keep write-capable migration explicit and conservative, and do not broaden beyond the first safe apply/copy slice until that path is proven stable"
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
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded create-only document proposals support adding new Atlas Markdown docs. Storage defaults now document and select Atlas config/data roots first, legacy-only `docu-guard` roots still fall back for compatibility, both-present states intentionally stay on Atlas roots without merging data, and project commands consistently thread `--data-dir` through storage-sensitive paths. The repo also now exposes faster validation tiers for day-to-day work, a read-only storage inspection command, and a read-only storage migration dry-run planner that makes migration state and future actions visible without changing files. Managed docs branches remain intentionally independent from source repo branches, `docs.propose_patch` now accepts standard unified diffs with clearer format guidance, and export still refuses cross-branch sync drift instead of writing it silently.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI remain stabilized as a private milestone. The latest guarded-docs work broadens `docs.propose_patch` input compatibility so it now accepts full git-style unified diffs, complete unified diffs with `--- path` / `+++ path`, and complete unified diffs with `--- a/path` / `+++ b/path`, while still rejecting empty or prose-only input, `*** Begin Patch` envelopes, corrupt hunks, unsafe header paths, and patches that touch files outside the declared guarded target. Error messages now better explain accepted versus unsupported patch formats. The latest storage migration work adds read-only `xurgo-atlas storage migrate --dry-run`, built on top of `inspectManagedStorage()`, and reports no-legacy, legacy-only, Atlas-populated, both-present, partial config/data, registry-count, project-conflict, registry `dataDir` mismatch, and runtime artifact conditions along with blockers, warnings, future copy actions, future skip actions, and the next recommended action. Dry-run performs no writes, creates no directories or files, and leaves runtime PID/log artifacts untouched. No write-capable storage migration exists yet; the next step should be cautious planning for the first explicit apply/copy slice, keeping behavior copy-only, never deleting legacy roots, refusing populated Atlas targets, skipping runtime artifacts, validating copied project stores, and leaving legacy roots usable if migration fails. Existing protections remain intact: traversal, malformed/prose/`apply_patch` input, stale base revisions, and non-applyable patch validation are still enforced, `.docs-policy.yml` protected-path risk and approval behavior still layers on top, the `docs.propose_document` create-only flow is unchanged, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `7be26e5 merge: storage migration dry run` adds read-only `xurgo-atlas storage migrate --dry-run`, keeps non-dry-run `xurgo-atlas storage migrate` explicitly failing because write-capable migration is not implemented yet, reports no-legacy roots, legacy-only roots, Atlas-populated targets, both-present roots, partial legacy config/data states, registry presence and readable project counts, project ID conflicts, detectable registry `dataDir` mismatch, and runtime PID/log artifacts as skipped and left untouched, and summarizes blockers, warnings, future copy actions, future skip actions, and the next recommended action without performing writes or creating storage directories/files.
- `1e1c135 merge: propose patch unified diff support` updates `docs.propose_patch` to accept full git-style unified diffs, complete `--- path` / `+++ path` diffs, and complete `--- a/path` / `+++ b/path` diffs, while still rejecting empty or whitespace-only patches, prose-only input, `*** Begin Patch` envelopes, corrupt or truncated hunks, unsafe absolute or `..` header paths, and patches that touch files other than the declared guarded target. Error text now better explains supported and unsupported patch formats.
- `c3da6c5 merge: storage inspection command` adds read-only `xurgo-atlas storage inspect`, reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence, explicitly avoids migration or file modification, and introduces the reusable `inspectManagedStorage()` helper for future migration planning work.
- `22a1488 merge: validation speed tiers` adds `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full`, establishes `validate:quick` as the preferred default development loop, and keeps full validation available for riskier pre-merge or release-like checks.
- `7ddaaec merge: prepare storage migration cleanup` updates `README.md` to Atlas defaults, preserves legacy-only docu-guard fallback discovery, makes both-present states choose Atlas roots without merging, clarifies the pre-v0.3 project-local `.docu-guard/` warning wording, and makes project subcommands consistently pass through `--data-dir`.
- `ad1a0d1 refactor(runtime): clean up legacy docu-guard tokens` retitles safe current-runtime/internal tokens only: temp patch filenames now use xurgo-atlas branding, the init event label now uses `.xurgo-atlas/init`, AGENTS generated-content idempotency now recognizes atlas and legacy generated headers without relying on a loose `docu-guard` substring, and one internal storage comment now says Atlas-managed storage. Compatibility references were intentionally preserved for the temporary `docu-guard` bin alias, legacy storage discovery and diagnostics, project-local `.docu-guard` warnings, registry compatibility hints, and historical/spec docs. No physical storage migration was implemented. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.

## Next Actions
- Plan the first write-capable storage migration slice conservatively: copy-only, never delete legacy roots, refuse populated Atlas targets, skip runtime artifacts, validate copied project stores, and leave legacy roots usable on failure
- Keep write-capable migration explicit and conservative, and do not broaden beyond the first safe apply/copy slice until that path is proven stable
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
