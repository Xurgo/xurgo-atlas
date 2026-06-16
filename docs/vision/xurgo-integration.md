# Xurgo Atlas — Xurgo Integration Alignment

> **Product name:** Xurgo Atlas
> **Current implementation:** xurgo-atlas (public package; historical docu-guard references remain in archived notes)
> **See also:** [`project-context-mcp.md`](./project-context-mcp.md)
> **Branch:** v0.2-daemon

---

## 1. Relationship Summary

| Layer | Owns |
|-------|------|
| **Xurgo** | Agent runtime / workbench. Owns runs. |
| **Xurgo Atlas** | Documentation-first project context MCP layer. Owns canonical project context. |

Xurgo is a terminal-native agent workbench/runtime. Xurgo Atlas is the MCP server that provides safe, versioned, auditable project documentation and context.

Xurgo **may** use Xurgo Atlas as its docs/context/memory layer, but Xurgo Atlas **must not** require Xurgo. Xurgo Atlas must remain independently useful to any MCP-capable agent — Codex, opencode, Claude, OpenClaw-like tools, Hermes-like tools, Cline, and others.

---

## 2. Naming / Transition Status

- **Xurgo Atlas** is the intended product and application name going forward.
- The current npm package name is **xurgo-atlas**.
- The current primary CLI is **xurgo-atlas**.
- The current repository name is **xurgo-atlas**.
- Legacy `docu-guard` references may still appear in archived historical design notes and migration-oriented documentation.
- MCP tool names remain under the stable `docs.*` namespace.
- Legacy `docu-guard` config and data roots are still relevant only where documentation is describing migration compatibility.

All new documentation should use **Xurgo Atlas** as the product name. References to `docu-guard-mcp` or `docu-guard` are retained only when discussing historical pre-rename design notes or migration compatibility.

---

## 3. Project Boundaries

### Xurgo owns

- Terminal UI / TUI workspace
- Project, thread, and run lifecycle management
- Event stream
- Worker and evaluator orchestration
- Approvals and permission gates
- Model and provider routing
- Artifact references
- Session memory
- User preferences
- Skill memory
- MCP server management and permission profiles

### Xurgo Atlas owns

- Canonical project documentation
- `STATUS.md` — project front page
- `AGENTS.md` — agent operating contract
- `.docs-policy.yml` — safety policy
- `docs/manifest.yml` — machine-readable project map
- Roadmap, specs, and implementation checklists
- Document history and revisions
- Document patch proposals
- Previewable diffs
- Protected-document policy enforcement
- Document restore and export
- Token-efficient project context tools (`docs.status`, `docs.manifest`, `docs.read_section`, `docs.context_pack`)

### Shared concern

Both systems deal with **memory** — but at different levels:
- Xurgo holds **operational session memory** (what happened in this run, what the user prefers).
- Xurgo Atlas holds **canonical project memory** (what the project is, what is true, what is safe).

The contract between them: Xurgo may propose additions to project memory by submitting doc patches. Xurgo Atlas validates and records the canonical version.

---

## 4. Memory Split

| Aspect | Xurgo Memory | Xurgo Atlas Memory |
|--------|--------------|---------------------|
| Nature | Operational | Canonical |
| Scope | Session, thread, user | Project-wide, durable |
| Persistence | Ephemeral or user-scoped | Git-backed, versioned, auditable |
| Mutation | Implicit (event stream) | Explicit (propose + commit patch) |
| Safety | Runtime permission gates | Base revision matching, policy, risk detection |
| Access | Internal to Xurgo | MCP tools, open to all agents |

### Durable project learning

When Xurgo learns something about a project that should persist beyond the current session — a design decision, a convention, a blocker — it should propose the insight as a documentation or context patch through Xurgo Atlas. The insight becomes canonical only after it is committed and revision-tracked.

This means:
- Xurgo **may propose memory patches** (using `docs.propose_patch` or `docs.restore_file`).
- Xurgo Atlas **validates and records** canonical doc changes (using `docs.commit_patch` with risk detection and audit).
- An evaluator agent or human-in-the-loop can review proposals before they become canonical.

---

## 5. MCP Integration Model

### 5.1 Connection

Xurgo connects to Xurgo Atlas as a standard MCP client. No custom protocol, no shared code, no internal API calls.

```
Xurgo  ──MCP──►  Xurgo Atlas (docu-guard-mcp)
```

### 5.2 Data vs. Instructions

Xurgo should treat all MCP output from Xurgo Atlas as **data**, not instructions. Document content, status summaries, and manifest entries are inputs to Xurgo's reasoning, not commands to execute.

### 5.3 Read Tools — Low Risk

Xurgo can call these without special permissions:

