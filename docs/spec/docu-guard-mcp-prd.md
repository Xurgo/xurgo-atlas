# PRD: docu-guard-mcp — Versioned Documentation Control Plane for AI-Assisted Projects

## 1. Overview

`docu-guard-mcp` is a local MCP server that provides safe, versioned, auditable documentation management for AI-assisted software projects.

Many projects contain important documentation files such as:

```text
AGENTS.md
docs/
docs/spec/
docs/implementation-checklist.md
docs/architecture.md
docs/decisions/
```

AI agents frequently read and modify these files. Over time, agents may accidentally overwrite, truncate, delete, or hallucinate changes to important project documentation. `docu-guard-mcp` prevents this by making documentation changes go through a controlled API with version history, base-revision checks, diffs, branches, and recovery tools.

The goal is to make documentation changes:

```text
auditable
recoverable
branchable
reviewable
safe from silent overwrite
```

---

## 2. Product Goals

### Primary Goals

1. Provide an MCP server that exposes project documentation as readable resources.
2. Provide MCP tools for safe documentation edits.
3. Maintain full history of documentation changes using Git.
4. Prevent silent overwrites by requiring `baseRevision` on all edits.
5. Support agent-specific branches for proposed documentation changes.
6. Provide recovery tools for restoring deleted or overwritten content.
7. Generate an event log for all documentation mutations.
8. Support project bootstrap with default docs, policy, and `AGENTS.md` guidance.

### Secondary Goals

1. Provide a future path toward a review UI.
2. Support searching historical docs.
3. Support risk detection for suspicious edits.
4. Support CI/pre-commit integration.
5. Support export/import between the MCP-managed store and the project working tree.

---

## 3. Non-Goals for MVP

The MVP should not attempt to:

1. Replace Git entirely.
2. Build a full web UI.
3. Implement multi-user cloud sync.
4. Implement complex semantic merge resolution.
5. Support every possible document format.
6. Automatically approve high-risk documentation changes.
7. Manage source code changes.

The MVP is focused on Markdown and text-based documentation.

---

## 4. Target Users

### Primary User

A developer using AI coding agents such as Cursor, Claude Code, Codex, or other MCP-capable tools.

### Secondary Users

- Technical leads managing specs across multiple AI-assisted projects.
- Teams that want safer agent access to documentation.
- Developers who want durable history for `AGENTS.md`, specs, and implementation checklists.

---

## 5. Core Problem

AI agents can unintentionally damage documentation by:

```text
overwriting files
removing sections
regenerating entire docs
deleting checklists
rewriting AGENTS.md incorrectly
losing implementation context
using stale context
saving hallucinated changes
```

Standard Git can recover these changes, but agents often write directly to the working tree, and the damage may go unnoticed.

`docu-guard-mcp` solves this by becoming a documentation gateway:

```text
Agent reads docs through MCP.
Agent proposes patches through MCP.
MCP validates the patch.
MCP records history.
MCP allows preview, commit, restore, and export.
```

---

## 6. MVP Architecture

```text
AI Agent / MCP Client
        |
        v
docu-guard server
        |
        +-- MCP resources
        +-- MCP tools
        +-- policy validator
        +-- patch validator
        +-- Git-backed document store
        +-- SQLite event log
        |
        v
Project working tree
```

Recommended implementation stack:

```text
Language: TypeScript
Runtime: Node.js
MCP SDK: @modelcontextprotocol/sdk
Storage: Git bare repo
Event log: SQLite
Validation: Zod
Diff/Patch: diff or git apply
Config: YAML
```

---

## 7. Project Layout

The initialized project should look like this:

```text
my-project/
  AGENTS.md
  docs/
    README.md
    implementation-checklist.md
    spec/
      README.md
  .docs-policy.yml
   .docu-guard/
    repo.git
    events.sqlite
    exports/
```

The `docu-guard-mcp` package itself should look like:

```text
docu-guard-mcp/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    mcp/
      server.ts
      tools.ts
      resources.ts
    core/
      project.ts
      git-store.ts
      policy.ts
      patch.ts
      events.ts
      risk.ts
      search.ts
    cli/
      init.ts
```

---

## 8. Documentation Policy File

Each project should have a `.docs-policy.yml` file.

