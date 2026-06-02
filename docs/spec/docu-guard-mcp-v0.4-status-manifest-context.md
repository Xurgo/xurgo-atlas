# Xurgo Atlas v0.4 — STATUS.md, Manifest, and Token-Efficient Context

> **Product name:** Xurgo Atlas
> **Current implementation:** docu-guard-mcp (transitional package/CLI)
> **Status:** Implemented and stabilized as a private v0.4 milestone (docs.status ✅, docs.manifest ✅, docs.read_section ✅, docs.context_pack ✅, read-only REST context API ✅, read-only web UI ✅)
> **Vision:** [`../vision/project-context-mcp.md`](../vision/project-context-mcp.md)
> **Branch:** v0.2-daemon

---

## 1. Motivation

As of v0.3, Xurgo Atlas (currently implemented as the docu-guard-mcp package with the `docu-guard` CLI) provides safe, versioned documentation management with configurable storage and a multi-project daemon. Agents can read, edit, propose, and commit documentation changes with full audit and safety guarantees.

However, the current tool surface assumes the agent already knows what it is looking for. There is no mechanism for:

- **Orientation:** A new agent joining a project cannot quickly learn what the project is about, what matters now, or where to start.
- **Discovery:** There is no machine-readable index of documents and their roles. The agent must either know paths in advance or call `docs.list` and guess from filenames.
- **Token efficiency:** Every `docs.read` returns the full document. Reading orientation context requires loading multiple full documents.
- **Project front page:** There is no canonical "start here" document that every agent reads first.

v0.4 addresses these gaps by introducing two new standard files (`STATUS.md` and `docs/manifest.yml`) and evolving the MCP tool surface toward token-efficient, progressive-disclosure access patterns.

---

## 2. Goals

1. **Define a standard project front page** (`STATUS.md`) that orients agents and humans immediately.
2. **Define a machine-readable project map** (`docs/manifest.yml`) that agents can consume in a single compact call.
3. **Evolve the MCP tool surface** to support compact, bounded, progressive reads.
4. **Keep default MCP responses token-efficient** — agents should not pay for content they did not request.
5. **Maintain full backward compatibility** — existing v0.1–v0.3 tools and workflows continue unchanged.
6. **No project-local `.docu-guard/` creation** — v0.3 storage model is preserved.
7. **No dependency on any specific agent runtime** — works with any MCP-capable client.

---

## 3. Non-Goals

1. **No implementation in this document.** This is a planning and spec document only.
2. **No write-capable web UI implementation.** v0.4 includes only a minimal read-only UI; proposal, approval, restore, export, merge, and publishing workflows remain out of scope.
3. **No mechanical rename in this session.** The package, CLI, MCP server name, tool namespace, and config paths retain their current transitional names. A future rename should be planned separately.
4. **No Xurgo dependency.** The tool must remain independently useful.
5. **No complex YAML features** as core requirements (see §5).
6. **No search/full-text index** — deferred unless explicitly needed later.
7. **No changes to the Git storage model** — v0.3 managed storage is preserved.

---

## 4. Standard Project-Facing Files

After the proposed v0.4 init, a project would have these files:

```
<project-root>/
  STATUS.md              ← Project front page (new)
  AGENTS.md              ← Agent operating contract (existing)
  .docs-policy.yml       ← Safety policy (existing)
  docs/
    manifest.yml         ← Machine-readable project map (new)
    ...                  ← All documentation content (existing)
```

### 4.1 STATUS.md

**Purpose:** A short, always-current document that serves as the default entry point for any agent or human joining the project. It answers "What is this project, what matters now, and what should I not do?"

**Properties:**

| Property | Value |
|----------|-------|
| Location | `<project-root>/STATUS.md` |
| Format | Markdown with YAML front matter |
| Protection | High-priority, protected (like AGENTS.md) |
| Default content | Created by `init` with minimal template |
| Agent requirement | Agents should read this first if unsure where to start |

**Example structure:**

```markdown
---
docuGuard.type: status
statusVersion: 1
priority: high
currentFocus: "Implement user authentication flow"
nextActions:
  - "Review auth PRD in docs/spec/auth-prd.md"
  - "Implement login endpoint"
  - "Add session management"
blockers:
  - "Awaiting design sign-off on auth UI"
doNotDo:
  - "Do not modify AGENTS.md without safety keyword in intent"
  - "Do not delete docs/spec/ files"
  - "Do not push to main without review"
relatedDocs:
  - "docs/spec/auth-prd.md"
  - "docs/implementation-checklist.md"
  - "AGENTS.md"
lastUpdated: "2026-06-01"
---

# Project Status

## Current Focus
Implementing user authentication flow. See [auth PRD](docs/spec/auth-prd.md) for full spec.

## Next Actions
1. Review auth PRD in docs/spec/auth-prd.md
2. Implement login endpoint
3. Add session management

## Blockers
- Awaiting design sign-off on auth UI

## Do Not Do
- Do not modify AGENTS.md without safety keyword in intent
- Do not delete docs/spec/ files
- Do not push to main without review
```

**Design rationale:**

