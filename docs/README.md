# Documentation

This directory contains project documentation managed by Xurgo Atlas.

## Reference Docs

- [Setup & Validation](./atlas/setup.md) — Install, build, test, validation commands
- [Daemon & MCP Configuration](./atlas/daemon-mcp.md) — Daemon lifecycle, MCP endpoint setup
- [Storage Migration](./atlas/storage-migration.md) — Inspect, migrate dry-run, migrate apply
- [Release Checklist](./atlas/release-checklist.md) — Pre-release validation and release steps
- [Implementation Checklist](./implementation-checklist.md) — Feature and milestone status

## Dogfooding

This directory and its files are managed through the Xurgo Atlas guarded docs workflow. `docs.commit_patch` updates Atlas-managed state only, so run `docs.export` before reading from disk or creating Git commits when you need the working tree to catch up.