Example:

```yaml
protected_paths:
  - AGENTS.md
  - docs/**
  - docs/spec/**
  - docs/implementation-checklist.md
  - docs/architecture.md
  - docs/decisions/**

write_mode:
  default: propose_patch_only
  protected: approval_required

forbidden_operations:
  - silent_delete
  - whole_file_replace_without_base_revision
  - overwrite_without_diff
  - delete_protected_doc_without_approval

required_metadata:
  - intent
  - baseRevision
  - summary

branching:
  agent_branches: true
  merge_to_main_requires: approval

risk_rules:
  large_deletion_percent: 25
  whole_file_replacement_requires_approval: true
  heading_removal_requires_approval: true
  protected_file_change_requires_approval: true
```

---

## 9. MCP Resources

The server should expose documentation through MCP resources.

Example URI patterns:

```text
docs://project/{projectId}/manifest
docs://project/{projectId}/HEAD/{path}
docs://project/{projectId}/branch/{branch}/{path}
docs://project/{projectId}/commit/{revision}/{path}
docs://project/{projectId}/history/{path}
docs://project/{projectId}/policy
```

### Required MVP Resources

#### `docs://project/{projectId}/manifest`

Returns a list of tracked docs.

```json
{
  "projectId": "my-project",
  "docs": [
    {
      "path": "AGENTS.md",
      "revision": "abc123",
      "protected": true
    },
    {
      "path": "docs/spec/README.md",
      "revision": "def456",
      "protected": true
    }
  ]
}
```

#### `docs://project/{projectId}/HEAD/{path}`

Returns current approved content.

```json
{
  "projectId": "my-project",
  "path": "docs/spec/README.md",
  "branch": "main",
  "revision": "abc123",
  "content": "# Spec\n..."
}
```

#### `docs://project/{projectId}/history/{path}`

Returns revision history for one file.

```json
{
  "path": "docs/spec/README.md",
  "history": [
    {
      "revision": "abc123",
      "author": "docu-guard-mcp",
      "timestamp": "2026-05-27T10:30:00Z",
      "summary": "Initial spec"
    }
  ]
}
```

---

## 10. MCP Tools

### 10.1 `docs.init_project`

Initializes documentation control for a project.

Input:

```json
{
  "projectRoot": "/path/to/project",
  "projectId": "my-project"
}
```

Behavior:

1. Create `.docu-guard/`.
2. Create bare Git repo at `.docu-guard/repo.git`.
3. Create `.docs-policy.yml` if missing.
4. Create starter `docs/` files if missing.
5. Create or update `AGENTS.md` with documentation safety rules.
6. Commit initial doc snapshot.

Output:

```json
{
  "projectId": "my-project",
  "initialized": true,
  "trackedFiles": [
    "AGENTS.md",
    "docs/README.md",
    "docs/implementation-checklist.md",
    "docs/spec/README.md"
  ],
  "initialRevision": "abc123"
}
```

---

### 10.2 `docs.list`

Lists tracked documentation files.

Input:

```json
{
  "projectId": "my-project",
  "branch": "main"
}
```

Output:

```json
{
  "projectId": "my-project",
  "branch": "main",
  "files": [
    {
      "path": "AGENTS.md",
      "revision": "abc123",
      "protected": true
    }
  ]
}
```

---

### 10.3 `docs.read`

Reads a documentation file and returns its revision.

Input:

```json
{
  "projectId": "my-project",
  "path": "docs/spec/README.md",
  "branch": "main"
}
```

Output:

```json
{
  "projectId": "my-project",
  "path": "docs/spec/README.md",
  "branch": "main",
  "revision": "abc123",
  "content": "# Spec\n..."
}
```

---

### 10.4 `docs.create_branch`

Creates a branch for an agent or task.

Input:

```json
{
  "projectId": "my-project",
  "branch": "agent/update-auth-spec",
  "from": "main"
}
```

Output:

```json
{
  "projectId": "my-project",
  "branch": "agent/update-auth-spec",
  "from": "main",
  "created": true
}
```

---

### 10.5 `docs.propose_patch`

Proposes a patch against a specific base revision.

Input:

