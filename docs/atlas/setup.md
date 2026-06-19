# Setup

## Consumer Install & First Run

### Prerequisites

- Node.js >= 22
- npm

Install Xurgo Atlas globally for the normal CLI workflow:

```bash
npm install -g xurgo-atlas
```

If you want to try Atlas without installing it first, or keep it pinned inside a repo, use `npx xurgo-atlas ...` instead. For project-local automation, install it as a dev dependency with `npm install -D xurgo-atlas`.

Verify that the CLI is available:

```bash
xurgo-atlas --version
```

Initialize Atlas in the project you want it to govern:

```bash
xurgo-atlas init --project-id my-project --project-root .
```

`init` writes a local `.xurgo-atlas/project.json` marker in the project root. The marker stores the project id only, not an absolute project root. That identity is sticky: Atlas preserves the matching marker for the same project id, fails clearly instead of overwriting it with a different project id, and refuses to register the same project id to a different root.

After init, `daemon start`, `list`, `history`, and `export` can resolve the current project from the project root or a nested subdirectory without repeating `--project-id` or `--project-root`. Explicit flags still work for advanced cases, but conflicting project identity fails clearly instead of silently serving the wrong project.

Start the daemon and obtain the canonical MCP config:

```bash
xurgo-atlas daemon start
xurgo-atlas status
xurgo-atlas mcp-config --json
```

Use your MCP client's normal tool and resource discovery after connecting. `docs.capabilities` reports the live Atlas read/search/write surface for the resolved project.

Atlas is a local-first documentation and durable project-context service. It is not an agent runtime, workspace manager, session store, general memory database, or a replacement for Git truth.

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

Templates are documentation templates, not app-code scaffolds. They create missing project docs only:

| Template | Description |
|----------|-------------|
| `default` | Generic project with standard Atlas docs and project brief |
| `saas` | SaaS product with product brief, MVP scope, and development workflow |
| `cli-tool` | CLI tool with command surface docs, packaging notes, and validation workflow |
| `mcp-server` | MCP server with tool/resource surface, daemon setup, and safety boundaries |
| `web-app` | Web application with product brief, route structure, and frontend architecture |

**Existing docs are preserved by default.** Templates create missing files only. For a cloned repo that already has project docs, usually omit `--template` — plain `init --project-id <id>` is the standard workflow. Use `--template <name>` for new/empty projects or when intentionally filling missing docs.

For advanced configuration — custom storage roots, daemon options, or legacy migration — see the reference docs linked from [docs/README.md](../README.md).

## Contributor Checkout & Validation

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd xurgo-atlas
npm install
npm run build
```

The CLI binary is `xurgo-atlas` (via `npm start` or `node dist/index.js`).

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
