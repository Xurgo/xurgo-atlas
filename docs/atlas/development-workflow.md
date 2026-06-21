# Development Workflow

## Script Naming Convention

npm scripts follow a consistent category/scope naming scheme:

| Category | Purpose |
|----------|---------|
| `test:*` | Targeted test suites (unit, integration) |
| `validate:*` | Repo-level validation gates |
| `verify:*` | Installed / runtime user-flow checks |
| `bundle:*` | Local generated artifact bundles (private RC) |
| `release:*` | Release-readiness checks that do not mutate publication, Git, GitHub, or Atlas state |

## Commands Reference

### `npm run validate:quick`

**What it does:** Runs the fast test tier (`tests/package-bin-alias`, `mcp-metadata`, `cli-usage`, `registry`, `storage-migration`) plus `npm run build`.

**What it does NOT do:** Does not run integration tests (daemon, HTTP, lifecycle) or pack dry-run.

**When to use:** Default development loop — run after any change.

---

### `npm run validate:full`

**What it does:** Runs the full test suite, `npm run build`, and `npm pack --dry-run` to verify package contents.

**What it does NOT do:** Does not install the package into a consumer workspace or smoke-test runtime behavior. Does not tag, publish, or push.

**When to use:** Before risky merges or release-style checks.

**Toolchain note:** Maintainer, CI, validation, packing, and release-preparation commands use the internal `.nvmrc` toolchain, currently Node `22.17.0`. Run `nvm use` from the repo root before npm-based validation or packaging commands. If that exact runtime is unavailable, install or activate it through your normal Node manager before proceeding.

This internal maintainer toolchain is separate from public consumer compatibility. The package `engines` policy is unchanged here.

---

### `npm run verify:installed`

**What it does:** Builds the package, packs it into a `.tgz`, creates an isolated consumer workspace, installs the tarball there, and exercises the CLI, daemon, and MCP endpoints. All work happens in an OS temp workspace (`/tmp/xa-smoke-*`). Temp workspace is cleaned up on success.

**What it does NOT do:** Does not leave artifacts in the repo. Does not modify local dependencies.

**When to use:** After changes that affect CLI behavior, daemon lifecycle, MCP communication, or packaging — any time you want to verify the installed experience matches the source.

---

### `npm run bundle:private-rc`

**What it does:** Creates a private release-candidate artifact bundle under `artifacts/private-rc/<timestamp>-<short-head>/` with:

- `xurgo-atlas-*.tgz` — the packed package
- `SHA256SUMS.txt` — checksum of the tarball
- `MANIFEST.json` — file listing and validation metadata
- `PRIVATE_RC_SUMMARY.md` — build and smoke summary
- `PRIVATE_REVIEWER_CHECKLIST.md` — reviewer instructions
- `REVIEWER_INSTALL_SMOKE.mjs` — standalone install-and-smoke script
- `package.json` — bundle wrapper (marked `"private": true`)
- `.npmrc` — prevents npm from climbing into parent repo context

Before creating the bundle, the script runs full validation (clean tree, `git diff --check`, `npm audit`, `validate:full`, `verify:installed`).

**What it does NOT do:** It does not tag, publish, push, or create a GitHub release. The generated `package.json` in the bundle is a disposable wrapper — it is not the product package.

**When to use:** When you need a portable, reviewer-ready RC artifact for internal pre-release testing.

---

### `npm run release:preflight -- --stage=prepare`

**What it does:** Runs a fail-closed, read-only release preflight before user-operated npm publication. It validates repository identity, the `.nvmrc` Node runtime, command paths, clean worktree state, branch and `main` refs, package version, public npm state, version tag state, and GitHub release state.

**What it does NOT do:** Does not publish, version, commit, tag, push, fetch, reset, clean, check out branches, create GitHub releases, change configuration, or modify Atlas managed state. It reports expected-versus-actual evidence and one remediation for failures.

**When to use:** Before package verification and any public npm publication approval. The prepare stage requires the intended package version to be unpublished and the local tag, remote tag, and GitHub release to be absent.

---

### `npm run release:preflight -- --stage=finalize`

**What it does:** Runs the same read-only checks after the user-operated npm publication.

**What it does NOT do:** Does not create tags or GitHub releases. Those actions remain separate and require explicit authorization for the exact action.

**When to use:** After the user has completed public npm publication and before any separately authorized tag or GitHub release completion. The finalize stage requires the intended package version to be published while the local tag, remote tag, and GitHub release remain absent.

## Public Release Gate

`prepublishOnly` in `package.json` guards against accidental `npm publish`:

- If `npm_command` is not `publish` (e.g. `npm pack`, `npm pack --dry-run`), the guard passes silently — packaging workflows are never blocked.
- If `npm_command` is `publish`, the guard requires `XURGO_ATLAS_PUBLISH=1` in the environment. Without it, `npm publish` fails immediately with a clear message.

Public npm publication is always user-operated, including retries. Agents may run preflight, validation, packing/package verification, and post-publish read-only verification; they must not run `npm publish`.

Normal public sequence: agent preflight and package verification -> user-operated npm publication -> agent read-only publication verification -> separately authorized tag and GitHub release completion.

## When to Run What

| Scenario | Commands |
|----------|----------|
| Daily / local change | `npm run validate:quick` |
| Runtime or packaging change | `npm run validate:quick` and `npm run verify:installed` |
| Full private RC confidence | `npm audit` + `npm run validate:full` + `npm run verify:installed` + `npm run bundle:private-rc` |
| Public npm release | `npm run release:preflight -- --stage=prepare` + package verification -> user-operated npm publication -> `npm run release:preflight -- --stage=finalize` -> separately authorized tag/release completion |

## Artifact Locations

- **Verify workspace:** OS temp directory (`/tmp/xa-smoke-*`) — cleaned up on success.
- **Private RC bundles:** `artifacts/private-rc/<timestamp>-<short-head>/` — gitignored, do not commit.

## Reviewer Bundle Workflow

Inside a generated artifact bundle, run:

```bash
npm run smoke               # install + smoke + cleanup (via node script)
npm run smoke:keep           # preserve temp workspace for inspection
node REVIEWER_INSTALL_SMOKE.mjs       # direct invocation, no npm
node REVIEWER_INSTALL_SMOKE.mjs --keep # preserve temp workspace
```

The script creates an isolated temp consumer workspace, installs the `.tgz` into it, and runs basic smoke tests. Nothing is created inside the bundle directory itself.

## Why This Structure Exists

- **Source-only tests** are fast but cannot catch packaging, binary-path, daemon-lifecycle, or MCP-communication issues.
- **Installed-package verify** (`verify:installed`) packs and installs into a clean consumer workspace, exactly like an end user would do.
- **Artifact bundle** (`bundle:private-rc`) wraps the installed-package verify into a portable bundle with reviewer instructions, checksums, and a standalone script — so someone else can verify without running a full build.

## Managed-Doc Export Drift

Before commit, inspect all managed-doc/export changes. Do not keep drift just because export produced it. Classify unexpected managed-doc changes as required for the branch, valid managed-store/source synchronization, or stale drift to revert, and report that classification before commit.

## Boundaries

- No tag is created.
- No `npm publish` is run.
- No GitHub release is created.
- The artifact and preflight workflows are private / internal — not for public distribution.
- Generated bundles are gitignored and should not be committed.
