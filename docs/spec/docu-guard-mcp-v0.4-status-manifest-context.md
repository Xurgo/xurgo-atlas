# Xurgo Atlas v0.4 — STATUS.md, Manifest, and Token-Efficient Context

> **Product name:** Xurgo Atlas
> **Current implementation:** docu-guard-mcp (transitional package/CLI)
> **Status:** Planning / Spec — not yet implemented
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
2. **No web UI implementation.** Future UI considerations are noted but not designed.
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

## 7. Proposed MCP Tool Evolution

### 7.1 New Tools (Proposed)

| Tool | Description | Returns |
|------|-------------|---------|
| `docs.status` | Return the STATUS.md front page content | Front matter + Markdown body (truncated optionally) |
| `docs.manifest` | Return the project's doc map | Parsed manifest YAML as JSON |
| `docs.read_section` | Read one section of a document by heading | Section content + heading level |
| `docs.context_pack` | Return a curated set of documents for a topic | Compact document set within token budget |

### 7.2 Tool Options (Proposed Enhancements)

| Tool | New Option | Description |
|------|-----------|-------------|
| `docs.read` | `maxChars` | Return only the first N characters |
| `docs.read` | `maxBytes` | Return only the first N bytes |
| `docs.list` | `compact` | Return minimal metadata (path + role) instead of full details |
| `docs.list` | `role` | Filter documents by role |
| `docs.find` | *(if needed later)* | Search document summaries or headings for a term |

### 7.3 Backward Compatibility

All existing tools continue to work exactly as before:

- `docs.read` without `maxChars`/`maxBytes` returns the full document as today.
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

- **Open to STATUS.md as the default landing page.** The first thing a human sees should be the same front page an agent sees.
- **Use docs/manifest.yml as the project navigation map.** The sidebar or navigation tree should be generated from the manifest, not from a filesystem scan.
- **Show compact status at the top.** Current focus, next actions, and blockers should be visible without scrolling.
- **Provide section-level navigation.** For long documents, the UI should support jumping to sections.
- **Respect protection rules.** Protected documents should be clearly marked. Editing should go through the MCP tool (propose + commit).

The UI is a consumer of the project context, not a separate source of truth. Everything the UI shows should be derivable from the documentation files and the MCP tool responses.

---

## 9. Relationship to .docs-policy.yml

The existing `.docs-policy.yml` safety policy should be extended to support the new protected files:

```yaml
# Current fields (unchanged)
protectedPaths:
  - AGENTS.md
  - .docs-policy.yml
  - docs/implementation-checklist.md

# New protected paths for v0.4
  - STATUS.md
  - docs/manifest.yml

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
| 1 | `init` creates `STATUS.md` with front matter and minimal template | ⏳ Planned |
| 2 | `init` creates `docs/manifest.yml` with entries for all standard files | ⏳ Planned |
| 3 | `init` does not create `.docu-guard/` (v0.3 behavior preserved) | ✅ Already v0.3 |
| 4 | Existing projects can add STATUS.md and manifest without re-init | ⏳ Planned |

### 10.2 Protection and Policy

| # | Criterion | Status |
|---|-----------|--------|
| 5 | `STATUS.md` is protected by default (high risk to modify) | ⏳ Planned |
| 6 | `docs/manifest.yml` is protected by default (high risk to modify) | ⏳ Planned |
| 7 | `.docs-policy.yml` default template includes STATUS.md and manifest | ⏳ Planned |
| 8 | Intent validation covers STATUS.md and manifest edits | ⏳ Planned |

### 10.3 MCP Tools

| # | Criterion | Status |
|---|-----------|--------|
| 9 | `docs.status` returns STATUS.md front matter + body | ⏳ Planned |
| 10 | `docs.manifest` returns parsed manifest YAML as JSON | ⏳ Planned |
| 11 | `docs.read` accepts `maxChars` and `maxBytes` options | ⏳ Planned |
| 12 | `docs.read_section` returns one section by heading | ⏳ Planned |
| 13 | `docs.context_pack` returns bounded document set for a topic | ⏳ Planned |
| 14 | `docs.list` accepts `compact` and `role` options | ⏳ Planned |
| 15 | All existing tools work unchanged with new options | ⏳ Must verify |

### 10.4 Token Efficiency

| # | Criterion | Status |
|---|-----------|--------|
| 16 | Default `docs.list` response is compact (paths + roles) | ⏳ Planned |
| 17 | `docs.status` response is under 500 tokens for typical projects | ⏳ Planned |
| 18 | `docs.manifest` response is under 1K tokens for small projects | ⏳ Planned |
| 19 | Orientation from STATUS.md + manifest is under 2K tokens total | ⏳ Planned |
| 20 | Bounded reads respect `maxChars`/`maxBytes` exactly | ⏳ Planned |

### 10.5 Validation

| # | Criterion | Status |
|---|-----------|--------|
| 21 | Manifest validates that referenced paths exist | ⏳ Planned |
| 22 | Manifest with nonexistent path returns clear error | ⏳ Planned |
| 23 | STATUS.md with invalid front matter is handled gracefully | ⏳ Planned |
| 24 | All tests from v0.1–v0.3 continue to pass | ⏳ Must verify |
| 25 | New tests cover all new tools and options | ⏳ Planned |

---

## 11. Implementation Order (Draft)

This is a suggested order for the implementation phase. It is subject to change.

| Phase | Work | Dependencies |
|-------|------|-------------|
| 1 | Define STATUS.md template and front matter schema | None |
| 2 | Define manifest.yml schema and validation | None |
| 3 | Update `init` to create STATUS.md and manifest | Phase 1, 2 |
| 4 | Add STATUS.md and manifest to default protected paths | Phase 3 |
| 5 | Implement `docs.status` tool | Phase 1 |
| 6 | Implement `docs.manifest` tool | Phase 2 |
| 7 | Implement `docs.read_section` tool | None (utility) |
| 8 | Add `maxChars`/`maxBytes` to `docs.read` | None |
| 9 | Add `compact` and `role` options to `docs.list` | Phase 2 |
| 10 | Implement `docs.context_pack` tool | Phase 1, 2 |
| 11 | Update .docs-policy.yml default template | Phase 3 |
| 12 | Write tests for all new features | All phases |
| 13 | Update `docs/implementation-checklist.md` | All phases |
| 14 | Dogfood: run v0.4 on docu-guard itself | All phases |

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
