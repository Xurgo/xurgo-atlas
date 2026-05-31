# Changelog

## v0.1.0 (2026-05-30)

**MVP release — safe, versioned, auditable documentation management for AI-assisted projects.**

### Features

- **`docs-mcp init`** — Initializes a project with Git-backed store, SQLite event log, policy file, starter docs, and AGENTS.md safety rules.
- **`docs-mcp server`** — Starts an MCP server on stdio exposing all tools and resources.
- **`docs.list`** — Lists tracked documentation files with per-file revision and protected status.
- **`docs.read`** — Reads a documentation file and returns its content with a stable revision hash.
- **`docs.create_branch`** — Creates an agent branch from any source branch.
- **`docs.propose_patch`** — Validates and stores a patch proposal; returns a `proposalId` for review and commit.
- **`docs.preview_diff`** — Previews the stored diff, risk level, and approval requirements for a proposal.
- **`docs.commit_patch`** — Commits a stored proposal; re-validates the base revision; requires `riskOverride: "accept"` for high-risk patches.
- **`docs.history`** — Returns unified history (Git + event log merged) for a documentation file.
- **`docs.restore_file`** — Restores a file to a previous revision from history.
- **`docs.export`** — Exports documentation from a branch to the project working tree.
- **CLI commands** — `list`, `history`, `export` with enriched output formats.
- **5 MCP resources** — `manifest`, `HEAD/{path}`, `branch/{branch}/{path}`, `history/{path}`, `policy`.

### Safety & Validation

- Base revision matching — rejects stale patches.
- Path traversal prevention — blocks `../`, absolute paths, empty segments.
- Risk detection — large deletions (>25%), heading removal, full-file replacement, patch-only deletions.
- Protected file flagging — AGENTS.md and `.docs-policy.yml` modifications require special approval.
- **AGENTS.md intent validation** — intent or summary must reference safety/agent rule keywords.
- Forbidden operations — silent delete, whole-file replace without base revision, overwrite without diff.
- Uninitialized project detection — clear error on all CLI commands.

### Proposal Storage

- `doc_proposals` SQLite table with full CRUD and lifecycle (`pending` → `committed` / `rejected` / `stale`).
- Stale base revision auto-marks proposals as stale.
- Multi-step workflow: propose → preview → commit.

### Testing

- 25 tests covering all tools, validation rules, risk detection, proposal lifecycle, and AGENTS.md intent checks.
- All tests pass; TypeScript compiles cleanly.

### Known Limitations

- Single-file patches only.
- No web review UI.
- No merge tool — branches must be merged manually.
- No file watcher for direct writes.
- Node.js 22+ required (uses built-in `node:sqlite`).
