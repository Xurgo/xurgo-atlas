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
- [ ] Storage migration flow is documented ([docs/storage-migration.md](./storage-migration.md))
- [ ] Development workflow is documented ([docs/atlas/development-workflow.md](./development-workflow.md))
- [ ] Init templates are documented (available templates, `--template`, `-t`, `--templates`, existing-doc preservation)
- [ ] Release checklist is current
- [ ] Guarded docs are current: `STATUS.md`, `AGENTS.md`, `docs/manifest.yml`, `.docs-policy.yml`

## Private RC Workflow

- [ ] Generated `PRIVATE_REVIEWER_CHECKLIST.md` covers bundle smoke, clone/install project test, template guidance, and MCP/opencode verification
- [ ] Clone/install workflow: install tarball into cloned project, verify CLI, daemon, and MCP
- [ ] Template guidance explains when to use or omit `--template` and that existing docs are preserved
- [ ] MCP verification prompt instructs reviewer to verify through MCP tools, not filesystem reads
- [ ] Bundle-local `npm run smoke` and `npm run smoke:keep` are the recommended reviewer commands
- [ ] No stale repo-level command names (`smoke:installed`, `smoke:happy-path`, `artifact:private-rc`, `rc:private`) appear in generated docs

## Storage

- [ ] Storage migration is complete for all active machines
- [ ] Legacy roots are archived (not deleted)
- [ ] Storage inspection shows expected state
- [ ] Daemon starts and serves projects correctly

## Naming

- [ ] No stale active legacy naming in CLI, help text, or current-facing docs
- [ ] Package binary exposes `xurgo-atlas` (legacy `docu-guard` alias may still exist for compatibility)
- [ ] `docs.*` MCP namespace remains unchanged
- [ ] Intentional legacy migration references are preserved where needed

## Release Steps

1. [ ] Run `npm run validate:full` on a clean working tree at the target commit
2. [ ] Update version in `package.json` (if releasing)
3. [ ] Create release commit
4. [ ] Tag the release
5. [ ] Push tag
6. [ ] Publish to npm (only with **explicit approval**)
7. [ ] Verify installed package works end-to-end

## Post-Release Verification

- [ ] `npm install -g xurgo-atlas` succeeds
- [ ] `xurgo-atlas mcp-config` prints MCP endpoint and config snippet
- [ ] `xurgo-atlas --help` lists expected commands
- [ ] MCP server starts in stdio mode
- [ ] Daemon starts and MCP endpoint responds
- [ ] Guarded docs workflow works end-to-end (list → read → propose → preview → commit)

---

> **Important:** This project is not publicly released. Do not publish, tag, or release without explicit approval.