- YAML front matter enables machine parsing without loading the full Markdown body.
- The Markdown body is human-readable and agent-readable.
- Short by design — STATUS.md should be kept under ~50 lines in most projects.
- Agents can read just the front matter (via `docs.read_section` or `docs.status`) for quick orientation.

### 4.2 docs/manifest.yml

**Purpose:** A compact, machine-readable index of every document in the project, its role, priority, and relationships. Enables agents to discover what is available without reading filenames and guessing.

**Properties:**

| Property | Value |
|----------|-------|
| Location | `<project-root>/docs/manifest.yml` |
| Format | YAML |
| Protection | High-priority, protected (like AGENTS.md) |
| Default content | Created by `init` with entries for STATUS.md, manifest itself, AGENTS.md, .docs-policy.yml, and initial docs |

**Example structure:**

```yaml
version: 1
entrypoints:
  - path: STATUS.md
    role: front-page
    priority: highest

documents:
  - path: AGENTS.md
    role: agent-contract
    priority: highest
    summary: Agent safety rules and operating guidelines
    related:
      - .docs-policy.yml

  - path: .docs-policy.yml
    role: safety-policy
    priority: highest
    summary: Configurable risk detection and protected path rules
    related:
      - AGENTS.md

  - path: docs/manifest.yml
    role: project-map
    priority: highest
    summary: Machine-readable project document index

  - path: docs/implementation-checklist.md
    role: roadmap
    priority: high
    summary: Implementation status for all features and milestones
    related:
      - STATUS.md

  - path: docs/spec/auth-prd.md
    role: spec
    priority: high
    summary: Product requirements for authentication feature
    readHint: entrypoint
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Manifest schema version |
| `entrypoints` | No | Ordered list of paths to read first for orientation |
| `documents[].path` | Yes | Relative path from project root |
| `documents[].role` | Yes | Role classification (see below) |
| `documents[].priority` | No | Guidance for which docs to read first |
| `documents[].summary` | No | One-line description for quick orientation |
| `documents[].related` | No | Related document paths |
| `documents[].readHint` | No | Hint about reading strategy (`entrypoint`, `summary`, `full`) |

**Role values:**

| Role | Meaning |
|------|---------|
| `front-page` | The project's STATUS.md — read first |
| `project-map` | The manifest itself |
| `agent-contract` | AGENTS.md — agent operating rules |
| `safety-policy` | .docs-policy.yml — safety configuration |
| `roadmap` | Implementation checklist, milestones |
| `spec` | Specification or PRD document |
| `guide` | How-to guide or tutorial |
| `reference` | API reference, configuration reference |
| `decision` | Architecture Decision Record (ADR) |
| `notes` | General notes, research, brainstorming |
| `archive` | Historical or superseded document |

**Design rationale:**

- Simple explicit YAML references by path. No cross-file imports, no anchors/aliases as a primary linking mechanism.
- The `readHint` field helps agents decide whether to read the full document or just the summary.
- The `entrypoints` list at the top level tells agents exactly what to read first for orientation.
- Roles are flexible — projects can use any role, but the predefined list provides consistency.

---

## 5. YAML in the Project

YAML is used for **compact metadata and explicit document references.** The approach deliberately avoids making advanced YAML behavior core to the product.

### 5.1 What YAML Is Used For

- `docs/manifest.yml` — machine-readable project map.
- `.docs-policy.yml` — safety policy configuration (existing since v0.1, already YAML).
- STATUS.md front matter — structured metadata for the front page.

### 5.2 What YAML Is Not

- **Not a programming language.** YAML is a configuration and metadata format. Complex logic, transformations, or computed fields belong in code, not YAML.
- **Not a graph database.** The manifest uses explicit path references, not a YAML-based graph query language.

### 5.3 Avoided YAML Patterns

These YAML features are deliberately **not** part of the core design:

| Pattern | Why Avoided |
|---------|-------------|
| Cross-file YAML imports (`!include`, etc.) | Creates hidden dependencies. Agents cannot follow the graph without resolving imports first. |
| Anchors/aliases (`&foo`, `*foo`) as primary linking | Fragile across edits. Agents must resolve aliases to understand the document. Fine for deduplication in generated files, not as the primary linking mechanism. |
| Multi-document YAML (`---` separator) as default project graph format | Each file should be self-contained. Multi-doc YAML is acceptable for specific use cases (e.g., event dumps) but not as the standard project map format. |
| Hidden merge behavior (`<<: *foo`) | Silent inheritance that is invisible to agents reading the file. If merging is needed, do it in code. |

### 5.4 When Advanced YAML Is Acceptable

- **In generated files** that agents consume but do not edit (e.g., export dumps).
- **In tool-internal files** that are never read directly by agents.
- **In CI/CD configuration** that is outside the Xurgo Atlas scope.

For all project-facing files that agents read and edit, use simple explicit YAML.

---

## 6. Token-Efficiency Principles

Xurgo Atlas should default to **orientation, not bulk content.** The tool's default behavior should assume the agent wants to find the right information, not download the entire knowledge base.

### 6.1 Principles

| # | Principle | Description |
|---|-----------|-------------|
| 1 | **Small default responses** | MCP responses should return summaries, paths, and metadata by default. Full content only when explicitly requested. |
| 2 | **Progressive disclosure** | Start with STATUS.md → manifest → section → full doc. Each level returns more detail. |
| 3 | **No full-doc dumps by default** | `docs.list` returns metadata, not content. `docs.read` returns the full document (as before) but bounded reads are available. |
| 4 | **Summaries and paths before content** | New tools like `docs.status` and `docs.manifest` return compact summaries. Agents orient first, then load specific content. |
| 5 | **Section reads before whole-doc reads** | `docs.read_section` returns one section of a document. For STATUS.md or large specs, this avoids loading content the agent does not need. |
| 6 | **Explicit size limits** | `docs.read` and `docs.read_section` accept `maxChars` and `maxBytes` options. |
| 7 | **Context packs with strict budgets** | `docs.context_pack` returns a bounded set of documents for a topic. Total size must not exceed the requested budget. |
| 8 | **Small LLM friendly** | A smaller LLM (3B–8B parameters) should be able to orient itself from `STATUS.md` + `docs/manifest.yml` without loading the whole docs tree. The total tokens for orientation should be under ~2K tokens. |

### 6.2 Target Metrics

| Metric | Target |
|--------|--------|
| Orientation tokens (STATUS.md front matter + manifest) | < 1K tokens |
| Status response (front matter only) | < 500 tokens |
| Manifest response (all paths + summaries) | < 1K tokens for small projects |
| Default `docs.list` response | Paths + roles only (no content) |
| Context pack for a single topic | Configurable, default max 4K tokens |

These are targets for the implementation, not hard limits. The principle is that the tool should default to being compact and let the agent request more detail.

---

## 7. MCP Tool Evolution

### 7.1 New Tools

| Tool | Description | Returns | Status |
|------|-------------|---------|--------|
| `docs.status` | Return the STATUS.md front page content | Front matter (parsed JSON) + raw front matter + body (truncated optionally) | ✅ Implemented |
| `docs.manifest` | Return the project's doc map | Parsed manifest YAML as JSON, optional raw YAML, path validation, maxDocuments truncation | ✅ Complete |
| `docs.read_section` | Read one section of a document by heading | Section content + heading metadata + bounded-read metadata | ✅ Complete |
| `docs.context_pack` | Return a curated set of documents for orientation or a topic | Ordered context items with per-item metadata within a total character budget | ✅ Complete |

### 7.2 Tool Options (Proposed Enhancements)

| Tool | New Option | Description |
|------|-----------|-------------|
| `docs.read` | `maxChars` | Return only the first N characters from the selected offset |
| `docs.read` | `offset` | Start reading from this character position (default 0) |
| `docs.list` | `compact` | Return minimal metadata (path + role) instead of full details |
| `docs.list` | `role` | Filter documents by role |
| `docs.find` | *(if needed later)* | Search document summaries or headings for a term |

### 7.3 Backward Compatibility

All existing tools continue to work exactly as before:

- `docs.read` without `maxChars` or `offset` returns the full document as today (with additional metadata fields `truncated: false`, `maxChars: null`, `offset: 0`, `returnedChars`, `totalChars`).
- `docs.list` without `compact` returns the current enriched output.
- All v0.1–v0.3 tools and workflows remain unchanged.

### 7.4 MCP Resource Evolution (Proposed)

| Resource | Status | Notes |
|----------|--------|-------|
| `docs://project/{id}/manifest` | Existing | Could be enhanced to return richer data |
| `docs://project/{id}/STATUS.md` | New | Direct access to STATUS.md as a resource |
| `docs://project/{id}/status` | New | Compact status as a resource |

