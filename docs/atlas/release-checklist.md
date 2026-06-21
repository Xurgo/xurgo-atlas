# Release Checklist

> **Status:** Public package release maintenance is gated. A passed documentation checkpoint, private RC review, managed-doc sync, or previous public release does not authorize a new release.
> Any public npm publish, tag, GitHub release, or release metadata change requires a separate release-readiness audit for the exact target commit and explicit approval for that action. Public npm publication is user-operated only; agents may prepare, package-verify, run read-only post-publish verification, and perform tag or GitHub release actions only when those actions are separately authorized.

## Release Authorization Gate

- [ ] A separate release-readiness audit has passed for the exact target commit and target environment
- [ ] Explicit approval has been given for the specific release action
- [ ] Current documentation checkpoints are treated as evidence only; they do not replace the release-readiness audit
- [ ] The current public package state has been verified before any new version, tag, publish, or GitHub release is prepared

## Internal Release Toolchain

- [ ] Maintainer, CI, validation, packing, and release-preparation commands are running on the `.nvmrc` runtime, currently Node `22.17.0`
- [ ] `nvm use` succeeds from the repository root before npm validation or release-preparation commands
- [ ] The internal Node `22.17.0` pin is treated as separate from public consumer compatibility; `package.json` `engines` remains the consumer policy

## Pre-Release Validation

- [ ] Working tree is clean (`git status --short`)
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No audit vulnerabilities (`npm audit`)
- [ ] No whitespace errors (`git diff --check HEAD`)
- [ ] Pack dry-run succeeds (`npm pack --dry-run`)
- [ ] Full validation passes (`npm run validate:full`)
- [ ] Release prepare preflight passes before user-operated npm publication (`npm run release:preflight -- --stage=prepare`)

## Documentation

- [ ] README is current and accurate
- [ ] Setup/install instructions are up to date ([docs/atlas/setup.md](./setup.md))
- [ ] Daemon/MCP configuration is documented ([docs/atlas/daemon-mcp.md](./daemon-mcp.md))
- [ ] Daemon/MCP configuration documents the current single-project-bound daemon behavior and does not present deferred topology work as available today
- [ ] Storage migration flow is documented ([docs/atlas/storage-migration.md](./storage-migration.md))
- [ ] Development workflow is documented ([docs/atlas/development-workflow.md](./development-workflow.md))
- [ ] Init templates are documented (available templates, `--template`, `-t`, `--templates`, existing-doc preservation)
- [ ] Project-resolution hardening tracker is current ([docs/atlas/project-resolution-hardening.md](./project-resolution-hardening.md))
- [ ] Release checklist is current
- [ ] Guarded docs are current: `STATUS.md`, `AGENTS.md`, `docs/manifest.yml`, `.docs-policy.yml`
- [ ] Managed `main`, source `main`, and the release working tree agree for release-facing docs; a clean Git tree alone is not enough for release readiness
- [ ] Git merges do not update Atlas-managed `main` automatically; if release-facing docs changed on a merged source branch, managed `main` has been reconciled separately before release
- [ ] After `docs.commit_patch` or `docs.restore_file`, Atlas-stored docs may be ahead of disk; use `docs.read` for the latest content and run `docs.export` before direct disk reads, Git commits, release prep, or publishing. If `docs.status`, `docs.preview_export`, or `docs.export` reports `exportRequired`, `workingTreeOutOfSync`, or `outOfSyncPaths`, treat export/reconciliation as the next step.

## Private RC Bundle Dummy-Project Reviewer Workflow

This workflow is a private readiness checkpoint for local reviewer confidence. It does not authorize version bumps, tagging, npm publication, GitHub releases, or release metadata changes.

- **Source repo:** run `npm run bundle:private-rc` here, keep the tree clean, and do not use this checkout as the dummy consumer project.
- **Private RC bundle directory:** use `artifacts/private-rc/<timestamp>-<short-head>/` as the generated artifact bundle. It contains `xurgo-atlas-<version>.tgz`, `PRIVATE_REVIEWER_CHECKLIST.md`, `REVIEWER_INSTALL_SMOKE.mjs`, `SHA256SUMS.txt`, `MANIFEST.json`, `PRIVATE_RC_SUMMARY.md`, and related bundle files. Run bundle-local `npm run smoke` here. Do not treat this directory as the project being documented.
- **Dummy consumer project:** use a fresh isolated project in the target environment, install the tarball with `npm install -D "$TARBALL"`, and review `npx xurgo-atlas` help, init, list, status, daemon, and MCP behavior here.

High-level command sequence:

```sh
BUNDLE_DIR="$(ls -td artifacts/private-rc/* | head -1)"
TARBALL="$(ls "$BUNDLE_DIR"/xurgo-atlas-*.tgz)"

cd "$BUNDLE_DIR"
npm run smoke

REVIEW_ROOT="$(mktemp -d)"
mkdir -p "$REVIEW_ROOT/dummy-consumer-project"
cd "$REVIEW_ROOT/dummy-consumer-project"
git init -b main
npm init -y
npm install -D "$TARBALL"
npx xurgo-atlas --help
npx xurgo-atlas list
npx xurgo-atlas init --template mcp-server --project-id dummy-rc-review
npx xurgo-atlas daemon start
npx xurgo-atlas list
npx xurgo-atlas status
npx xurgo-atlas mcp-config
```

