# Documentation

This directory contains Atlas-managed project documentation. Start with the user-facing setup and daemon references, then move into contributor, release, or historical material only when you need it.

## First-Time Setup

- [Project README](../README.md) - public overview, quick start, product boundaries, and main links
- [Setup](./atlas/setup.md) - install options, Node/npm prerequisites, initialization, templates, and first run
- [Daemon, CLI & MCP Reference](./atlas/daemon-mcp.md) - daemon workflow, MCP endpoint setup, JSON config for MCP clients, and live tool discovery

## Normal MCP and Managed-Docs Workflow

- [Daemon, CLI & MCP Reference](./atlas/daemon-mcp.md) - read/search/context tools, guarded proposals, `docs.preview_export`, `docs.export`, and `atlas.project_identity`
- [Root / Worktree Safety Model](./atlas/root-worktree-safety.md) - how Atlas identifies the project folder it is bound to and when write/export operations should stop

## Storage and Local Administration

- [Storage Migration](./atlas/storage-migration.md) - inspect Atlas storage, understand legacy storage fallback, and run conservative migration checks or copies

## Contributor and Release Work

- [Setup](./atlas/setup.md#contributor-checkout--validation) - repository checkout and basic validation commands
- [Development Workflow](./atlas/development-workflow.md) - validation tiers, smoke tests, private RC artifacts, and managed-doc export drift boundaries
- [Release Checklist](./atlas/release-checklist.md) - release authorization gates, validation, public package release maintenance, and post-release checks

## Advanced, Historical, and Design Material

These docs are useful for maintainers and design review, but they are not required first-run guidance:

- [Lifecycle State Surfaces](./atlas/lifecycle-state-surfaces.md) - state-surface and reconcile/export hardening notes
- [Project Resolution Hardening](./atlas/project-resolution-hardening.md) - historical 0.1.0 RC hardening tracker and remaining project-resolution follow-ups
- [Read-Only Identity Tools Plan](./atlas/readonly-identity-tools.md) - design record for read-only identity/root/lock status tools
- [SQLite Root / Worktree Safety Ledger](./atlas/sqlite-root-safety-ledger.md) - advanced design notes for root/worktree safety storage
- [Implementation Checklist](./implementation-checklist.md) - milestone and implementation status tracking

Historical specs under `docs/spec/**` and vision docs under `docs/vision/**` are auditable project context. Prefer current setup and daemon docs for operational instructions.
