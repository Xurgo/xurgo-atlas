# docu-guard-mcp — Implementation Checklist

> Last updated: 2026-06-01 (v0.3 configurable managed storage implemented)
> Status: **v0.2-daemon released; v0.3 configurable managed storage implemented**

---

## PRD Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | User can `docu-guard init` | ✅ Complete | Creates `.docu-guard/`, Git bare repo, SQLite DB, policy, docs, AGENTS.md |
| 2 | Server starts with `docu-guard server` | ✅ Complete | MCP server on stdio with all tools registered |
| 3 | MCP client can call `docs.read` | ✅ Complete | Returns content + revision hash |
| 4 | `docs.read` returns content + stable revision | ✅ Complete | Revision is the Git commit hash for the file |
| 5 | Client can create an agent branch | ✅ Complete | `docs.create_branch` with `from` parameter |
| 6 | Client can propose a patch with `baseRevision` | ✅ Complete | `docs.propose_patch` validates and stores proposal |
| 7 | Server rejects stale `baseRevision` | ✅ Complete | Returns clear "Base revision mismatch" error |
| 8 | Server rejects path traversal | ✅ Complete | Detects `../`, absolute paths, empty segments |
| 9 | Server detects large deletions as high risk | ✅ Complete | Threshold: 25% (configurable in policy) |
| 10 | Server commits valid patches | ✅ Complete | Applies patch, creates Git commit |
| 11 | Every commit creates an event log record | ✅ Complete | SQLite `doc_events` table |
| 12 | User can view file history | ✅ Complete | Unified `history` array (git + event log merged) |
| 13 | User can restore file from old revision | ✅ Complete | `docs.restore_file` with `intent` required |
| 14 | User can export docs to working tree | ✅ Complete | `docs.export` with `exported: true` + `files` |
| 15 | AGENTS.md contains safety rules | ✅ Complete | Appended or created during `init` |

---

## MCP Tools

| Tool | Status | Notes |
|------|--------|-------|
| `docs.list` | ✅ Complete | Returns per-file `{ path, revision, protected }` |
| `docs.read` | ✅ Complete | Content + revision hash |
| `docs.create_branch` | ✅ Complete | `from` parameter, returns `created: true` |
| `docs.propose_patch` | ✅ Complete | Stores proposal, returns `proposalId` |
| `docs.preview_diff` | ✅ Complete | Looks up by `proposalId`, returns diff + risk |
| `docs.commit_patch` | ✅ Complete | Commits by `proposalId`, accepts `actor`, `riskOverride` |
| `docs.history` | ✅ Complete | Unified history array (git + events) |
| `docs.restore_file` | ✅ Complete | Requires `intent`, returns `restored: true` |
| `docs.export` | ✅ Complete | Returns `exported: true` + `files` |

---

## MCP Resources

| Resource URI | Status | Notes |
|-------------|--------|-------|
| `docs://project/{id}/manifest` | ✅ Complete | JSON list of tracked files |
| `docs://project/{id}/HEAD/{path}` | ✅ Complete | Current file on main branch |
| `docs://project/{id}/branch/{branch}/{path}` | ✅ Complete | File on specific branch |
| `docs://project/{id}/history/{path}` | ✅ Complete | Git history for a file |
| `docs://project/{id}/policy` | ✅ Complete | Current policy config |
| `docs://project/{id}/commit/{revision}/{path}` | ⏳ Post-MVP | Listed in PRD example URIs, not required for MVP |

---

## CLI Commands

| Command | Status | Notes |
|---------|--------|-------|
| `docu-guard init` | ✅ Complete | Creates full project structure |
| `docu-guard server` | ✅ Complete | Stdio MCP server |
| `docu-guard list` | ✅ Complete | Enriched output (per-file revision + protected) |
| `docu-guard history <path>` | ✅ Complete | Unified history output |
| `docu-guard export` | ✅ Complete | Exports to working tree |

---

## Proposal Storage

