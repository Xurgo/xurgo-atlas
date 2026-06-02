# Project Context MCP — Expanded Vision

> **Working codename:** Xurgo Atlas (see [Naming note](#naming-note) below)
> **Status:** Vision / Planning — not yet implemented
> **Current product:** docu-guard-mcp (the MCP server and CLI)
> **Branch:** v0.2-daemon

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
| **docu-guard** | The safety, versioning, and audit layer. Guards every mutation, rejects corrupting changes, and records every event. |

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

> **Working codename "Xurgo Atlas":** This name is used here only as a placeholder for a potential broader product direction. No rename is approved or in progress.

### 5.1 What Xurgo Could Be

Xurgo is an exploratory concept for a broader AI-assisted development runtime. Within that concept, "Xurgo Atlas" would be the documentation, context, and memory layer — the part of the system that holds project knowledge durable across agent sessions.

### 5.2 Independence Requirement

**This MCP tool must not depend on Xurgo.** It must remain:

- Independently installable and runnable.
- Useful to any MCP-capable agent or tool: opencode, Claude, Codex, OpenClaw-like tools, Hermes-like tools, Cline, and others.
- Self-contained with no external runtime dependencies beyond Node.js and the project's own packages.

### 5.3 Why Independence Matters

- **Ecosystem reach.** The tool's value grows with the number of agents and runtimes that can use it. Tying it to a single runtime would limit adoption.
- **Separation of concerns.** Documentation management and agent runtime are different problems. Solving them independently leads to better design in both.
- **Future flexibility.** If Xurgo does not materialize, the MCP tool remains useful. If Xurgo does materialize, it can consume this tool as a dependency without any changes to the tool itself.

### 5.4 Codename Scope

"Xurgo Atlas" refers to the vision of documentation-first project context, not to any specific implementation or rename. It is a North Star for direction, not a brand or a package name.

---

## 6. Naming Note

The name **docu-guard** accurately describes the original focus — guarding documentation — but may be too narrow for the expanded vision, which encompasses project context, agent navigation, project memory, and safety governance under a single umbrella.

### 6.1 Current Constraints

- No rename is approved in this session.
- The package remains `docu-guard-mcp`.
- The CLI remains `docu-guard`.
- The MCP server name and tool namespace remain unchanged.
- Config paths remain at `~/.config/docu-guard/` and `~/.local/share/docu-guard/`.

### 6.2 Future Rename Criteria

If a rename is considered later, any new name should preserve these identities:

- **Docs-first identity.** The name should evoke documentation, knowledge, memory, or context — not just "guard."
- **Context/navigation identity.** The name should suggest wayfinding, orientation, or discovery, not just protection.
- **Safety/audit identity.** The name should not lose the connotation of safe, guarded operations.
- **Token-efficiency identity.** The name should hint at conciseness (Atlas carries this connotation — a concise map, not a full encyclopedia.)
- **Independence identity.** The name should not imply it is part of the broader Xurgo runtime. Even if Xurgo Atlas eventually uses this tool, the tool's name should stand on its own.

### 6.3 Recommended Approach

Until a rename is explicitly approved, use "docu-guard" as the product name and "project-context MCP" or "docs-first project context" as the directional description. "Xurgo Atlas" is a working codename for internal reference only.

---

## 7. Relationship to Existing v0.1–v0.3

The expanded vision does not invalidate existing work. It contextualizes it:

- **v0.1 (MVP):** Established the safe doc-editing MCP tool. The foundation.
- **v0.2 (Daemon):** Added multi-project daemon mode. The context server architecture.
- **v0.3 (Storage):** Moved managed state to configurable directories. Deployment-ready.
- **v0.4 (Project Context):** Adds STATUS.md, docs/manifest.yml, token-efficient access, and the project-context framing. This document proposes the v0.4 direction.

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
- The name may change if the project's scope outgrows "docu-guard."

Regardless of how these specifics evolve, the core principles — **safe, documented, auditable, token-efficient, independent** — should remain constant.