---

## 8. Future UI Implication

A future read-only web UI should:

- **Open to STATUS.md as the default landing page.** The first thing a human sees is the same front page an agent sees.
- **Use docs/manifest.yml as the project navigation map.** The sidebar navigation is generated from the manifest, not from a filesystem scan.
- **Show compact status at the top.** Current focus, next actions, and blockers should be visible without scrolling.
- **Provide section-level navigation.** For long documents, the UI should support jumping to sections.
- **Respect protection rules.** Protected documents should be clearly marked. Editing should go through the MCP tool (propose + commit).

The UI is a consumer of the project context, not a separate source of truth. Everything the UI shows should be derivable from the documentation files and the MCP tool responses.

### 8.1 Minimal Read-Only REST API (Implemented)

The minimal REST API is implemented as a read-only facade over the working MCP context handlers, not a second documentation engine. It exists so a future local web UI can load orientation data with ordinary browser requests while MCP remains the authoritative tool surface for writes and agent workflows.

| Endpoint | Purpose | MCP equivalent | Notes |
|----------|---------|----------------|-------|
| `GET /health` | Daemon liveness | Existing health check | Already implemented as `{ "status": "ok" }` |
| `GET /projects` | List registered projects available to the daemon | Registry lookup / project resolver | Returns compact project records: `projectId`, timestamps, and default flag; no write actions |
| `GET /projects/:projectId/status` | Read the project front page | `docs.status` | Query: `branch`, `maxChars`; response mirrors status JSON |
| `GET /projects/:projectId/manifest` | Read the navigation map | `docs.manifest` | Query: `branch`, `maxDocuments`, `includeRaw`, `validatePaths`; response mirrors manifest JSON |
| `GET /projects/:projectId/docs/:path` | Read one managed document | bounded `docs.read` | `:path` must support nested docs paths via encoded or wildcard routing; query: `branch`, `maxChars`, `offset` |
| `GET /projects/:projectId/sections` | Read one Markdown section | `docs.read_section` | Query: `path`, `heading`, `branch`, `revision`, `level`, `occurrence`, `includeHeading`, `maxChars`, `offset` |
| `POST /projects/:projectId/context-pack` | Build a bounded orientation pack from structured read-only input | `docs.context_pack` | POST is acceptable here because the request can include arrays of paths/sections; it must not mutate state |

