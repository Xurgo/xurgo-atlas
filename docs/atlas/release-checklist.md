# Release Checklist

> **Status:** Pre-release — do not publish without explicit approval.

## Pre-Release Validation

- [ ] Working tree is clean (`git status --short`)
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No audit vulnerabilities (`npm audit`)
- [ ] No whitespace errors (`git diff --check HEAD`)
- [ ] Pack dry-run succeeds (`npm pack --dry-run`)
- [ ] Full validation passes (`npm run validate:full`)

## Documentation

- [ ] README is current and accurate
- [ ] Setup/install instructions are up to date ([docs/setup.md](./setup.md))
- [ ] Daemon/MCP configuration is documented ([docs/daemon-mcp.md](./daemon-mcp.md))
- [ ] Daemon/MCP configuration documents single-project-bound daemon behavior for `0.1.0`
- [ ] Storage migration flow is documented ([docs/storage-migration.md](./storage-migration.md))
- [ ] Development workflow is documented ([docs/atlas/development-workflow.md](./development-workflow.md))
- [ ] Init templates are documented (available templates, `--template`, `-t`, `--templates`, existing-doc preservation)
- [ ] Project-resolution hardening tracker is current ([docs/project-resolution-hardening.md](./project-resolution-hardening.md))
- [ ] Release checklist is current
- [ ] Guarded docs are current: `STATUS.md`, `AGENTS.md`, `docs/manifest.yml`, `.docs-policy.yml`

## Private RC Bundle Dummy-Project Reviewer Workflow

- **Source repo:** run `npm run bundle:private-rc` here, keep the tree clean, and do not use this checkout as the dummy consumer project.
- **Private RC bundle directory:** use `artifacts/private-rc/<timestamp>-<short-head>/` as the generated artifact bundle. It contains `xurgo-atlas-0.1.0.tgz`, `PRIVATE_REVIEWER_CHECKLIST.md`, `REVIEWER_INSTALL_SMOKE.mjs`, `SHA256SUMS.txt`, `MANIFEST.json`, `PRIVATE_RC_SUMMARY.md`, and related bundle files. Run bundle-local `npm run smoke` here. Do not treat this directory as the project being documented.
- **Dummy consumer project:** use a fresh isolated project in the target environment, install the tarball with `npm install -D "$TARBALL"`, and review `npx xurgo-atlas` help, init, list, status, daemon, and MCP behavior here.

High-level command sequence:

```sh
BUNDLE_DIR="$(ls -td artifacts/private-rc/* | head -1)"
TARBALL="$BUNDLE_DIR/xurgo-atlas-0.1.0.tgz"

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
- [ ] Package binary exposes `xurgo-atlas` (legacy `docu-guard` alias may still exist for compatibility)
- [ ] `docs.*` MCP namespace remains unchanged
- [ ] Intentional legacy migration references are preserved where needed

## Release Steps

### Private RC (Local Bundle)

1. [ ] Run `npm run validate:full` on a clean working tree at the target commit
2. [ ] Run `npm run verify:installed` to confirm installed-package behavior
3. [ ] Run `npm run bundle:private-rc` to generate a reviewer-ready artifact bundle
4. [ ] Send the bundle directory (`artifacts/private-rc/<timestamp>-<short-head>/`) to reviewer
5. [ ] Reviewer runs `npm run smoke` inside the bundle directory, then verifies the dummy consumer project flow outside the bundle
6. [ ] Reviewer confirms the bundle checklist separates the source repo, bundle directory, and dummy consumer project
7. [ ] Reviewer marks approval (or documents issues found)

### Public npm Release

1. [ ] Run `npm run validate:full` on a clean working tree at the target commit
2. [ ] Run `npm run verify:installed` to confirm installed-package behavior
3. [ ] Confirm `XURGO_ATLAS_PUBLISH=1` is set in the environment — `prepublishOnly` blocks `npm publish` without it
4. [ ] `LICENSE` file exists and `package.json` license field is `MIT`
5. [ ] Update version in `package.json` (if releasing)
6. [ ] Create release commit
7. [ ] Tag the release
8. [ ] Push tag
9. [ ] Run `npm publish` (only with **explicit approval**, requires `XURGO_ATLAS_PUBLISH=1`)
10. [ ] Verify installed package works end-to-end (`npm install -g xurgo-atlas`)

## Post-Release Verification

- [ ] `npm install -g xurgo-atlas` succeeds
- [ ] `xurgo-atlas mcp-config` prints MCP endpoint and config snippet
- [ ] `xurgo-atlas --help` lists expected commands
- [ ] MCP server starts in stdio mode
- [ ] Daemon starts and MCP endpoint responds
- [ ] Guarded docs workflow works end-to-end (list → read → propose → preview → commit)

---

> **Important:** This project is not publicly released. Do not publish, tag, or release without explicit approval.
