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

# Quick validation — default dev loop
npm run validate:quick

# Full validation — before risky merges or release
npm run validate:full
```

## Validation Tiers

| Command | What it runs | When to use |
|---------|-------------|-------------|
| `npm run test:fast` | CLI + registry + storage-migration tests | During narrow edits |
| `npm run test:integration` | Project + daemon + HTTP tests | Before daemon changes |
| `npm test` | All tests | Before merge or release |
| `npm run validate:quick` | Fast tests + build | Default development loop |
| `npm run validate:full` | All tests + build + pack dry-run | Before risky merges or release |

## NPM Pack (Dry Run)

To verify the published package contents without publishing:

```bash
npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run
```

The published package is limited to `dist/`, `README.md`, and `package.json` (defined in `package.json` `files`).