```json
{
  "projectId": "my-project",
  "branch": "agent/update-auth-spec",
  "path": "docs/spec/auth.md",
  "baseRevision": "abc123",
  "patch": "--- a/docs/spec/auth.md\n+++ b/docs/spec/auth.md\n...",
  "intent": "Update auth spec with refresh-token behavior",
  "summary": "Adds refresh-token requirements"
}
```

Behavior:

1. Validate path.
2. Validate branch exists.
3. Validate `baseRevision` matches current file revision on branch.
4. Validate patch applies cleanly.
5. Analyze risk.
6. Store proposal.
7. Do not commit yet.

Output:

```json
{
  "proposalId": "prop_123",
  "valid": true,
  "riskLevel": "low",
  "requiresApproval": false,
  "summary": "Adds refresh-token requirements",
  "changedFiles": [
    "docs/spec/auth.md"
  ]
}
```

---

### 10.6 `docs.preview_diff`

Returns the proposed diff for review.

Input:

```json
{
  "projectId": "my-project",
  "proposalId": "prop_123"
}
```

Output:

```json
{
  "proposalId": "prop_123",
  "diff": "--- a/docs/spec/auth.md\n+++ b/docs/spec/auth.md\n...",
  "riskLevel": "low",
  "requiresApproval": false
}
```

---

### 10.7 `docs.commit_patch`

Commits a previously proposed patch.

Input:

```json
{
  "projectId": "my-project",
  "proposalId": "prop_123",
  "actor": "cursor-agent"
}
```

Behavior:

1. Re-check base revision.
2. Apply patch.
3. Commit to branch.
4. Record event.
5. Return resulting revision.

Output:

```json
{
  "projectId": "my-project",
  "proposalId": "prop_123",
  "branch": "agent/update-auth-spec",
  "commit": "def456",
  "changedFiles": [
    "docs/spec/auth.md"
  ]
}
```

---

### 10.8 `docs.history`

Returns file history.

Input:

```json
{
  "projectId": "my-project",
  "path": "docs/spec/auth.md",
  "branch": "main"
}
```

Output:

```json
{
  "path": "docs/spec/auth.md",
  "history": [
    {
      "revision": "abc123",
      "timestamp": "2026-05-27T10:30:00Z",
      "actor": "docu-guard-mcp",
      "summary": "Initial version"
    }
  ]
}
```

---

### 10.9 `docs.restore_file`

Restores a file from a previous revision.

Input:

```json
{
  "projectId": "my-project",
  "path": "docs/spec/auth.md",
  "revision": "abc123",
  "branch": "agent/restore-auth-spec",
  "intent": "Restore content removed by accidental overwrite"
}
```

Output:

```json
{
  "restored": true,
  "path": "docs/spec/auth.md",
  "branch": "agent/restore-auth-spec",
  "commit": "ghi789"
}
```

---

### 10.10 `docs.export`

Exports approved docs from the managed Git store back to the project working tree.

Input:

```json
{
  "projectId": "my-project",
  "branch": "main"
}
```

Output:

```json
{
  "exported": true,
  "branch": "main",
  "files": [
    "AGENTS.md",
    "docs/README.md",
    "docs/spec/README.md"
  ]
}
```

---

## 11. Patch Safety Rules

The server must reject or flag changes that:

1. Have no `baseRevision`.
2. Are based on a stale revision.
3. Delete a protected file.
4. Replace an entire protected file.
5. Remove more than the configured deletion threshold.
6. Remove Markdown headings from protected files.
7. Modify `AGENTS.md` without explicit intent.
8. Modify `.docs-policy.yml` without approval.
9. Attempt path traversal such as `../../`.

Example rejection:

```json
{
  "valid": false,
  "reason": "Base revision mismatch. File changed since the agent read it.",
  "currentRevision": "def456",
  "providedBaseRevision": "abc123"
}
```

---

## 12. Event Log

All mutations must be recorded in SQLite.

Table: `doc_events`

```sql
CREATE TABLE doc_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  actor TEXT,
  tool_name TEXT NOT NULL,
  intent TEXT,
  summary TEXT,
  base_revision TEXT,
  result_revision TEXT,
  risk_level TEXT,
  diff TEXT,
  created_at TEXT NOT NULL
);
```

Example event:

