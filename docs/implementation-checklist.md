# docu-guard-mcp — Implementation Checklist

> Last updated: 2026-05-30 (dogfooding verified)
> Status: **v0.1.0 Release Ready**

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
| **Total** | | **25 tests** |

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