- `docs.list` — discover documents
- `docs.read` — read document content
- `docs.status` — read STATUS.md (proposed v0.4)
- `docs.manifest` — read project map (proposed v0.4)
- `docs.read_section` — read one section (proposed v0.4)
- `docs.history` — view document history
- `docs.preview_diff` — preview a patch before deciding

### 5.4 Write / Proposal / Commit Tools — Permission Policy Required

These operations change canonical project memory and must be governed by Xurgo's permission system:

- `docs.propose_patch` — propose a document change
- `docs.commit_patch` — commit a pending proposal
- `docs.restore_file` — restore a document to a previous revision
- `docs.create_branch` — create a feature branch for multi-step edits

### 5.5 Agent Role Guidance

| Agent Type | Recommended Access |
|------------|--------------------|
| Evaluator (reviewing context) | Read-only — `docs.list`, `docs.read`, `docs.status`, `docs.manifest` |
| Worker (executing a task) | Read + limited write — may propose patches under approval |
| Coordinator (planning work) | Read + write — may create branches and commit reviewed proposals |

### 5.6 Cross-Reference IDs

Xurgo events may reference Xurgo Atlas IDs for traceability:

| ID Type | Example |
|---------|---------|
| `projectId` | `my-app` |
| `path` | `docs/spec/auth-prd.md` |
| `revision` | `a1b2c3d` (Git commit hash) |
| `branch` | `feature/agent-review` |
| `proposalId` | `uuid-v4` |
| `commitId` | `a1b2c3d` |
| `export.path` | `/tmp/xurgo-atlas-export/my-app/docs/spec/auth-prd.md` |
| `event.id` | `uuid-v4` |

---

## 6. Token-Efficiency Contract

Xurgo should consume Xurgo Atlas MCP output efficiently to keep model context under budget:

| Principle | Guidance |
|-----------|----------|
| **Front page first** | Prefer `docs.status` (or read STATUS.md) before any other document. STATUS.md contains the current focus, next actions, and blockers. |
| **Manifest before content** | Read `docs.manifest` to discover the project map before loading individual documents. The manifest is compact and orients the agent. |
| **Compact metadata before full reads** | Use `docs.list` with compact options to see what is available. Use `docs.manifest` for roles and summaries. Load full documents only when needed. |
| **Section reads before whole-doc reads** | Use `docs.read_section` to read one section of a long document. For example, read only the "Acceptance Criteria" section of a spec, not the entire file. |
| **Bounded reads** | Use `maxChars` or `maxBytes` on `docs.read` when you need only a preview or the first N characters. |
| **Large content → artifact reference** | Large diffs, full event logs, or long output should be written to an artifact or file and referenced by path, not stuffed into the model context window. |
| **Context packs** | When available, use `docs.context_pack` to request a bounded set of documents for a specific topic with a hard token budget. |

---

## 7. Alignment Mechanism

The two projects remain in separate repositories with independent release cycles. Alignment is maintained through:

| Mechanism | Description |
|-----------|-------------|
| **This integration doc** | Lives in the Xurgo Atlas repo. Updated when the integration contract changes. |
| **Xurgo usage note (future)** | A matching short document in the Xurgo repo that explains how to connect to Xurgo Atlas as an MCP server. |
| **Versioned MCP behavior** | Xurgo Atlas MCP tools follow semantic versioning. Breaking changes are announced via the event log and changelog. |
| **Integration fixtures (future)** | Shared test fixtures or example projects that both repos can use for integration testing. |
| **Dogfood integration (future)** | Once both sides are ready, run Xurgo using Xurgo Atlas as its MCP docs layer for real development. |
| **No shared code** | Avoid sharing source code between repositories until a stable integration contract emerges. Shared types or schemas can be copied or versioned independently. |

---

## 8. Non-Goals for Now

The following items are explicitly **not** being addressed in this session or in the current scope:

- **No monorepo decision.** The two projects remain in separate repositories. A monorepo may or may not make sense in the future.
- **No mechanical rename in this session.** Package names, CLI names, MCP server names, tool namespaces, config paths, and repository URLs are not being changed.
- **No hard dependency from Xurgo Atlas to Xurgo.** Xurgo Atlas must compile, test, pack, and run without Xurgo installed.
- **No web UI implementation.** Future UI considerations belong in a separate planning track.
- **No Xurgo runtime implementation here.** Xurgo is a separate project with its own repository, build system, and release cycle.
- **No replacement of Xurgo event sourcing.** Xurgo Atlas storage does not replace Xurgo's operational event stream or session memory. They serve different purposes (canonical vs. operational).
- **No hidden durable memory writes.** Xurgo Atlas never writes to managed storage without an explicit MCP call that the agent controls. No silent/side-effect writes.
