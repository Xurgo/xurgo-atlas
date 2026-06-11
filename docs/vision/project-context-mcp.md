# Xurgo Atlas — Documentation-First Project Context

> **Product name:** Xurgo Atlas
> **Current implementation:** xurgo-atlas (public package/CLI with legacy compatibility notes in archived docs)
> **Status:** Vision / Planning — not yet implemented
> **Branch:** v0.2-daemon
> **Integration:** [`xurgo-integration.md`](./xurgo-integration.md)

---

## 1. Current Identity

docu-guard-mcp began as a focused tool: **safe, versioned, auditable documentation management for AI-assisted software projects.**

Its core value proposition is:

- Agents can read and edit project documentation without corrupting it.
- Every change is tracked in Git and an event log.
- Dangerous operations (large deletions, protected file edits, etc.) are flagged and require explicit override.
- The tool enforces a `baseRevision` check so agents cannot accidentally overwrite each other's work.

This identity remains true and essential. The safety, versioning, and audit layers are the project's foundation and its strongest differentiator.

---

## 2. Expanded Identity

The project is evolving into a **documentation-first project context system for AI agents.**

The core insight is that documentation is not just a deliverable — it is a project's memory. For AI agents that join and leave projects repeatedly, the documentation tree is the only persistent shared context. The tool that manages that context well becomes the agent's primary interface for understanding what the project is, what matters now, and what is safe to do.

The expanded identity can be summarized as:

| Concept | Role |
|---------|------|
| **Docs** | The body of memory. Every document is a durable record. |
| **STATUS.md** | The front page of memory. A short, always-current snapshot that orients agents immediately. |
| **docs/manifest.yml** | The project knowledge map. A compact machine-readable index of all documents and their roles. |
| **AGENTS.md** | The agent operating contract. Rules, conventions, and boundaries every agent must follow. |
| **.docs-policy.yml** | The safety policy. Configurable rules for risk detection, protected paths, and intent validation. |
| **Xurgo Atlas** | The safety, versioning, and audit layer. Guards every mutation, rejects corrupting changes, and records every event. |

Together, these files form a **project context layer** that any MCP-capable agent can use to orient itself, find canonical information, and make safe changes.

---

## 3. What the Tool Does

The tool helps AI agents answer these questions reliably:

| Question | How the tool helps |
|----------|-------------------|
| **What is this project?** | `docs.manifest` returns the project map. `STATUS.md` is the front page. |
| **What matters right now?** | `docs.status` returns the current focus, next actions, and blockers from `STATUS.md`. |
| **What docs are canonical?** | `docs/manifest.yml` marks entrypoints, roles, and priorities. |
| **What should I read before acting?** | `docs.context_pack` returns a minimal set of docs for a given topic. |
| **What is safe to edit?** | Policy rules, protected paths, and risk thresholds defined in `.docs-policy.yml`. |
| **What is blocked or pending?** | `STATUS.md` lists blockers and do-not-do items. The event log tracks what changed and why. |
| **How do I propose changes without corrupting project knowledge?** | `docs.propose_patch` with `baseRevision` validation, risk detection, and full audit trail. |
| **What changed, when, and why?** | `docs.history` returns a unified timeline of Git commits and events. |

The guiding principle: **a new agent joining a project should be able to orient itself in one or two MCP calls without loading the entire documentation tree.**

---

## 4. Product Scope

### 4.1 Guarded Documentation Management

The original mission — safe, versioned, auditable document editing via MCP — remains the core capability. Every new feature builds on this foundation.

### 4.2 Project Memory

The documentation tree is treated as durable project memory. Every document has a revision, a history, and an audit trail. The tool does not just store text — it preserves context across agent sessions.

Key capabilities:
- Revision-tracked reads and writes.
- Full history and restore.
- Event log for every mutation.
- Protected documents that require special approval to modify.

### 4.3 Agent Context Navigation

Agents need to find the right information quickly without loading everything. The tool provides:
- A project manifest (`docs/manifest.yml`) that maps all documents by role and priority.
- A status document (`STATUS.md`) that is the default entry point.
- Compact, token-efficient MCP responses that return summaries and paths before full content.
- Progressive disclosure: read sections before whole documents.

### 4.4 Roadmap and Implementation Tracking

The tool tracks and manages its own roadmap through guarded docs. Implementation checklists, planned features, and known gaps live in the docs tree and benefit from the same safety/versioning/audit guarantees as any other document.

### 4.5 Safety and Governance

This is the core differentiator from a plain file server or generic MCP tool. Safety features include:
- Base revision matching to prevent overwrite conflicts.
- Large deletion detection (>25% threshold, configurable).
- Heading removal detection.
- Full file replacement detection.
- Protected file change flagging (AGENTS.md, .docs-policy.yml, STATUS.md, manifest).
- Intent validation for sensitive operations.
- Risk override with explicit acknowledgment.
- Complete audit trail through Git commits and event log.

### 4.6 Multi-Project Local Context Server

The daemon mode (v0.2) enables a single running process to serve multiple projects from a local registry. This is the foundation for a developer's local context server — one daemon that provides project context for all their repositories.

### 4.7 Future Human UI

A future read-only web UI (post-MVP) should:
- Open to `STATUS.md` as the default landing page.
- Use `docs/manifest.yml` as the project navigation map.
- Provide a human-friendly view of the same context that agents see programmatically.
- Respect the same safety and governance rules (read-only by default).

---

## 5. Relationship to Xurgo

> See the dedicated integration alignment doc at [`xurgo-integration.md`](./xurgo-integration.md) for the full boundary definition and MCP integration model.

### 5.1 What Xurgo Is