Request and response shapes should preserve the MCP field names where possible: `projectId`, `branch`, `revision`, `path`, `content`, `truncated`, `maxChars`, `offset`, `returnedChars`, and `totalChars`. REST handlers call the existing MCP handler internals so branch defaults, revision reads, section extraction, manifest parsing, and context-pack ordering stay consistent.

Errors should use ordinary HTTP status codes plus a JSON body shaped like `{ "error": { "code": "not_found", "message": "...", "details": { ... } } }`. Suggested mappings: invalid input -> 400, unknown project -> 404, missing file/section -> 404, unsafe path -> 400, untracked or policy-disallowed read -> 403, and unexpected server failure -> 500.

Path safety must reuse the existing traversal checks and policy/tracked-path logic used by `docs.read`, `docs.read_section`, and `docs.context_pack`. The REST layer should not read from the filesystem directly, scan arbitrary paths, or bypass the managed Git store.

The implemented REST API excludes write actions: no proposals, commits, preview-diff mutation paths, restore, export, branch merge, approval override, publishing, or release operations. Those remain MCP-only, where the guarded proposal workflow and audit trail already exist.

The first web UI opens to `STATUS.md` because it is the canonical front page for both humans and agents. It uses `docs/manifest.yml` for navigation rather than scanning the repository, then uses document and section endpoints for progressive disclosure.

### 8.2 Minimal Read-Only Web UI (Implemented)

The daemon now serves a minimal local read-only web UI at `/` and `/ui`, with static assets at `/ui/app.js` and `/ui/styles.css`. The UI opens to `STATUS.md`, loads `docs/manifest.yml` through the REST manifest endpoint for navigation, and reads selected documents through the bounded document REST endpoint.

The UI shows project, branch, revision, and path metadata for the current view. It includes copy actions for the current document, the selected Markdown section, and a context-pack style orientation bundle loaded through `POST /projects/:projectId/context-pack`. It does not expose editing, proposals, approvals, restore, export, merge, publishing, or other write workflows.

---

## 9. Relationship to .docs-policy.yml

The existing `.docs-policy.yml` safety policy should be extended to support the new protected files:

```yaml
# Current fields (unchanged)
protected_paths:
  - STATUS.md
  - AGENTS.md
  - .docs-policy.yml
  - docs/**

# docs/manifest.yml is covered by docs/**

# Current risk thresholds (unchanged)
largeDeletionThreshold: 0.25
headingRemovalDetection: true
fullFileReplacementDetection: true
```

`STATUS.md` and `docs/manifest.yml` should be high-priority protected documents by default, with the same protection level as `AGENTS.md`. Modifying them without proper intent/summary should be flagged as high risk.

---

## 10. Acceptance Criteria

The following criteria define when v0.4 can be considered implemented. They are listed here as a planning reference, not a commitment.

### 10.1 Init and File Creation

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `init` creates `STATUS.md` with front matter and minimal template | ✅ Complete |
| 2 | `init` creates `docs/manifest.yml` with entries for all standard files | ✅ Complete |
| 3 | `init` does not create `.docu-guard/` (v0.3 behavior preserved) | ✅ Already v0.3 |
| 4 | Existing projects can add STATUS.md and manifest without re-init | ⏳ Planned |

### 10.2 Protection and Policy

| # | Criterion | Status |
|---|-----------|--------|
| 5 | `STATUS.md` is protected by default (high risk to modify) | ✅ Complete | Canonical guarded root paths are merged into loaded policy |
| 6 | `docs/manifest.yml` is protected by default (high risk to modify) | ✅ Complete | Covered by `docs/**` |
| 7 | `.docs-policy.yml` default template includes STATUS.md and manifest | ✅ Complete | Template includes canonical guarded root paths; manifest is covered by `docs/**` |
| 8 | Intent validation covers STATUS.md and manifest edits | ⏳ Planned |

### 10.3 MCP Tools

