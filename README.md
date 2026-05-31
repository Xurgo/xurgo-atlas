# docs-mcp

**Safe, versioned, auditable documentation management for AI-assisted software projects.**

`docs-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that acts as a gatekeeper for project documentation. AI agents can read documentation and propose changes through the server, but they **cannot directly overwrite** important project files.

All changes are tracked in Git, logged to SQLite, and validated against a configurable policy — giving you full auditability and control.

---

## Purpose

AI coding assistants are powerful, but they can also accidentally overwrite documentation, delete content, or make changes without visibility. `docs-mcp` solves this by:

- **Versioning all docs in Git** — every change is a commit with a full history
- **Requiring patches for changes** — no direct file writes, always a diff
- **Validating every patch** — checks for base revision conflicts, path traversal, risk patterns
- **Logging every event** — a SQLite audit trail of all reads, proposals, and commits
- **Enforcing policy** — configurable `docs-policy.yml` controls what can be changed and how

---

## Installation

```bash
npm install -g docs-mcp
```

Or use with `npx`:

```bash
npx docs-mcp init --project-root . --project-id my-project
```

### Prerequisites

- Node.js >= 22
- Git (for the backing store)
- npm or yarn

---

## CLI Usage

### Initialize a project

```bash
docs-mcp init --project-root /path/to/project --project-id my-project
```

This creates the `.docs-mcp/` directory structure, initializes a Git repo, creates the SQLite event log, and snapshots the initial documentation.

### Start the MCP server

```bash
docs-mcp server --project-root /path/to/project
```

The server runs on stdio, suitable for MCP-compatible clients like Claude Desktop, VS Code, or custom integrations.

### List tracked files

```bash
docs-mcp list --project-root /path/to/project
```

### View file history

```bash
docs-mcp history docs/README.md --project-root /path/to/project
```

### Export documentation

```bash
docs-mcp export --branch main --project-root /path/to/project
```

---

## MCP Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "docs-mcp": {
      "command": "npx",
      "args": [
        "docs-mcp",
        "server",
        "--project-root",
        "/absolute/path/to/your/project",
        "--project-id",
        "my-project"
      ]
    }
  }
}
```

### VS Code (with MCP extension)

Add to your VS Code settings:

```json
{
  "mcp.enable": true,
  "mcp.servers": {
    "docs-mcp": {
      "command": "npx",
      "args": ["docs-mcp", "server", "--project-root", "${workspaceFolder}", "--project-id", "my-project"],
      "env": {}
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `docs.list` | List all tracked documentation files in a branch (returns per-file revision + protected status) |
| `docs.read` | Read a documentation file from a specific branch |
| `docs.create_branch` | Create a new branch for making documentation changes |
| `docs.propose_patch` | Validate and store a patch proposal; returns a `proposalId` |
| `docs.preview_diff` | Preview the stored diff for a proposal by `proposalId` |
| `docs.commit_patch` | Commit a stored proposal by `proposalId`; accepts `actor` and `riskOverride` |
| `docs.history` | View the unified Git + event history for a documentation file |
| `docs.restore_file` | Restore a file to a previous revision from history |
| `docs.export` | Export documentation from a branch to a target directory |

### Tool: `docs.read`

Every read returns:

```json
{
  "projectId": "my-project",
  "path": "docs/README.md",
  "branch": "main",
  "revision": "abc123def456...",
  "content": "# Documentation\n\n..."
}
```

### Tool: `docs.propose_patch`

Every proposed patch requires:

- `projectId` — the project identifier
- `branch` — the branch to propose on
- `path` — the file path within the project
- `baseRevision` — the revision hash from when you read the file
- `patch` — a unified diff string
- `intent` — why you are making the change
- `summary` — a brief description of the change

Returns a `proposalId` which is used to preview and commit the patch later.

### Tool: `docs.commit_patch`

Accepts a `proposalId` (returned by `propose_patch`) and an optional `actor`.
Re-validates the base revision before applying, then commits and logs the event.
High-risk patches require `riskOverride: "accept"` to proceed.

---

## MCP Resources

| Resource URI | Description |
|---|---|
| `docs://project/{projectId}/manifest` | JSON list of all tracked files |
| `docs://project/{projectId}/HEAD/{path}` | Current version of a file on main |
| `docs://project/{projectId}/branch/{branch}/{path}` | File version on a specific branch |
| `docs://project/{projectId}/history/{path}` | Git history for a file |
| `docs://project/{projectId}/policy` | Current policy configuration |

---

## Documentation Safety Model

### How it works