| Feature | Status | Notes |
|---------|--------|-------|
| `doc_proposals` SQLite table | ✅ Complete | `id`, `project_id`, `branch`, `path`, `base_revision`, `patch`, `intent`, `summary`, `risk_level`, `requires_approval`, `status`, `created_at`, `committed_at` |
| Proposal CRUD | ✅ Complete | `storeProposal`, `getProposal`, `updateProposalStatus` |
| Proposal lifecycle | ✅ Complete | `pending` → `committed` / `rejected` / `stale` |
| Stale base revision → stale proposal | ✅ Complete | Auto-marked when `commit_patch` re-validation fails |

---

## Safety & Validation

| Feature | Status | Notes |
|---------|--------|-------|
| Path traversal prevention | ✅ Complete | `../`, absolute paths, empty segments |
| Base revision matching | ✅ Complete | Reject on mismatch |
| Forbidden operations | ✅ Complete | Silent delete, whole-file replace without base revision, overwrite without diff, delete protected doc |
| Large deletion detection | ✅ Complete | >25% threshold (configurable) |
| Heading removal detection | ✅ Complete | All heading levels (# through ######) |
| Full file replacement detection | ✅ Complete | Common prefix/suffix <10% |
| AGENTS.md modification flagging | ✅ Complete | High risk + special approval messaging |
| AGENTS.md intent validation | ✅ Complete | Intent/summary must reference safety/agent rules keywords |
| `.docs-policy.yml` modification flagging | ✅ Complete | High risk + special approval messaging |
| Patch-only-deletions detection | ✅ Complete | No additions in patch = high risk |
| Protected file change flagging | ✅ Complete | Configurable via policy |
| Risk override for high-risk patches | ✅ Complete | `riskOverride: "accept"` on `commit_patch` |
| Uninitialized project detection | ✅ Complete | Clear error message on all CLI commands |

---

## Event Log

| Feature | Status | Notes |
|---------|--------|-------|
| `doc_events` SQLite table | ✅ Complete | Matches PRD schema exactly |
| Event logging on all mutations | ✅ Complete | `init`, `propose_patch`, `commit_patch`, `restore_file`, `export`, `create_branch` |
| Event retrieval by path | ✅ Complete | `getHistoryForPath` |
| Actor recording | ✅ Complete | Via `commit_patch` `actor` parameter |

---

## Tests

| Test Area | Status | Count |
|-----------|--------|-------|
| Project initialization | ✅ Complete | 1 test |
| Reading docs | ✅ Complete | 2 tests (exists + not found) |
| Creating branches | ✅ Complete | 1 test |
| Proposing a valid patch | ✅ Complete | 1 test |
| Rejecting stale base revision | ✅ Complete | 1 test |
| Rejecting path traversal | ✅ Complete | 2 tests (detect + accept) |
| Detecting large deletion risk | ✅ Complete | 2 tests (flag + no flag) |
| Detecting heading removal risk | ✅ Complete | 2 tests (flag + no flag) |
| Detecting full file replacement | ✅ Complete | 1 test |
| Committing a patch | ✅ Complete | 1 test |
| Writing event log row | ✅ Complete | 1 test |
| Restoring file from history | ✅ Complete | 1 test |
| Proposal storage round-trip | ✅ Complete | 2 tests (CRUD + not found) |
| Export documentation | ✅ Complete | 1 test |
| Stale proposal detection | ✅ Complete | 1 test |
| AGENTS.md intent validation | ✅ Complete | 5 tests (vague intent rejected, valid intent passes ×3, non-AGENTS.md not affected) |
| AGENTS.md safety-rule content in init | ✅ Complete | 5 content assertions in init test |
| Storage paths (expandTilde, derivation) | ✅ Complete | 4 tests |
| Registry CRUD + resolution + schema v2 | ✅ Complete | 5 tests (add, remove, list, show, default) |
| Registry v1 backward compat | ✅ Complete | 2 tests (load v1, upgrade on write) |
| Registry managed-dir validation | ✅ Complete | 2 tests (resolve using dataDir, missing) |
| CLI init command registration | ✅ Complete | 3 tests (registers, idempotent, custom dirs) |
| HTTP server with managed storage | ✅ Complete | 9 tests (isolated temp paths, no `.docu-guard/`) |
| Daemon with managed storage | ✅ Complete | 4 tests (isolated temp paths) |
| **Total** | | **72 tests** |

---

## Known Gaps / Post-MVP

| Item | Priority | Notes |
|------|----------|-------|
| `commit/{revision}/{path}` resource URI | Low | Listed in PRD example URIs but not in Required MVP Resources |
| `search.ts` module | Low | Listed in PRD project layout; search is post-MVP |
| Web review UI | Post-MVP | Future enhancement |
| Cloud sync / team approvals | Post-MVP | Future enhancement |
| GitHub PR integration | Post-MVP | Future enhancement |
| VS Code extension | Post-MVP | Future enhancement |
| File watcher for direct writes | Post-MVP | Future enhancement |
| Multi-file patches | Post-MVP | Currently single-file only |
| Semantic merge resolution | Post-MVP | Explicitly non-goal for MVP |
| CI/pre-commit integration | Post-MVP | Secondary goal |
| Historical full-text search | Post-MVP | Future enhancement |
| Agent activity dashboard | Post-MVP | Future enhancement |
| `better-sqlite3` vs `node:sqlite` | ✅ Resolved | Using built-in `node:sqlite` (Node 22+) — intentional improvement |

---

## v0.2 — Multi-Project Daemon with Streamable HTTP

> **Status:** Planned (spec complete, not yet implemented)
> **Spec:** [`docs/spec/docu-guard-mcp-v0.2-daemon-prd.md`](./spec/docu-guard-mcp-v0.2-daemon-prd.md)
> **Plan:** [`docs/spec/docu-guard-mcp-v0.2-implementation-plan.md`](./spec/docu-guard-mcp-v0.2-implementation-plan.md)

### CLI Commands

| Command | Status | Notes |
|---------|--------|-------|
| `docu-guard daemon` | ⏳ Planned | Streamable HTTP daemon on localhost:3737 |
| `docu-guard project add` | ⏳ Planned | Register a project in the local registry |
| `docu-guard project remove` | ⏳ Planned | Remove a project from registry |
| `docu-guard project list` | ⏳ Planned | List all registered projects |
| `docu-guard project show` | ⏳ Planned | Show details for a registered project |
| `docu-guard project default` | ⏳ Planned | Set the default project for daemon mode |
| `docu-guard server` | ✅ Unchanged | Stdio mode preserved from v0.1 |

### Architecture Components

| Component | Status | Notes |
|-----------|--------|-------|
| `src/mcp/create-server.ts` | ⏳ Planned | Shared MCP server factory (extracted from `server.ts`) |
| `src/mcp/stdio.ts` | ⏳ Planned | Stdio transport wrapper (refactored from `server.ts`) |
| `src/mcp/http.ts` | ⏳ Planned | Streamable HTTP transport using Node.js built-in `http` |
| `src/cli/daemon.ts` | ⏳ Planned | Daemon CLI command handler |
| `src/cli/project.ts` | ⏳ Planned | Project registry CLI handlers |
| `src/core/registry.ts` | ⏳ Planned | Registry class for `~/.config/docu-guard/projects.json` |

### MCP Transport

| Feature | Status | Notes |
|---------|--------|-------|
| Stdio transport | ✅ Unchanged | Preserved from v0.1 |
| Streamable HTTP transport | ⏳ Planned | `POST /mcp` endpoint |
| Health check endpoint | ⏳ Planned | `GET /health` |
| CORS support | ⏳ Planned | ACAO, ACAM, ACAH headers |
| Origin validation | ⏳ Planned | Localhost origins by default |
| Graceful shutdown | ⏳ Planned | SIGINT/SIGTERM handling |

### Project Registry

| Feature | Status | Notes |
|---------|--------|-------|
| Registry CRUD | ⏳ Planned | add, remove, list, show |
| Default project | ⏳ Planned | Fallback when `projectId` omitted |
| Project resolution | ⏳ Planned | `projectId` → `projectRoot` |
| Validation: unknown project | ⏳ Planned | Clear error + suggested command |
| Validation: missing root | ⏳ Planned | Clear error |
| Validation: uninitialized | ⏳ Planned | Clear error suggesting `docu-guard init` |
| Validation: no default | ⏳ Planned | Clear error |
| Config path | ⏳ Planned | `~/.config/docu-guard/projects.json` (respects `XDG_CONFIG_HOME`) |

### Multi-Project Tool Dispatch

| Feature | Status | Notes |
|---------|--------|-------|
| Tools resolve `projectId` per-request | ⏳ Planned | Resolver pattern in daemon mode |
| Stdio uses pre-loaded project | ✅ Unchanged | No resolver needed |
| Default project fallback | ⏳ Planned | When `projectId` omitted in daemon mode |

### Testing

| Test Area | Status | Count |
|-----------|--------|-------|
| Registry unit tests | ✅ Complete | 22 tests |
| HTTP server tests | ✅ Complete | 9 tests |
| Daemon integration tests | ✅ Complete | 4 tests |
| v0.1 regression | ✅ Required | All pre-v0.3 tests must pass unchanged |

### README Documentation

| Section | Status | Notes |
|---------|--------|-------|
| Daemon mode | ✅ Complete | How to start and use the daemon |
| Project registry commands | ✅ Complete | add, remove, list, show, default |
| HTTP MCP client config | ✅ Complete | Example for clients supporting Streamable HTTP |
| Security notes | ✅ Complete | Default localhost, warning about `0.0.0.0` |

### Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Extract shared MCP server registration | ✅ Complete |
| Phase 2 | Add project registry | ✅ Complete |
| Phase 3 | Add project CLI commands | ✅ Complete |
| Phase 4 | Add Streamable HTTP daemon | ✅ Complete |
| Phase 5 | Add multi-project resolution in tools | ✅ Complete |
| Phase 6 | Add docs, tests, dogfooding | ✅ Complete |

---

## v0.3 — Storage Model Audit & Implementation

> **Status:** Configurable managed storage implemented (commit `2979ee2`)
> **Spec:** [`docs/spec/docu-guard-mcp-v0.3-storage-model.md`](./spec/docu-guard-mcp-v0.3-storage-model.md)

| Item | Status | Notes |
|------|--------|-------|
| Storage model audit completed | ✅ Complete | Evaluated project-local, global-only, and managed-with-configurable-dirs models |
| Recommended model chosen | ✅ Complete | Managed storage with configurable `--config-dir` and `--data-dir`; project-local mode removed |
| Registry schema v2 designed | ✅ Complete | `configDir` and `dataDir` at top level; no `storeType` field |
| `--config-dir` / `--data-dir` flags for daemon | ✅ Complete | Replaces `--store` flag; separates config from data |
| Path resolution using configurable dirs | ✅ Complete | `<dataDir>/projects/<projectId>/` for managed state |
| Project-local `.docu-guard/` removal | ✅ Complete | `init` no longer creates `.docu-guard/`; no auto-detection or fallback |
| Existing `.docu-guard/` migration helper | ⏳ Pending | One-time copy from `.docu-guard/` to `<dataDir>/projects/<id>/` |
| Registry backward compatibility | ✅ Complete | v1 loaded and upgraded silently; saved as v2 |
| Daemon path validation | ⏳ Pending | Validate configDir/dataDir existence at startup (currently prints paths but does not validate) |
| Desktop/VPS/Docker path defaults | ⏳ Pending | Defaults use XDG conventions; `/etc`/`/var/lib` defaults not auto-detected |
| Dogfooding with managed store | ⏳ Pending | Run daemon with `--config-dir`/`--data-dir` on docu-guard-mcp itself |
| Tests for new storage model | ✅ Complete | 22 registry tests (v2 schema, v1 compat, CRUD, resolution), 4 daemon tests, 9 HTTP server tests, tilde expansion, CLI init registration |