| # | Criterion | Status |
|---|-----------|--------|
| 9 | `docs.status` returns STATUS.md front matter + body | ✅ Complete |
| 10 | `docs.status` input schema: `projectId` (required), `branch` (optional, default `'main'`), `maxChars` (optional, default `4000`) | ✅ Complete |
| 11 | `parseFrontMatter` extracts YAML front matter between `---` delimiters; returns `{frontMatter, rawFrontMatter, body}` | ✅ Complete |
| 12 | Missing STATUS.md returns clear error with hint to run `docu-guard init` | ✅ Complete |
| 13 | `docs.manifest` returns parsed manifest YAML as JSON | ✅ Complete |
| 14 | `docs.read` accepts `maxChars` and `offset` options | ✅ Complete | Also returns `truncated`, `returnedChars`, `totalChars`; backward-compatible |
| 15 | `docs.read_section` returns one section by heading | ✅ Complete |
| 16 | `docs.context_pack` returns bounded document set for a topic | ✅ Complete |
| 17 | `docs.list` accepts `compact` and `role` options | ⏳ Planned |
| 18 | All existing tools work unchanged with new options | ✅ Verified | Existing `docs.read` handler behavior covered by regression test |

### 10.4 Token Efficiency

| # | Criterion | Status |
|---|-----------|--------|
| 16 | Default `docs.list` response is compact (paths + roles) | ⏳ Planned |
| 17 | `docs.status` response is under 500 tokens for typical projects | ✅ Complete (template STATUS.md is ~150 tokens) |
| 18 | `docs.status` truncation respects `maxChars` exactly | ✅ Complete |
| 19 | `docs.manifest` response is under 1K tokens for small projects | ✅ Complete |
| 21 | Bounded reads respect `maxChars` exactly | ✅ Complete | `maxChars` + `offset` slice content precisely; `truncated` flag signals clipping |

### 10.5 Validation

| # | Criterion | Status |
|---|-----------|--------|
| 21 | Manifest validates that referenced paths exist | ✅ Complete |
| 23 | STATUS.md with invalid front matter is handled gracefully | ⏳ Planned |
| 24 | All tests from v0.1–v0.3 continue to pass | ✅ Verified | `npm test` passes with 137 tests |
| 25 | New tests cover implemented v0.4 context, REST, and UI surfaces | ✅ Complete | Covered by docs.status, docs.manifest, bounded docs.read, docs.read_section, STATUS.md guarded update, docs.context_pack, REST route, and UI asset tests; docs.list compact/role remains future work |

---

## 11. Implementation Order (Draft)

This is a suggested order for the implementation phase. It is subject to change.

| Phase | Work | Dependencies | Status |
|-------|------|-------------|--------|
| 1 | Define STATUS.md template and front matter schema | None | ✅ Complete |
| 2 | Define manifest.yml schema and validation | None | ✅ Complete |
| 3 | Update `init` to create STATUS.md and manifest | Phase 1, 2 | ✅ Complete |
| 4 | Add STATUS.md and manifest to default protected paths | Phase 3 | ✅ Complete |
| 5 | Implement `docs.status` tool | Phase 1 | ✅ Complete |
| 6 | Implement `docs.manifest` tool | Phase 2 | ✅ Complete |
| 7 | Implement `docs.read_section` tool | None (utility) | ✅ Complete |
| 8 | Add `maxChars`/`maxBytes` to `docs.read` | None | ✅ Complete | `maxChars` and `offset` implemented; also returns `truncated`, `returnedChars`, `totalChars` |
| 9 | Add `compact` and `role` options to `docs.list` | Phase 2 | ⏳ Planned |
| 10 | Implement `docs.context_pack` tool | Phase 1, 2 | ✅ Complete |
| 11 | Update .docs-policy.yml default template | Phase 3 | ✅ Complete |
| 12 | Write tests for all implemented v0.4 features | All phases | ✅ Complete for context tools, REST routes, and UI assets; docs.list compact/role remains future work |
| 13 | Update `docs/implementation-checklist.md` | All phases | ✅ Complete for stabilization audit |
| 14 | Dogfood: run v0.4 on docu-guard itself | All phases | ✅ Complete |

Phases 1–4 are the foundation. Phases 5–10 are the MCP tool features. Phases 11–14 are documentation, testing, and validation.

---

## 12. Open Questions

These questions should be answered during implementation:

1. **Should `docs.init` (a new tool) be added to add STATUS.md/manifest to existing projects?** Or should `docs.create_file` or similar serve this purpose?
2. **Should STATUS.md be mandatory?** What happens if a project has no STATUS.md?
3. **Should the manifest be auto-generated or manually maintained?** Auto-generation from `docs.list` is one option. Manual authoring gives more control. A hybrid (auto-generated skeleton + manual enrichment) may be best.
4. **What is the default template for STATUS.md?** Minimal (just front matter) or with guidance sections?
5. **Should `docs.context_pack` be a server-side or client-side feature?** Server-side can enforce token budgets. Client-side is more flexible but harder to bound.
6. **How should section-level reads handle deeply nested headings?** Return the heading and its direct content, or all subheadings too?

---

## 13. Summary

Xurgo Atlas v0.4 proposes an evolution from safe doc editing to **documentation-first project context.** By adding `STATUS.md` as the front page, `docs/manifest.yml` as the project map, and token-efficient access patterns, the tool becomes the primary orientation mechanism for AI agents joining any project.

The existing safety, versioning, and audit guarantees are preserved and extended to cover the new files. All existing tools and workflows remain backward-compatible.

The full vision is described in [`../vision/project-context-mcp.md`](../vision/project-context-mcp.md).

---

## 14. Xurgo Atlas Naming Migration Plan (Post-v0.4)