1. **Read through the server** — AI agents use `docs.read` to get file contents, which includes a `revision` hash
2. **Propose changes as patches** — agents create unified diffs and submit them via `docs.propose_patch`
3. **Validation** — the server checks:
   - The path is tracked documentation
   - The branch exists
   - The base revision matches the current HEAD
   - The patch applies cleanly
   - No forbidden operations are attempted
   - Risk level is assessed
4. **Commit with audit trail** — `docs.commit_patch` applies the patch and writes to both Git and the SQLite event log

### Risk detection

A patch is flagged as **high risk** if it:

- Deletes more than 25% of a file
- Removes Markdown headings
- Replaces the entire file content
- Modifies `AGENTS.md` or `.docs-policy.yml`
- Modifies a protected file
- Contains only deletions without additions

High-risk patches require explicit `riskOverride: "accept"` to proceed.

### Policy configuration (`.docs-policy.yml`)

The policy file controls:

- **`protected_paths`** — glob patterns for tracked documentation
- **`write_mode`** — how each path category can be modified
- **`forbidden_operations`** — operations that are never allowed without approval
- **`required_metadata`** — fields that must be provided with every patch
- **`risk_rules`** — thresholds and rules for risk detection

---

## Example Agent Workflow

```
1. Agent reads a document:
   → docs.read({ path: "docs/spec/api.md", branch: "main" })
   ← { content: "# API Spec\n...", revision: "a1b2c3d4" }

2. Agent creates a branch for the change:
   → docs.create_branch({ branch: "update-api-spec", from: "main" })
   ← { created: true, branch: "update-api-spec", from: "main" }

3. Agent proposes a patch:
   → docs.propose_patch({
       branch: "update-api-spec",
       path: "docs/spec/api.md",
       baseRevision: "a1b2c3d4",
       patch: "@@ -1,3 +1,5 @@...",
       intent: "Document new /users endpoint",
       summary: "Add /users endpoint documentation"
     })
   ← { proposalId: "prop_a1b2c3d4", valid: true, riskLevel: "low",
       requiresApproval: false, summary: "Add /users endpoint documentation",
       changedFiles: ["docs/spec/api.md"] }

4. Agent previews the diff (optional):
   → docs.preview_diff({ proposalId: "prop_a1b2c3d4" })
   ← { proposalId: "prop_a1b2c3d4", diff: "@@ -1,3 +1,5 @@...",
       riskLevel: "low", requiresApproval: false }

5. Agent commits the patch:
   → docs.commit_patch({
       proposalId: "prop_a1b2c3d4",
       actor: "cursor-agent"
     })
   ← { proposalId: "prop_a1b2c3d4", commit: "e5f6g7h8",
       changedFiles: ["docs/spec/api.md"],
       message: "Patch committed successfully" }
```

---

## Project Structure

```
docs-mcp/
├── .docs-policy.yml          # Policy configuration
├── AGENTS.md                 # Agent safety rules
├── docs/                     # Project documentation
│   ├── README.md
│   ├── spec/README.md
│   └── implementation-checklist.md
└── .docs-mcp/                # Internal store (do not edit manually)
    ├── repo.git/             # Git-backed documentation history
    └── events.sqlite         # SQLite event audit log
```

---

## Architecture

```
┌──────────────────┐
│  MCP Client      │
│  (AI Agent)      │
└────────┬─────────┘
         │ stdio JSON-RPC
         ▼
┌──────────────────┐
│  docs-mcp Server │
│  (MCP Protocol)  │
└────────┬─────────┘
         │
    ┌────┴────┬───────────┐
    ▼         ▼           ▼
┌────────┐ ┌──────┐ ┌──────────┐
│ Git    │ │SQLite│ │Policy    │
│ Store  │ │Events│ │Engine    │
└────────┘ └──────┘ └──────────┘
```

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

---

## Known Limitations

- **Single-file patches only** — `propose_patch` operates on one file at a time. Multi-file changes require multiple proposals.
- **AGENTS.md intent validated by keyword check** — Changes to `AGENTS.md` require an intent or summary referencing `AGENTS.md`, `agent instructions`, `safety rules`, or related keywords. Other files do not have path-specific intent validation.
- **No pre-commit / CI integration** — Direct edits to tracked docs outside of docs-mcp are not automatically detected or blocked. Use the Git history for recovery.
- **No web review UI** — Proposals can be previewed via `docs.preview_diff` but there is no graphical review interface.
- **No merge tool** — Branches created with `docs.create_branch` must be merged manually via Git.
- **No file watcher** — Changes made directly to the working tree (outside docs-mcp) are not automatically snapshotted.
- **Node.js 22+ required** — The built-in `node:sqlite` module is used, which requires Node.js 22 or later.

---

## License

MIT
