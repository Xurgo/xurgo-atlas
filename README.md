# Xurgo Atlas

Xurgo Atlas is a local project context server for AI-assisted development.

## Quick Start

Install Xurgo Atlas globally for the normal CLI workflow:

```bash
npm install -g xurgo-atlas
```

After the global install, initialize a project and start the daemon-backed MCP endpoint:

```bash
xurgo-atlas init --template mcp-server --project-id my-project
xurgo-atlas daemon start
xurgo-atlas mcp-config
xurgo-atlas mcp-config --json
```

If you want to try Atlas without installing it first, or keep it pinned inside a repo, use `npx xurgo-atlas ...` instead. For project-local automation, install it as a dev dependency with `npm install -D xurgo-atlas`.

`init` writes a local `.xurgo-atlas/project.json` marker in the project root. That marker is sticky: rerunning `init` with the same project id is safe, but Atlas will fail clearly instead of silently rebinding the project root to a different id. Project ids are also globally unique in the registry, so `init` will refuse to register an existing id to a different root.

After init, the normal happy path can run from the project root or a nested subdirectory without repeating `--project-id` and `--project-root`. Explicit flags still work for advanced cases, but Atlas now fails clearly if an explicit project id conflicts with the current project marker or the provided `--project-root`.

## MCP Client Setup

Use `xurgo-atlas mcp-config` for human-readable setup instructions, or prefer `xurgo-atlas mcp-config --json` as the machine-readable integration contract for Xurgo Agent and other MCP clients. If you have not installed Atlas globally, prefix the commands with `npx`.

The preferred integration path is the daemon HTTP MCP endpoint at `/mcp`:

```bash
xurgo-atlas daemon start
xurgo-atlas mcp-config --json
```

`xurgo-atlas server` remains the legacy stdio-oriented MCP path for local or direct stdio integrations.

## License

MIT — see [LICENSE](LICENSE) for the full text.

For detailed setup instructions, see [docs/atlas/setup.md](docs/atlas/setup.md).
For daemon and MCP client configuration, see [docs/atlas/daemon-mcp.md](docs/atlas/daemon-mcp.md).
For storage migration guidance, see [docs/atlas/storage-migration.md](docs/atlas/storage-migration.md).
For pre-release validation, see [docs/atlas/release-checklist.md](docs/atlas/release-checklist.md).

## Maintainer Notes

For maintainers validating private release candidates before a public publish, the repo still includes the `bundle:private-rc` workflow for producing a portable reviewer tarball. That workflow is not the primary install path for end users now that Xurgo Atlas is publicly available on npm.

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

Xurgo Atlas provides a CLI for direct project management and an MCP server for agents that need safe documentation operations. The daemon mode is the preferred HTTP transport: it resolves the current project from the local marker, an ancestor marker, or an explicit registration, so the normal start command works from inside an initialized project without repeating flags. If the current directory resolves to one project and explicit flags point at another, startup fails clearly instead of silently serving the wrong project.

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

The daemon mode uses a global project registry at `<configDir>/projects.json` to map project IDs to project roots, allowing the daemon to serve multiple projects without knowing their paths in advance. The location is configurable with `--config-dir`.

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

The current 0.1.1 public tool surface is:

- `docs.status`
- `docs.manifest`
- `docs.read`
- `docs.read_section`
- `docs.context_pack`
- `docs.list`
- `docs.create_branch`
- `docs.propose_patch`
- `docs.propose_document`
- `docs.preview_diff`
- `docs.commit_patch`
- `docs.history`
- `docs.restore_file`
- `docs.export`

For setup examples and workflow details, see [docs/atlas/daemon-mcp.md](docs/atlas/daemon-mcp.md) and [docs/README.md](docs/README.md).

### docs.list
**Purpose:** List all tracked documentation files in a branch.
**Typical use:** Discover what files are available in a project.
**Input:**
```json
{
  "projectId": "string (required)",
  "branch": "string (optional, defaults to \"main\")"
}
```
**Output:**
```json
{
  "projectId": "string",
  "branch": "string",
  "revision": "string (Git commit hash of the branch HEAD)",
  "files": [
    {
      "path": "string (file path relative to project root)",
      "revision": "string (Git commit hash for the file)",
      "protected": "boolean (whether the file is protected by policy)"
    }
  ]
```
**Safety behavior:** Read-only operation; no side effects.
**Common errors:** 
- Invalid projectId
- Invalid branch name

### docs.read
**Purpose:** Read a documentation file from a specific branch.
**Typical use:** Obtain the current content and revision of a file before proposing changes.
**Input:**
```json
{
  "projectId": "string (required)",
  "path": "string (required, file path relative to project root)",
  "branch": "string (optional, defaults to \"main\")"
}
```
**Output:**
```json
{
  "projectId": "string",
  "path": "string",
  "branch": "string",
  "revision": "string (Git commit hash for the file)",
  "content": "string (file content)"
}
```
**Error output:**
```json
{
  "error": "string (description of the error)",
  "projectId": "string",
  "path": "string",
  "branch": "string"
}
```
**Safety behavior:** Read-only operation; no side effects.
**Common errors:**
- File not found
- Path traversal detected
- Invalid projectId or branch