This section plans the mechanical rename and internal migration from legacy `docu-guard` naming toward Xurgo Atlas naming. It records intended phases only. No package, CLI, config, storage, MCP namespace, source-module, repository metadata, or runtime behavior changes are part of v0.4 stabilization.

### 14.1 Current Inventory

The current repo and checkout are named `xurgo-atlas`, and v0.4 is stable enough to treat as a private milestone at commit `cace1b1`. The implementation still intentionally contains transitional names:

| Surface | Current state | Planning note |
|---------|---------------|---------------|
| Product/app name | Xurgo Atlas | Use as the user-facing name in new docs |
| npm package | `docu-guard-mcp` in `package.json` and lockfile | Candidate future package name needs npm identity decision |
| CLI binary | `docu-guard` | Keep as compatibility alias for at least one transition period |
| MCP server identity | `docu-guard-mcp` default in `src/mcp/create-server.ts` | Can be renamed independently from tool namespace |
| MCP tools | `docs.*` | Keep initially; namespace rename is deferred unless strongly justified |
| Config/data defaults | `~/.config/docu-guard` and `~/.local/share/docu-guard` | Must not strand existing registries or managed stores |
| Generated project templates | AGENTS.md, STATUS.md, docs README, event paths | Update only when compatibility behavior is planned |
| Tests | project, registry, daemon, HTTP tests assert legacy names and paths | Update alongside implementation, not during planning |

### 14.2 Phase 1: Branding and Documentation Alignment

- Make Xurgo Atlas the user-facing product name in newly authored docs, status text, web UI copy, and future release material.
- Keep legacy `docu-guard-mcp`, `docu-guard`, and `docs.*` references where they describe currently true package, CLI, server, storage, or tool behavior.
- Treat older kickoff/PRD/spec documents as historical unless a current-status note is necessary for clarity.
- Do not rewrite every historical reference mechanically; update current-facing docs first, then implementation surfaces in later phases.

### 14.3 Phase 2: Internal Code and Package Naming

Evaluate whether the package should become `xurgo-atlas` or remain temporarily `docu-guard-mcp`. The decision should account for npm package availability, whether this remains private, and whether downstream MCP client configurations already reference the package name.

Likely implementation targets when this phase is approved:

- `package.json` and `package-lock.json` package name and `bin` metadata.
- `src/index.ts` CLI usage text and command examples.
- `src/mcp/create-server.ts` server metadata.
- `src/core/project.ts` generated AGENTS.md, docs README, STATUS.md template, initialization summary, and event path labels.
- `src/cli/*.ts` command descriptions, errors, daemon startup text, and project-management usage.
- Tests that assert package metadata, generated content, CLI output, server names, and legacy temp-path prefixes.

Risks:

- npm package identity changes can break installs, lockfiles, package exports, and binary resolution.
- Import names and local package references may need coordinated updates even if source file names do not change.
- Lockfile churn is expected and should be reviewed separately from behavioral code.
- Historical docs may still include legacy names by design; implementation tests should not require historical specs to be rewritten.

### 14.4 Phase 3: CLI and Server Compatibility

Plan a new CLI alias, likely `xurgo-atlas`, only after the package-name decision is made. Keep `docu-guard` as a compatibility alias for at least one transition period.

Compatibility requirements:

- Existing commands such as `docu-guard init`, `docu-guard server`, `docu-guard daemon`, `docu-guard project ...`, `docu-guard list`, `docu-guard history`, and `docu-guard export` must continue to work unless explicitly deprecated later.
- Help output can present `xurgo-atlas` as primary while documenting `docu-guard` as a legacy alias.
- MCP server metadata may move from `docu-guard-mcp` to Xurgo Atlas, but client-visible tool names should remain stable.
- Deprecation messaging should be informational and non-blocking during the compatibility period.

### 14.5 Phase 4: Config and Storage Compatibility

Do not destructively move config or data directories. Existing managed projects currently use legacy defaults such as `~/.config/docu-guard/projects.json` and `~/.local/share/docu-guard/projects/<id>/`. A future migration must preserve those stores.

Potential strategy:

1. Continue accepting explicit `--config-dir` and `--data-dir` paths exactly as today.
2. Add new Xurgo Atlas defaults only behind a planned migration step, for example `~/.config/xurgo-atlas` and `~/.local/share/xurgo-atlas`.
3. On startup, detect legacy registry/data locations if the new defaults are empty.
4. Prefer alias/read-through behavior first: use the discovered legacy location without moving files.
5. Offer an explicit migration command or documented manual copy before any physical move.
6. If a move is implemented, copy before switching, verify registry and project store integrity, preserve the legacy directory, and record a rollback path.

Rollback considerations:

- The legacy store should remain untouched until a user explicitly removes it.
- Registry records should include enough path information to reopen projects from either old or new locations.
- Failed migrations should leave the old registry/data usable with the `docu-guard` alias.
- Tests should cover legacy-only, new-only, both-present, explicit-dir, failed-copy, and rollback scenarios.

### 14.6 Phase 5: MCP Namespace Compatibility

Keep `docs.*` initially. The namespace is generic, already stable, and central to existing agent instructions. There is no compelling near-term reason to rename it as part of the product branding migration.

