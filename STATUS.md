---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Storage migration prep cleanup and validation speed tiers are merged, read-only `xurgo-atlas storage inspect` now reports Atlas-versus-legacy storage selection state without modifying files, and the next migration step should be a strictly read-only dry-run planning layer"
nextActions:
  - "Build a strictly read-only migration planning and dry-run layer on top of `inspectManagedStorage()` without adding write-capable migration behavior"
  - "Keep any apply/copy migration work deferred until the dry-run planning surface is stable and well validated"
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
Xurgo Atlas is the project-context and documentation-safety MCP. Package metadata now uses `xurgo-atlas`, published npm contents are explicitly allowlisted, daemon lifecycle commands and curated Atlas document ownership are implemented, and guarded create-only document proposals support adding new Atlas Markdown docs. Storage defaults now document and select Atlas config/data roots first, legacy-only `docu-guard` roots still fall back for compatibility, both-present states intentionally stay on Atlas roots without merging data, and project commands consistently thread `--data-dir` through storage-sensitive paths. The repo also now exposes faster validation tiers for day-to-day work and a read-only storage inspection command that makes migration planning visible without changing files. Managed docs branches remain intentionally independent from source repo branches, and export still refuses cross-branch sync drift instead of writing it silently.

## Current Focus
The v0.4 context tools, minimal read-only REST API, and hardened read-only web UI remain stabilized as a private milestone. The latest storage migration prep cleanup finished the Atlas-default documentation and CLI consistency pass: `README.md` now reflects `~/.config/xurgo-atlas` and `~/.local/share/xurgo-atlas`, legacy-only docu-guard roots still fall back, both-present states select Atlas roots with no merge, project-local pre-v0.3 `.docu-guard/` warning wording is clearer, and project subcommands now consistently pass through `--data-dir`. The default development loop should now prefer `npm run validate:quick`, while `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full` provide explicit speed tiers and keep full validation available for risky, pre-merge, or release-like checks. The new read-only `xurgo-atlas storage inspect` command reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence without migrating or modifying files. The reusable `inspectManagedStorage()` helper now provides the inspection surface that future migration work should build on. No write-capable storage migration exists yet; the next feature should be a strictly read-only migration planning and dry-run layer, with any apply/copy migration deferred until that planning surface is solid. Existing protections remain intact: traversal, malformed/prose/`apply_patch` input, stale base revisions, and non-applyable patch validation are still enforced, `.docs-policy.yml` protected-path risk and approval behavior still layers on top, the `docs.propose_document` create-only flow is unchanged, and branch-safe export still refuses cross-branch sync drift.

## Recently Completed
- `c3da6c5 merge: storage inspection command` adds read-only `xurgo-atlas storage inspect`, reports selected config/data roots, Atlas and legacy candidates, registry presence and project count, both-present status, and runtime artifact presence, explicitly avoids migration or file modification, and introduces the reusable `inspectManagedStorage()` helper for future migration planning work.
- `22a1488 merge: validation speed tiers` adds `npm run test:fast`, `npm run test:integration`, `npm run validate:quick`, and `npm run validate:full`, establishes `validate:quick` as the preferred default development loop, and keeps full validation available for riskier pre-merge or release-like checks.
- `7ddaaec merge: prepare storage migration cleanup` updates `README.md` to Atlas defaults, preserves legacy-only docu-guard fallback discovery, makes both-present states choose Atlas roots without merging, clarifies the pre-v0.3 project-local `.docu-guard/` warning wording, and makes project subcommands consistently pass through `--data-dir`.
- `ad1a0d1 refactor(runtime): clean up legacy docu-guard tokens` retitles safe current-runtime/internal tokens only: temp patch filenames now use xurgo-atlas branding, the init event label now uses `.xurgo-atlas/init`, AGENTS generated-content idempotency now recognizes atlas and legacy generated headers without relying on a loose `docu-guard` substring, and one internal storage comment now says Atlas-managed storage. Compatibility references were intentionally preserved for the temporary `docu-guard` bin alias, legacy storage discovery and diagnostics, project-local `.docu-guard` warnings, registry compatibility hints, and historical/spec docs. No physical storage migration was implemented. Validation passed with `npm test`, `npm run build`, and `npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run`.
- `ac61527 chore: define npm package contents` explicitly allowlists published package contents through `package.json` `files`, keeping the runtime package limited to `README.md`, `package.json`, and `dist/**`.

## Next Actions
- Build a strictly read-only migration planning and dry-run layer on top of `inspectManagedStorage()`
- Keep apply/copy migration work deferred until the dry-run planning surface is stable and well validated
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
