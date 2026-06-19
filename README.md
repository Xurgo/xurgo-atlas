# Xurgo Atlas

Xurgo Atlas is a standalone, local-first documentation and project-context service for AI-assisted development. It governs project docs with auditable history, exposes that context through a CLI and MCP discovery boundary, and complements your repository instead of replacing Git as the source of truth.

## Quick Start

Install Xurgo Atlas globally for the normal CLI workflow:

```bash
npm install -g xurgo-atlas
```

After the global install, verify the CLI, initialize a project, and print the canonical MCP config:

```bash
xurgo-atlas --version
xurgo-atlas --help
xurgo-atlas init --template mcp-server --project-id my-project
xurgo-atlas daemon start
xurgo-atlas mcp-config --json
```

If you want to try Atlas without installing it first, or keep it pinned inside a repo, use `npx xurgo-atlas ...` instead. For project-local automation, install it as a dev dependency with `npm install -D xurgo-atlas`.

If you're working on Atlas itself, use this repository checkout and the local npm scripts here instead of relying on a previously globally installed copy.

You can sanity-check the installed CLI with `xurgo-atlas -v` or `xurgo-atlas --version`; both print one version line and exit `0`.

`init` writes a local `.xurgo-atlas/project.json` marker in the project root. That marker is sticky: rerunning `init` with the same project id is safe, but Atlas will fail clearly instead of silently rebinding the project root to a different id. Project ids are also globally unique in the registry, so `init` will refuse to register an existing id to a different root.

After init, the normal happy path can run from the project root or a nested subdirectory without repeating `--project-id` and `--project-root`. Explicit flags still work for advanced cases, but Atlas now fails clearly if an explicit project id conflicts with the current project marker or the provided `--project-root`.

## MCP Client Setup

Use `xurgo-atlas mcp-config` for human-readable setup instructions, or prefer `xurgo-atlas mcp-config --json` as the machine-readable integration contract for MCP clients. If you have not installed Atlas globally, prefix the commands with `npx`.

The preferred integration path is the daemon HTTP MCP endpoint at `/mcp`:

```bash
xurgo-atlas daemon start
xurgo-atlas mcp-config --json
```

`xurgo-atlas server` remains the legacy stdio-oriented MCP path for local or direct stdio integrations.

`xurgo-atlas mcp-config --json` does not modify project source files, managed docs, or Git state, but it may refresh local descriptive root-observation metadata used for runtime safety reporting.

After your client connects, trust live MCP discovery, especially `tools/list`, over static docs or local source checkout when they disagree. `docs.capabilities` is supplemental summary context only, not the authoritative tool registry. Atlas is optional for Studio and other consumers that want governed docs through MCP.

## What Atlas Is

Atlas is:

- standalone
- optional for consumers that want governed project docs through MCP
- local-first
- a governed documentation and durable project-context service
- usable through its CLI and MCP discovery boundary
- not a replacement for Git or repository truth

Atlas is not:

- an agent runtime
- a required dependency for another product
- a workspace manager
- a session or run store
- a general memory database
- a semantic or vector retrieval service today
- a lock server today
- a replacement for Git or repository truth

## License

MIT — see [LICENSE](LICENSE) for the full text.

For detailed setup instructions, see [docs/atlas/setup.md](docs/atlas/setup.md).
For daemon and MCP client configuration, see [docs/atlas/daemon-mcp.md](docs/atlas/daemon-mcp.md).
For storage migration guidance, see [docs/atlas/storage-migration.md](docs/atlas/storage-migration.md).
For pre-release validation, see [docs/atlas/release-checklist.md](docs/atlas/release-checklist.md).

## Feedback

Xurgo Atlas is an early pre-release project in a public repository. Feedback is welcome, especially bug reports, setup issues, MCP client compatibility notes, and docs corrections.

If something is confusing, broken, or does not work in your environment, please open an issue.

## Contributing

Small docs fixes and targeted test improvements are welcome.

For larger or behavior-changing work, please open an issue first, especially for MCP tool contract changes, storage changes, root/worktree safety changes, managed-doc write/export changes, release-related changes, or security-sensitive filesystem behavior.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the short contribution policy.

## Security

Please do not report security issues in public issues. See [SECURITY.md](SECURITY.md).

## Development

If you're working on Atlas itself, use this repository checkout and the local npm scripts here. The detailed validation, smoke-testing, and private RC workflow lives in [docs/atlas/development-workflow.md](docs/atlas/development-workflow.md) and [docs/atlas/release-checklist.md](docs/atlas/release-checklist.md).

### Init Templates

`xurgo-atlas init` supports optional documentation templates for bootstrapping project docs:

```bash
# List available templates
xurgo-atlas init --templates

# Initialize with a template
xurgo-atlas init --template saas --project-id my-project

# Short form
xurgo-atlas init -t mcp-server --project-id my-project
```

Templates are **documentation templates** (not app-code scaffolds). They create missing project docs only and preserve existing files:

- `default` — Generic project
- `saas` — SaaS product
- `cli-tool` — CLI tool
- `mcp-server` — MCP server
- `web-app` — Web application

For a cloned repo that already has project docs, omit `--template`. The template flag is useful for new/empty projects or when intentionally filling missing docs.

## How Xurgo Atlas Works