If a future namespace such as `atlas.*` is considered, it must be a separate compatibility project with:

- Aliases for all existing `docs.*` tools.
- Clear deprecation windows and client migration docs.
- Tool-list behavior that does not surprise existing MCP clients.
- Tests proving both namespaces resolve to the same handlers and preserve proposal/audit semantics.

### 14.7 Phase 6: Tests and Validation

When implementation begins, update or add tests for:

- Package metadata and binary aliases in `package.json` and `package-lock.json`.
- CLI help, command dispatch, error hints, and compatibility alias behavior.
- MCP server metadata and tool-list stability.
- Generated AGENTS.md, STATUS.md, docs README, policy, manifest, and event-log text.
- Config/data default path selection, legacy discovery, explicit path overrides, and non-destructive migration/rollback.
- Existing managed project compatibility using a fixture or temp legacy store.
- Pack/build/runtime smoke checks: `npm test`, `npm run build`, `npm pack --dry-run`, CLI help for both aliases, stdio MCP tool listing, daemon health, and read-only REST/UI smoke where relevant.

### 14.8 Phase 7: Private Release Strategy

This repo is private. Until explicit approval is given, do not push, tag, merge, publish, release, or make public artifacts.

Allowed private work now:

- Keep this plan and checklist updates in the private branch.
- Prepare implementation branches locally.
- Run validation, dry-run package checks, and local compatibility smoke tests.
- Review diffs for accidental runtime behavior changes before any rename implementation.

Requires explicit release approval:

- Publishing an npm package under any name.
- Removing or deprecating `docu-guard` workflows publicly.
- Moving default storage paths for real users.
- Pushing tags, merging milestone branches, creating releases, or making the repo/artifacts public.

### 14.9 Implementation Gate

Before any rename implementation starts, confirm:

- The package name decision and CLI alias policy.
- Whether storage defaults remain legacy for one more milestone or add Xurgo Atlas aliases.
- That `docs.*` remains the only MCP namespace for the initial migration.
- The exact test matrix and smoke commands.
- That no proposal UI, `docs.merge_branch`, write REST endpoints, publishing, tagging, pushing, or release work is included in the rename implementation.

---

## 15. Migration Implementation Readiness Inventory (Phase B Audit)

This audit refines the naming migration plan into an implementation inventory for a later small Phase B prompt. It is documentation-only. No package, CLI, config, storage, MCP namespace, source-module, repository metadata, or runtime behavior changes are made by this audit.

### 15.1 Package Metadata Candidates

| Surface | Current location | Current value | Later implementation note |
|---------|------------------|---------------|---------------------------|
| Package name | `package.json`, `package-lock.json` root package | `docu-guard-mcp` | Rename to `xurgo-atlas` only after package identity approval; this changes lockfile root metadata |
| Binary names | `package.json` `bin`, lockfile `packages[""].bin` | `docu-guard` -> `dist/index.js` | A future `xurgo-atlas` alias can be added while retaining `docu-guard` |
| Description | `package.json` | Safe, versioned, auditable documentation management for AI-assisted software projects | Candidate for Xurgo Atlas branding without changing behavior |
| Keywords | `package.json` | `mcp`, `model-context-protocol`, `documentation`, `docs`, `ai`, `version-control` | Candidate additions: `xurgo-atlas`, `project-context`; verify package policy first |
| Repository URLs | package metadata | None present | No package repository field to update in current state |
| Docs references | README, docs, AGENTS, historical specs | Mixed Xurgo Atlas and legacy implementation names | Current-facing docs can brand as Xurgo Atlas; historical specs may remain legacy |

Lockfile implication: any package name, bin, dependency, or metadata change must update `package-lock.json` in the same implementation commit. Expect root package metadata churn even when no dependencies change.

### 15.2 CLI Compatibility Candidates

Current CLI entrypoint is `src/index.ts`, exposed by `package.json` as the `docu-guard` binary. The parser does not inspect the invoked binary name, so adding `xurgo-atlas` as an additional bin pointing at `./dist/index.js` should be additive.

Candidate files for a later CLI slice:

- `package.json` and `package-lock.json`: add `xurgo-atlas` bin while keeping `docu-guard`.
- `src/index.ts`: optionally make help text present Xurgo Atlas as primary and `docu-guard` as compatibility alias.
- `src/cli/init.ts`, `src/cli/project.ts`, `src/cli/daemon.ts`: update display strings only if the slice includes user-facing branding.

Tests needed later:

- Package metadata test proving both `bin.docu-guard` and `bin.xurgo-atlas` point at `./dist/index.js`.
- Lockfile metadata test proving both aliases are represented in `packages[""].bin`.
- CLI smoke for `node dist/index.js --help` and, if package-link testing is added, both installed command aliases.
- Regression test that existing `docu-guard` workflows still dispatch the same commands.

### 15.3 Runtime and Server Naming Candidates