### docs.create_branch
**Purpose:** Create a new branch for making documentation changes.
**Typical use:** Create an isolated workspace for a set of changes.
**Input:**
```json
{
  "projectId": "string (required)",
  "branch": "string (required, name of the new branch)",
  "from": "string (optional, defaults to \"main\", name of the source branch)"
}
```
**Output:**
```json
{
  "projectId": "string",
  "branch": "string",
  "from": "string",
  "created": "boolean (true if branch was created)",
  "revision": "string (Git commit hash of the new branch HEAD)"
}
```
**Error output:**
```json
{
  "error": "string (description of the error, e.g., branch already exists or source branch does not exist)",
  "projectId": "string",
  "branch": "string",
  "from": "string"
}
```
**Safety behavior:** Creates a new Git branch; no risk of data loss.
**Common errors:**
- Branch already exists
- Source branch does not exist

### docs.propose_patch
**Purpose:** Propose a patch to a documentation file. Validates the patch against policy and checks for risks. Does not apply the change.
**Typical use:** Submit a change for review before committing.
**Input:**
```json
{
  "projectId": "string (required)",
  "branch": "string (required)",
  "path": "string (required, file path relative to project root)",
  "baseRevision": "string (required, revision of the file at the time of reading)",
  "patch": "string (required, unified diff format)",
  "intent": "string (required, purpose of the change)",
  "summary": "string (required, brief summary of the change)"
}
```
Accepted patch formats include full git-style unified diffs from `git diff`, complete unified diffs with `--- path` / `+++ path` headers, and complete unified diffs with `--- a/path` / `+++ b/path` headers. Prose-only text, OpenAI `*** Begin Patch` envelopes, and truncated or corrupt hunks are rejected.
**Output:**
```json
{
  "proposalId": "string (unique identifier for the proposal)",
  "valid": "boolean (true if proposal passed validation)",
  "riskLevel": "string (\"high\" or \"low\")",
  "requiresApproval": "boolean (true if the patch is high-risk and requires explicit approval)",
  "summary": "string (the summary from input)",
  "changedFiles": ["string (array containing the path)"],
  "projectId": "string",
  "branch": "string",
  "message": "string (human-readable status message)"
}
```
**Error output:**
```json
{
  "error": "string (description of the validation error)",
  "projectId": "string",
  "path": "string",
  "branch": "string",
  "proposalId": "string (if applicable)"
}
```
**Safety behavior:** 
- Validates the patch against the documentation policy.
- Checks for forbidden operations (e.g., silent deletion, whole-file replacement without baseRevision).
- Assesses risk (e.g., large deletions, heading removals).
- Does not modify the repository.
**Common errors:**
- Base revision mismatch (file has been modified since read)
- Path not in tracked documentation paths
- Missing required metadata
- Path traversal detected
- Branch does not exist
- Forbidden operation detected (based on policy)
- High-risk changes requiring approval (if riskOverride not provided)
- AGENTS.md modifications require explicit reference to safety rules in intent/summary

### docs.preview_diff
**Purpose:** Preview the diff for a previously proposed patch by proposalId.
**Typical use:** Review the exact changes and risk level before committing.
**Input:**
```json
{
  "projectId": "string (required)",
  "proposalId": "string (required)"
}
```
**Output:**
```json
{
  "proposalId": "string",
  "diff": "string (the unified diff that was proposed)",
  "riskLevel": "string (\"high\" or \"low\")",
  "requiresApproval": "boolean",
  "projectId": "string",
  "path": "string (file path)",
  "branch": "string",
  "summary": "string (proposal summary)"
}
```
**Error output:**
```json
{
  "error": "string (description of the error, e.g., proposal not found or not pending)",
  "projectId": "string",
  "proposalId": "string"
}
```
**Safety behavior:** Read-only operation; no side effects.
**Common errors:**
- Proposal not found
- Proposal not in pending status (may be committed, rejected, or stale)

### docs.commit_patch
**Purpose:** Commit a previously proposed patch by proposalId. Re-validates the base revision before applying.
**Typical use:** Apply a proposed patch after review.
**Input:**
```json
{
  "projectId": "string (required)",
  "proposalId": "string (required)",
  "actor": "string (optional, defaults to \"unknown\", identifier of the committer)",
  "riskOverride": "string (optional, must be \"accept\" to override high-risk rejection)"
}
```
**Output:**
```json
{
  "proposalId": "string",
  "commit": "string (Git commit hash of the new commit)",
  "changedFiles": ["string (array containing the path)"],
  "projectId": "string",
  "branch": "string",
  "message": "string (human-readable status message)"
}
```
**Error output:**
```json
{
  "error": "string (description of the error, e.g., proposal not found, not pending, stale base revision, or high-risk without override)",
  "projectId": "string",
  "proposalId": "string",
  "path": "string",
  "branch": "string"
}
```
**Safety behavior:**
- Re-validates the base revision to prevent lost updates.
- Re-applies risk assessment (high-risk patches require `riskOverride: "accept"`).
- Applies the patch as a Git commit.
- Logs the commit event to the event log.
**Common errors:**
- Proposal not found
- Proposal not pending (may be already committed, rejected, or stale)
- Base revision mismatch (stale proposal)
- High-risk patch requires `riskOverride: "accept"`
- Validation errors (same as propose_patch)

