# docu-guard-mcp

Safe, versioned, auditable documentation management for AI-assisted projects.

## How docu-guard-mcp Works

docu-guard-mcp provides two interfaces for managing documentation:

1. **CLI (Command Line Interface)**: For direct interaction and project management.
2. **MCP (Model Context Protocol) Server**: For AI agents to interact with documentation projects programmatically.

### CLI vs MCP Tools

- The CLI is used for initializing projects, managing project registries, and running standalone commands (like `list`, `history`, `export`).
- The MCP server exposes tools and resources that AI agents can use to read, propose changes, and manage documentation safely.

### stdio mode vs daemon mode

- **stdio mode** (`docu-guard server`): The MCP server runs on standard input/output, suitable for local development and direct integration with MCP clients.
- **daemon mode** (`docu-guard daemon`): The MCP server runs as an HTTP server using Streamable HTTP transport, allowing multiple agents to connect over HTTP. This mode supports multi-project setups via a global project registry.

### Configurable managed storage

Managed state (Git repositories, event logs) lives outside the project tree in configurable directories:

| Path | Default | Content |
|------|---------|---------|
| `<configDir>/projects.json` | `~/.config/xurgo-atlas/projects.json` | Global project registry |
| `<dataDir>/projects/<id>/repo.git` | `~/.local/share/xurgo-atlas/projects/<id>/repo.git` | Git bare repository (docs history) |
| `<dataDir>/projects/<id>/events.sqlite` | `~/.local/share/xurgo-atlas/projects/<id>/events.sqlite` | Event/proposal database |

Fresh installs default to the Xurgo Atlas XDG roots above. Legacy-only installs still fall back to the historical `docu-guard` config and data roots for compatibility. If both Atlas and legacy managed roots are already populated, Atlas roots are selected, nothing is merged automatically, and a warning/diagnostic is emitted so you can choose an explicit root with `--config-dir` or `--data-dir` if needed.

The project working tree contains only user-facing committed files: `docs/`, `AGENTS.md`, `.docs-policy.yml`. No `.docu-guard/` directory is created in the project. Existing project-local `.docu-guard/` folders are pre-v0.3 development artifacts and are warned about, not used as active storage.

The config and data directory locations can be set with `--config-dir` and `--data-dir` flags on `init`, `server`, `daemon`, and `project` commands. The defaults follow XDG Base Directory conventions (`XDG_CONFIG_HOME` / `XDG_DATA_HOME`). There is not yet a command that physically migrates managed storage between legacy and Atlas root directories.

Use `xurgo-atlas storage inspect` to see the effective selected roots, Atlas-vs-legacy candidate state, registry presence, project counts when readable, and runtime PID/log artifact presence. The command is read-only and does not migrate or modify storage.

### Global project registry

The daemon mode uses a global project registry (located at `<configDir>/projects.json`, default `~/.config/xurgo-atlas/projects.json`) to map project IDs to project roots. Legacy-only installs still resolve through `~/.config/docu-guard/projects.json` until you explicitly point elsewhere. The location is configurable with `--config-dir`. This allows the daemon to serve multiple projects without needing to know their paths in advance.

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

1. **docs.list** – Discover what files are available in the project.
2. **docs.read** – Read the target file to obtain its current content and `baseRevision`.
3. **docs.create_branch** – Create an isolated branch for the changes (e.g., `agent/change-summary`).
4. **docs.propose_patch** – Submit a patch with the `baseRevision` from the read step, along with intent and summary.
5. **docs.preview_diff** – Review the proposed diff, check the risk level, and verify approval requirements.
6. **docs.commit_patch** – Commit the proposal (if low-risk) or commit with `riskOverride: "accept"` (if high-risk and approved).
7. **docs.export** – (Optional) Export the branch to the working tree to synchronize changes.

> **Agent Instruction:**  
> Use docu-guard-mcp for all documentation changes. Do not edit docs directly. Read the file first, use the returned baseRevision, propose a minimal patch, preview the diff, commit the proposal, then export.

## Validation

Use `npm run validate:quick` during narrow edits. It runs the fast test tier plus `npm run build` without the slow integration-heavy project suite.

Use `npm run validate:full` before risky merges or release-style checks. It keeps the existing full `npm test` path, adds a build, and runs `npm pack --dry-run`. The full validation currently takes a few minutes.

## Creating New Documentation

Creating a new documentation file is supported via the existing patch-based workflow. To create a new file:

1. Ensure the target path is under a protected directory (e.g., `docs/` or as defined in `.docs-policy.yml`).
2. On the target branch, propose a patch that creates the file. Since the file does not exist, the `baseRevision` field is not validated against a current file revision (the validation skips the baseRevision check when the file is absent). However, a non-empty string must still be provided for `baseRevision` (e.g., the branch HEAD revision or any arbitrary non-empty string).
3. The patch should be a unified diff that creates the file (e.g., starting with `+++ b/path/to/new/file` and containing additions).
4. Follow the standard workflow: preview the diff, commit the proposal, and export if desired.

**Note:** Although creating new files is possible, the workflow is optimized for modifying existing files. Agents should prefer to read a file first when possible. For entirely new documentation, consider creating a template file in the repository first, then modifying it.