| Surface | Current location | Current value | Later compatibility note |
|---------|------------------|---------------|--------------------------|
| MCP server metadata | `src/mcp/create-server.ts` | default `docu-guard-mcp` | Can become Xurgo Atlas display name without changing `docs.*` tools |
| Stdio startup text | `src/cli/init.ts` server command | `Starting docu-guard server...` | Display-only candidate if tests capture stderr later |
| Daemon logs | `src/cli/daemon.ts` | `docu-guard daemon ...` and listening message | Display-only candidate; do not change endpoint paths |
| Help text | `src/index.ts`, `src/cli/project.ts` | `docu-guard` commands and storage defaults | Branding candidate, but must still document compatibility alias |
| User-facing errors | `src/cli/init.ts`, `src/core/registry.ts`, `src/mcp/tools.ts` | Hints suggest `docu-guard init` and `docu-guard project ...` | Must preserve actionable legacy command or mention both aliases |
| REST/MCP HTTP paths | `src/mcp/http.ts` | `/mcp`, REST context routes | Not a naming migration target in first slice |

### 15.4 Config and Storage Compatibility Candidates

Current defaults are active behavior:

- `src/core/storage.ts` returns `$XDG_CONFIG_HOME/docu-guard` or `~/.config/docu-guard`.
- `src/core/storage.ts` returns `$XDG_DATA_HOME/docu-guard` or `~/.local/share/docu-guard`.
- `StoragePaths.projectDataDir(projectId)` stores managed state under `<dataDir>/projects/<projectId>/`.
- `Registry.load(configDir, dataDir)` stores `configDir` and `dataDir` in registry schema v2 and resolves project stores through those paths.
- `Project.init` and `initCommand` warn when project-local `.docu-guard/` exists but do not migrate it.
- `src/core/git-store.ts` uses `.docu-guard-patch.tmp` as a temporary patch file name inside the managed workdir.
- `src/core/project.ts` logs initialization events with path `.docu-guard/init`.

Compatibility shim locations for a later storage phase:

- `src/core/storage.ts`: default path selection, legacy discovery, or alias/read-through logic.
- `src/core/registry.ts`: registry v2 path interpretation, both-present behavior, and error hints.
- `src/cli/init.ts` and `src/cli/daemon.ts`: startup display and explicit `--config-dir`/`--data-dir` behavior.
- `src/core/project.ts`: legacy project-local warning and generated event labels.
- `tests/project.test.ts`, `tests/registry.test.ts`, `tests/http-server.test.ts`, `tests/daemon.test.ts`: path-default, managed-dir, no-project-local-store, and registry-resolution assertions.

Storage migration should not be included in the first implementation slice. It risks orphaning existing managed stores unless legacy discovery, explicit directory precedence, both-present behavior, failed-migration rollback, and user-facing diagnostics are implemented together.

### 15.5 MCP Namespace Decision

Keep `docs.*` unchanged for now.

Changing the namespace would break or require coordinated updates to:

- Tool registration and dispatch cases in `src/mcp/tools.ts`.
- Tool descriptions that reference other `docs.*` tools.
- Resource URIs such as `docs://project/{id}/manifest` in `src/mcp/resources.ts` and docs.
- Agent instructions in AGENTS.md and generated AGENTS.md templates.
- README, changelog, specs, integration docs, and STATUS.md workflows.
- Tests in `tests/project.test.ts`, `tests/daemon.test.ts`, and HTTP/MCP smoke tests.
- Existing MCP client configurations and agent prompts that call `docs.read`, `docs.propose_patch`, or `docs.commit_patch`.

Namespace migration should be deferred unless explicitly approved as its own compatibility project with aliases, deprecation docs, and tests proving both namespaces route to identical handlers.

### 15.6 Documentation-Only Reference Classes

Safe branding candidates:

- Current-facing docs that describe the product direction, including STATUS.md, README, docs README, checklist summaries, and vision docs.
- Package description text in future implementation, if it avoids implying package identity changed before it did.
- UI/help copy that can say Xurgo Atlas while documenting legacy command aliases.

References that should remain as legacy compatibility notes or historical record:

- Current package, CLI, server metadata, config/data paths, and MCP namespace descriptions until implementation changes them.
- Historical kickoff, PRD, v0.2, and v0.3 specs where `docu-guard` was the original design term.
- AGENTS.md and generated AGENTS.md safety rules until the generated-template migration is explicitly included.
- Changelog entries for prior work.

### 15.7 Recommended First Implementation Slice

Recommended Phase B slice: add an additive `xurgo-atlas` package bin alias while retaining `docu-guard`, then update only minimal help/package display text needed to make the alias understandable.

Included in that slice:

- Add `xurgo-atlas` to `package.json` `bin` pointing at `./dist/index.js`, keeping `docu-guard` unchanged.
- Update `package-lock.json` root package bin metadata.
- Add tests for package and lockfile bin aliases.
- Optionally adjust `src/index.ts` help banner to show Xurgo Atlas as product name and `docu-guard` as compatibility alias.
- Run `npm test`, `npm run build`, `npm pack --dry-run`, and CLI help smoke.

Explicitly excluded from the first slice:

- Package name rename from `docu-guard-mcp` to `xurgo-atlas`.
- Config or data default path changes.
- Managed storage moves or migration helpers.
- MCP namespace changes away from `docs.*`.
- Source module renames.
- Proposal UI, `docs.merge_branch`, write REST endpoints, push/tag/merge/publish/release work.