- Expected pre-init `list` behavior: clear actionable error, no unhandled stack trace, and no `GitConstructError`.
- Project identity expectations: `init` writes a sticky local `.xurgo-atlas/project.json` marker, preserves it for the same project id, stores the project id only, and fails clearly instead of overwriting it with a different project id. Project ids remain globally unique in the registry.
- Expected daemon behavior after init: `npx xurgo-atlas daemon start` works from the dummy consumer project root without repeated flags, startup output shows the resolved project id, project root, and resolution source, and mismatched explicit `--project-id` / `--project-root` values fail clearly instead of silently serving another project.
- Wrong-directory recovery expectations: starting from a non-project directory fails clearly and tells the reviewer to move to the current project root or pass matching explicit flags for the intended project.
- Existing-doc preservation expectations: `STATUS.md`, `AGENTS.md`, and `docs/manifest.yml` are preserved; template init only creates missing docs.
- MCP/opencode verification expectations: verify through MCP tools only, do not read files directly from the filesystem for MCP verification, do not modify files, do not propose patches, and do not commit during reviewer verification.

## Storage

- [ ] Storage migration is complete for all active machines
- [ ] Legacy roots are archived (not deleted)
- [ ] Storage inspection shows expected state
- [ ] Init preserves a matching local marker and rejects conflicting project identity
- [ ] Project ids remain globally unique across registered roots
- [ ] Daemon auto-detects the current project from the local marker or an ancestor marker
- [ ] Daemon starts and serves the current project from an initialized project root
- [ ] Daemon startup and status output show the resolved project id, project root, and resolution source when available
- [ ] Daemon does not silently serve a mismatched explicit project id or registry default from the wrong directory
- [ ] Daemon rejects startup for a different project while another project-bound daemon is running
- [ ] Daemon MCP requests do not silently serve a different project than the daemon binding

## Naming

- [ ] No stale active legacy naming in CLI, help text, or current-facing docs
- [ ] Package binary exposes `xurgo-atlas` and `xurgo-atlas -v` / `--version` print one clean version line (legacy `docu-guard` alias may still exist for compatibility)
- [ ] `docs.*` MCP namespace remains unchanged
- [ ] Intentional legacy migration references are preserved where needed

## Release Steps

Current GitHub Actions CI runs `npm run validate:quick` on pull requests and pushes to `main` using the repository `.nvmrc` runtime. It does not tag, publish, or create GitHub releases.

Normal public sequence: agent preflight and package verification -> user-operated npm publication -> agent read-only publication verification -> separately authorized tag and GitHub release completion.

### Private RC (Local Bundle)

1. [ ] Run `npm run validate:full` on a clean working tree at the target commit
2. [ ] Run `npm run verify:installed` to confirm installed-package behavior
3. [ ] Run `npm run bundle:private-rc` to generate a reviewer-ready artifact bundle
4. [ ] Send the bundle directory (`artifacts/private-rc/<timestamp>-<short-head>/`) to reviewer
5. [ ] Reviewer runs `npm run smoke` inside the bundle directory, then verifies the dummy consumer project flow outside the bundle
6. [ ] Reviewer confirms the bundle checklist separates the source repo, bundle directory, and dummy consumer project
7. [ ] Reviewer marks approval (or documents issues found)

### Public npm Release Maintenance

1. [ ] Confirm the separate release-readiness audit has passed for the target commit and environment
2. [ ] Run `nvm use` from the repository root and verify Node matches `.nvmrc`
3. [ ] Confirm release-facing docs have managed `main`, source `main`, and working-tree parity
4. [ ] Update version in `package.json` only as part of an approved release change
5. [ ] Run `npm run release:preflight -- --stage=prepare`; the intended package version must be unpublished and local tag, remote tag, and GitHub release state must be absent
6. [ ] Run `npm run validate:full` on a clean working tree at the target commit
7. [ ] Run `npm run verify:installed` and `npm pack --dry-run` to confirm installed-package and package-content behavior
8. [ ] `LICENSE` file exists and `package.json` license field is `MIT`
9. [ ] Create the release commit
10. [ ] User completes public npm publication; agents must not run `npm publish`, including retries
11. [ ] Run `npm run release:preflight -- --stage=finalize`; the intended package version must be published while local tag, remote tag, and GitHub release state remain absent
12. [ ] Tag the release only after separate explicit authorization for the tag action
13. [ ] Push the release commit and tag only after separate explicit authorization for the push action
14. [ ] Create the GitHub release only after separate explicit authorization for the GitHub release action; current CI does not publish or create releases
15. [ ] Verify installed package works end-to-end (`npm install -g xurgo-atlas`)

## Post-Release Verification

- [ ] `npm install -g xurgo-atlas` succeeds
- [ ] `xurgo-atlas mcp-config` prints MCP endpoint and config snippet
- [ ] `xurgo-atlas --help` lists expected commands, and `xurgo-atlas -v` / `--version` print one clean version line
- [ ] MCP server starts in stdio mode
- [ ] Daemon starts and MCP endpoint responds
- [ ] Guarded docs workflow works end-to-end (list -> read -> propose -> preview -> commit)

---

> **Important:** Do not bump versions, tag, create a GitHub release, or alter release metadata until a separate release-readiness audit passes and explicit approval is given for the specific release action. Do not run `npm publish` as an agent action; public npm publication is user-operated only.