Xurgo is a terminal-native agent workbench and runtime. It is a separate project with its own repository, build system, and release cycle. Xurgo owns the agent workspace — runs, threads, session memory, tool orchestration, approvals, and provider routing.

### 5.2 What Xurgo Atlas Is

Xurgo Atlas is the documentation-first project context MCP layer. It owns canonical project documentation, STATUS.md, AGENTS.md, .docs-policy.yml, docs/manifest.yml, roadmap/specs/checklists, document history, patch proposals, diffs, restore/export, and token-efficient context tools.

### 5.3 Independence Requirement

**Xurgo Atlas must not depend on Xurgo.** It must remain:

- Independently installable and runnable without Xurgo.
- Useful to any MCP-capable agent or tool: opencode, Claude, Codex, OpenClaw-like tools, Hermes-like tools, Cline, and others.
- Self-contained with no external runtime dependencies beyond Node.js and the project's own packages.

### 5.4 How They Relate

- Xurgo **may** consume Xurgo Atlas as an MCP server for docs and context.
- Xurgo Atlas is designed to be consumed by any MCP client — Xurgo is one consumer among many.
- The relationship is asymmetrical: Xurgo Atlas must compile, test, and run without Xurgo, but Xurgo may choose to depend on Xurgo Atlas for canonical project context.

### 5.5 Memory Boundary

- Xurgo memory is **operational** — session scope, ephemeral, user-preference-driven.
- Xurgo Atlas memory is **canonical** — project scope, durable, Git-versioned, auditable.
- Xurgo may propose durable project learning by submitting doc patches to Xurgo Atlas.
- Xurgo Atlas validates and records canonical changes through its propose/commit workflow.

---

## 6. Transition Naming Note

**Xurgo Atlas** is the intended product and application name going forward. The name reflects the expanded vision — project context, agent navigation, project memory, and safety governance under a single umbrella.

### 6.1 Current Implementation Names (Transitional)

During this transition period, the implementation may still be referred to by its earlier names where necessary for technical accuracy:

| Aspect | Current Name | Notes |
|--------|-------------|-------|
| Package | `xurgo-atlas` | Current public npm package name |
| CLI | `xurgo-atlas` | Current primary public CLI |
| Repository | `xurgo-atlas` | Current public repository name |
| MCP server | `xurgo-atlas` | Current MCP server identity shown in integration output |
| Tool namespace | `docs.*` | Stable MCP tool namespace |
| Config paths | `~/.config/xurgo-atlas/` | Current default XDG config path |
| Data paths | `~/.local/share/xurgo-atlas/` | Current default XDG data path |

Historical design notes may still refer to `docu-guard-mcp`, `docu-guard`, or legacy storage paths where they describe pre-rename behavior or migration compatibility.

### 6.2 Naming in Documentation

- **New docs** use "Xurgo Atlas" as the product name.
- This document and other vision/spec docs are being updated to reflect the product name.
- References to `docu-guard-mcp` or `docu-guard` are retained only when discussing archived pre-rename design history or migration compatibility.
- Avoid using "docu-guard" as the future product name in new content.

### 6.3 Preserved Identities

The name "Xurgo Atlas" was chosen to preserve these identities:

- **Docs-first identity.** "Atlas" evokes a collection of knowledge, not just a guard.
- **Context/navigation identity.** "Atlas" suggests wayfinding, orientation, and discovery.
- **Safety/audit identity.** The safety, versioning, and audit guarantees remain regardless of the product name.
- **Token-efficiency identity.** "Atlas" hints at concise maps rather than full encyclopedias.
- **Independence identity.** "Xurgo Atlas" stands on its own as a product name, even though Xurgo may consume it. It is not "Xurgo Runtime Docs" — it is a separate product with its own identity.

---

## 7. Relationship to Existing v0.1–v0.3

The expanded vision does not invalidate existing work. It contextualizes it:

- **v0.1 (MVP):** Established the safe doc-editing MCP tool. The foundation.
- **v0.2 (Daemon):** Added multi-project daemon mode. The context server architecture.
- **v0.3 (Storage):** Moved managed state to configurable directories. Deployment-ready.
- **v0.4 (Project Context):** Adds STATUS.md, docs/manifest.yml, token-efficient access, and the project-context framing under the Xurgo Atlas product name.

---

## 8. Principles for Future Development

1. **Safety first.** Every new feature must maintain or improve the safety guarantees. Speed and convenience never override safety.
2. **Token efficiency.** Default MCP responses should be compact. Agents should not pay for content they did not request.
3. **Progressive disclosure.** Return summaries and paths first. Full content on demand. Section reads before whole-doc reads.
4. **One code path for all deployments.** Desktop, VPS, Docker — the same code, different configurable paths.
5. **Independent by design.** No hard dependency on any specific agent, runtime, or AI provider.
6. **YAML as metadata, not a programming language.** Use simple explicit YAML references. Avoid cross-file imports, anchors/aliases as primary linking, multi-doc YAML as the default graph, or hidden merge behavior.
7. **Docs are the source of truth.** The project context is authored and maintained in documentation files, not in a separate database or configuration store that can drift from the docs.

---

## 9. Future-Proofing

The vision described here is intentionally broader than any single implementation. As the project evolves:

- Individual features may be added, deferred, or reordered based on user needs.
- The "project context" framing may deepen as more agents adopt MCP and need better orientation mechanisms.
- The relationship to Xurgo may become more concrete or may recede depending on external developments.
- The implementation names (package, CLI, repo, config paths) may be renamed if the transition to "Xurgo Atlas" is carried out.

Regardless of how these specifics evolve, the core principles — **safe, documented, auditable, token-efficient, independent** — should remain constant.