```json
{
  "id": "evt_123",
  "projectId": "my-project",
  "branch": "agent/update-auth-spec",
  "path": "docs/spec/auth.md",
  "actor": "cursor-agent",
  "toolName": "docs.commit_patch",
  "intent": "Update auth spec",
  "summary": "Adds refresh-token requirements",
  "baseRevision": "abc123",
  "resultRevision": "def456",
  "riskLevel": "low",
  "createdAt": "2026-05-27T10:30:00Z"
}
```

---

## 13. `AGENTS.md` Template

The initializer should add this block to `AGENTS.md`:

```md
# Documentation Safety Rules

All edits to project documentation must go through the docs MCP server.

Do not directly overwrite, remove, rename, truncate, or regenerate files under:

- AGENTS.md
- docs/
- docs/spec/
- docs/implementation-checklist.md
- docs/architecture.md
- docs/decisions/

Before editing documentation:

1. Read the latest version through `docs.read`.
2. Use the returned `baseRevision`.
3. Submit changes through `docs.propose_patch`.
4. Review the diff before committing.
5. Prefer small patches over full-file rewrites.

Never replace an entire document unless explicitly requested.
Never remove sections from specs, checklists, or AGENTS.md without explaining the reason in patch metadata.
If a patch is rejected because the base revision is stale, reread the document and rebase the patch.
```

---

## 14. CLI Commands

The package should expose a CLI named `docu-guard`.

Required commands:

```text
docu-guard init
docu-guard server
docu-guard list
docu-guard history <path>
docu-guard export
```

Examples:

```bash
docu-guard init --project-root . --project-id my-project
docu-guard server --project-root .
docu-guard list
docu-guard history docs/spec/auth.md
docu-guard export --branch main
```

---

## 15. Acceptance Criteria

The MVP is complete when:

1. A user can initialize a project with `docu-guard init`.
2. The MCP server starts successfully with `docu-guard server`.
3. An MCP client can call `docs.read`.
4. `docs.read` returns file content and a stable revision.
5. An MCP client can create an agent branch.
6. An MCP client can propose a patch with `baseRevision`.
7. The server rejects a patch with a stale `baseRevision`.
8. The server rejects path traversal attempts.
9. The server detects large deletions and marks them as high risk.
10. The server commits valid patches to the selected branch.
11. Every committed patch creates an event log record.
12. A user can view file history.
13. A user can restore a file from an older revision.
14. A user can export docs from the managed store to the working tree.
15. `AGENTS.md` contains documentation safety rules after initialization.

---

## 16. Milestones

### Milestone 1: Skeleton

- TypeScript package setup
- CLI entry point
- MCP server startup
- Basic project config loading

### Milestone 2: Git Store

- Initialize bare Git repo
- Snapshot docs
- Read files from branch/revision
- List tracked docs
- Compute file revision

### Milestone 3: MCP Read Tools

- `docs.list`
- `docs.read`
- Manifest resource
- HEAD document resource

### Milestone 4: Patch Flow

- `docs.create_branch`
- `docs.propose_patch`
- `docs.preview_diff`
- `docs.commit_patch`
- Base revision validation

### Milestone 5: Safety

- Policy loading
- Protected paths
- Path traversal prevention
- Large deletion detection
- Heading removal detection

### Milestone 6: History and Recovery

- `docs.history`
- `docs.restore_file`
- Event log
- `docs.export`

---

## 17. Future Enhancements

Future versions may add:

1. Web-based review UI.
2. Historical full-text search.
3. Semantic section-level restore.
4. Agent activity dashboard.
5. Team approvals.
6. Cloud sync.
7. GitHub PR integration.
8. VS Code extension.
9. File watcher that snapshots direct writes.
10. More advanced merge conflict workflows.

---

## 18. Summary

`docu-guard-mcp` should make this statement true:

```text
An AI agent cannot accidentally erase, overwrite, or silently corrupt project documentation without creating a recoverable, inspectable history entry.
```

The MVP should prioritize:

```text
safe reads
patch-only writes
base-revision checks
Git-backed history
event logging
branch-based proposals
easy restore
```

Do not build a large platform first. Build the smallest reliable documentation control plane that makes agent-driven documentation changes safe.