### docs.history
**Purpose:** View the Git history for a documentation file.
**Typical use:** See past changes to a file.
**Input:**
```json
{
  "projectId": "string (required)",
  "path": "string (required, file path relative to project root)",
  "branch": "string (optional)",
  "limit": "number (optional, defaults to 50, maximum number of history entries to return)"
}
```
**Output:**
```json
{
  "projectId": "string",
  "path": "string",
  "history": [
    {
      "revision": "string (Git commit hash)",
      "timestamp": "string (ISO 8601 timestamp)",
      "actor": "string (author of the change)",
      "summary": "string (commit message or proposal summary)"
    }
  ]
}
```
**Safety behavior:** Read-only operation; no side effects.
**Common errors:**
- File not found
- Invalid projectId or branch

### docs.restore_file
**Purpose:** Restore a file to a previous revision from history.
**Typical use:** Undo changes by reverting a file to an earlier state.
**Input:**
```json
{
  "projectId": "string (required)",
  "path": "string (required, file path relative to project root)",
  "revision": "string (required, Git commit hash to restore to)",
  "branch": "string (optional, defaults to \"main\")",
  "intent": "string (required, purpose of the restore)"
}
```
**Output:**
```json
{
  "restored": "boolean (true if file was restored)",
  "path": "string",
  "branch": "string",
  "commit": "string (Git commit hash of the new commit)",
  "projectId": "string",
  "revision": "string"
}
```
**Error output:**
```json
{
  "error": "string (description of the error, e.g., revision not found or path traversal)",
  "projectId": "string",
  "path": "string",
  "revision": "string",
  "branch": "string"
}
```
**Safety behavior:** 
- Validates that the revision exists.
- Prevents path traversal.
- Records the restore action in the event log.
**Common errors:**
- Revision not found for file
- Path traversal detected
- Invalid projectId or branch

### docs.export
**Purpose:** Export documentation from a branch to a target directory.
**Typical use:** Synchronize Git-managed documentation back to the working tree.
**Input:**
```json
{
  "projectId": "string (required)",
  "branch": "string (optional, defaults to \"main\")",
  "targetDir": "string (optional, defaults to project root)"
}
```
**Output:**
```json
{
  "exported": "boolean (true if export succeeded)",
  "branch": "string",
  "files": ["string (array of exported file paths)"],
  "projectId": "string",
  "targetDir": "string",
  "revision": "string (Git commit hash of the branch HEAD)"
}
```
**Safety behavior:** Read-only operation; modifies only the target directory (not the repository).
**Common errors:**
- Invalid projectId or branch
- Target directory not writable

## Agent Workflow

The canonical safe workflow for agents to modify documentation is:

1. Orient with `docs.status`, `docs.manifest`, `docs.read`, `docs.read_section`, or `docs.context_pack`.
2. Create an isolated branch with `docs.create_branch` when you need branch-scoped changes.
3. Use `docs.propose_patch` for edits to existing docs or `docs.propose_document` for new managed Markdown files under `docs/atlas/**`.
4. Preview the diff with `docs.preview_diff`.
5. Commit the proposal with `docs.commit_patch`.
6. Export the branch with `docs.export` if you want to sync it back to the working tree.

`docs.propose_document` is the safest current path for new Atlas-managed docs, including repair/recreation when the manifest already lists a managed path but the file is missing.

## Validation & Artifact Workflow

The project uses a layered command convention for validation, smoke testing, and artifact generation:

| Command | Purpose |
|---------|---------|
| `npm run validate:quick` | Fast tests + build — default dev loop |
| `npm run validate:full` | All tests + build + pack dry-run |
| `npm run verify:installed` | Pack and install into consumer workspace, exercise CLI/daemon/MCP |
| `npm run bundle:private-rc` | Create a portable reviewer-ready private RC bundle |

See [docs/atlas/development-workflow.md](docs/atlas/development-workflow.md) for the full reference and [docs/atlas/release-checklist.md](docs/atlas/release-checklist.md) for pre-release steps.

## Creating New Documentation

Use `docs.propose_document` to create a new Atlas-managed Markdown document under `docs/atlas/**`. It is the safest current workflow because it can create the file, add the manifest entry when needed, and repair a missing managed file when the manifest already lists the path.

Use `docs.propose_patch` when you are editing an existing document instead of creating a new one.
