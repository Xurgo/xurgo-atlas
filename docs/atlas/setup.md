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

```bash
# Initialize a project
xurgo-atlas init /path/to/project

# Start the MCP server in stdio mode
xurgo-atlas server

# Start the daemon in background
xurgo-atlas daemon start
```

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
