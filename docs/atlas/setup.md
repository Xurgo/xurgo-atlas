# Setup

## Prerequisites

- Node.js >= 22
- npm

## Install

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd xurgo-atlas
npm install
npm run build
```

The CLI binary is `xurgo-atlas` (via `npm start` or `node dist/index.js`).

## Quick Start

Most users can follow this happy path without needing `--config-dir` or `--data-dir`.

```bash
# Initialize a project
xurgo-atlas init --project-id my-project --project-root .

# Start the daemon in background
xurgo-atlas daemon start

# Check setup status
xurgo-atlas status

# Print MCP client connection guidance
xurgo-atlas mcp-config
```

Stop here for normal use. The daemon serves the MCP endpoint at `http://127.0.0.1:3737/mcp`. Configure your MCP client using the snippet printed by `xurgo-atlas mcp-config`.

### Init Templates

`xurgo-atlas init` supports optional documentation templates for bootstrapping project docs:

```bash
# List available templates
xurgo-atlas init --templates

# Initialize with a template
xurgo-atlas init --template saas --project-id my-project

# Short form
xurgo-atlas init -t mcp-server --project-id my-project
```

Templates are **documentation/memory templates**, not app-code scaffolds. They create missing project docs only:

| Template | Description |
|----------|-------------|
| `default` | Generic project with standard Atlas docs and project brief |
| `saas` | SaaS product with product brief, MVP scope, and development workflow |
| `cli-tool` | CLI tool with command surface docs, packaging notes, and validation workflow |
| `mcp-server` | MCP server with tool/resource surface, daemon setup, and safety boundaries |
| `web-app` | Web application with product brief, route structure, and frontend architecture |

**Existing docs are preserved by default.** Templates create missing files only. For a cloned repo that already has project docs, usually omit `--template` — plain `init --project-id <id>` is the standard workflow. Use `--template <name>` for new/empty projects or when intentionally filling missing docs.

For advanced configuration — custom storage roots, daemon options, or legacy migration — see the reference docs linked from [docs/README.md](../README.md).

## Build & Test

```bash
# Build the TypeScript source
npm run build

# Fast tests (narrow edits)
npm run test:fast

# Integration tests (daemon, HTTP, lifecycle)
npm run test:integration

# Full test suite
npm test
```

## Working with the Full Workflow

This project uses three layers beyond the test suite:

- **`npm run validate:*`** — Repo-level validation gates (tests + build)
- **`npm run verify:*`** — Installed-package runtime smoke checks
- **`npm run bundle:*`** — Local private RC artifact bundle generation

See [docs/atlas/development-workflow.md](./development-workflow.md) for the complete reference on validation tiers, smoke testing, artifact generation, and script naming conventions.

## NPM Pack (Dry Run)

To verify the published package contents without publishing:

```bash
npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run
```

The published package is limited to `dist/`, `README.md`, and `package.json` (defined in `package.json` `files`).