Xurgo Atlas provides a CLI for direct project management and an MCP server for tools that need safe documentation operations. The daemon mode is the preferred HTTP transport: it resolves the current project from the local marker, an ancestor marker, or an explicit registration, so the normal start command works from inside an initialized project without repeating flags. If the current directory resolves to one project and explicit flags point at another, startup fails clearly instead of silently serving the wrong project.

`xurgo-atlas server` remains the legacy stdio-oriented path for direct local integrations.

### Managed storage (advanced)

Managed state (Git repositories, event logs) lives outside the project tree in configurable directories. The defaults (`~/.config/xurgo-atlas` and `~/.local/share/xurgo-atlas`) work for most users.

| Path | Default | Content |
|------|---------|---------|
| `<configDir>/projects.json` | `~/.config/xurgo-atlas/projects.json` | Global project registry |
| `<dataDir>/projects/<id>/repo.git` | `~/.local/share/xurgo-atlas/projects/<id>/repo.git` | Git bare repository (docs history) |
| `<dataDir>/projects/<id>/events.sqlite` | `~/.local/share/xurgo-atlas/projects/<id>/events.sqlite` | Event/proposal database |

Override defaults with `--config-dir` and `--data-dir` CLI flags on `init`, `server`, `daemon`, and `project` commands, or set `XURGO_ATLAS_CONFIG_DIR` / `XURGO_ATLAS_DATA_DIR` environment variables for CI, containers, or isolated testing.

Legacy `docu-guard` roots are auto-discovered for migration compatibility. Use `xurgo-atlas status` to check your current setup. See [docs/atlas/storage-migration.md](docs/atlas/storage-migration.md) for legacy migration (advanced/admin).

Each initialized project also gets a local `.xurgo-atlas/project.json` marker that records the project id only. That marker lets later commands find the current project from the project root or a nested subdirectory without storing an absolute project root in the repo. Atlas preserves a matching marker, refuses to overwrite a conflicting marker, and refuses to register the same project id to multiple roots.

### Global project registry

The daemon mode uses a global project registry at `<configDir>/projects.json` to map project IDs to project roots. The registry may record multiple projects, but each running daemon instance is bound to one resolved project/root at a time. The location is configurable with `--config-dir`.

### Git-backed docs history

All documentation files are stored in a Git repository. Every committed patch becomes a Git commit, providing a full history of changes.

### SQLite event/proposal storage

Proposals (patches awaiting commitment) and events (audit trail of actions) are stored in an SQLite database for fast querying and integrity.

### Branch/proposal workflow

The typical workflow for making documentation changes is:
1. List files (`docs.list`)
2. Read a file (`docs.read`) to get its current content and `baseRevision`
3. Create a new branch (`docs.create_branch`) for isolated changes
4. Propose a patch (`docs.propose_patch`) with the `baseRevision` obtained from the read step
5. Preview the diff (`docs.preview_diff`) to review changes and risk level
6. Commit the patch (`docs.commit_patch`) to apply changes to the branch
7. Export the branch (`docs.export`) to synchronize changes back to the working tree (optional)

### baseRevision safety

The `baseRevision` ensures that patches are based on the latest known version of a file. If the file has been modified since the `baseRevision` was obtained, the patch will be rejected as stale, preventing lost updates.

### Export back to working tree

The `docs.export` tool can export a branch to a target directory, allowing users to synchronize the Git-managed documentation back to their working tree.

### What agents should and should not do

**Agents should:**
- Use the MCP tools for all documentation interactions.
- Always read a file before proposing a change to obtain the correct `baseRevision`.
- Work on isolated branches created via `docs.create_branch`.
- Preview diffs to understand risk and approval requirements.
- Commit proposals only after review.
- Respect the documentation policy (e.g., not attempting to modify protected files without approval).

**Agents should not:**
- Edit documentation files directly on disk.
- Bypass the proposal workflow by attempting to commit patches without review.
- Ignore stale base revision errors.
- Attempt to traverse outside the project scope (e.g., using `../` paths).

## MCP Tool Reference

Use [docs/atlas/daemon-mcp.md](docs/atlas/daemon-mcp.md) as the canonical public reference for the supported CLI and MCP surface.

The safe discovery order is:

1. Run `xurgo-atlas mcp-config --json` to get the client connection boundary and current root-safety metadata.
2. Connect to the configured daemon or stdio server.
3. Trust live MCP `tools/list` for the actual tool surface exposed by that running server.
4. Treat `docs.capabilities` as supplemental summary context only.

This matters because a checked-out source tree, static docs, and an already-running daemon can drift. If they disagree, clients should follow the connected server's `tools/list` result.

## Managing documentation safely

When Atlas is changing managed docs, the safe path is simple:

1. Read the current document first so you know the live revision.
2. Use `docs.propose_patch` to edit an existing managed doc.
3. Use `docs.propose_document` to create a new managed doc, or to repair a missing managed doc that is already listed in the manifest.
4. Preview the diff with `docs.preview_diff`.
5. Commit the change through Atlas with `docs.commit_patch`.
6. Check that the manifest still validates after the change.

Archived or historical docs may not all be active manifest-managed docs, but public-facing documentation should still avoid stale commands, personal machine paths, and misleading old names.
