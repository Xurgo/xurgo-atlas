# Setup

## Consumer Install & First Run

### Prerequisites

- Node.js >= 22
- npm

Install Xurgo Atlas globally for the normal CLI workflow:

```bash
npm install -g xurgo-atlas
```

Other supported invocation paths:

- `npx xurgo-atlas ...` for ad hoc use without a global install
- `npm install -D xurgo-atlas` for project-local automation
- this repository checkout plus a current local build when you are working on Atlas itself

Verify that the CLI is available:

```bash
xurgo-atlas --version
xurgo-atlas --help
```

Initialize Atlas in the project you want it to govern:

```bash
xurgo-atlas init --project-id my-project
```

Use `--project-root <path>` when you want to initialize a directory other than the current one.

`init` writes a local `.xurgo-atlas/project.json` marker in the project root. The marker stores the project id only, not an absolute path. Atlas preserves a matching marker, fails clearly instead of overwriting it with a different project id, and refuses to register the same project id to a different root.

If the checkout already exists and you only need a machine-local registration, use `project adopt` instead of `init`:

```bash
xurgo-atlas project adopt --project-root /path/to/existing-checkout --project-id my-project
```

`project adopt` is not initialization. It records the checkout in the local registry only.

- It does not create or hydrate the managed store.
- It does not activate Atlas-managed document governance.
- It does not create, rewrite, or delete a local marker.
- It does not change tracked project files.

Use `init` only when you intend to create the managed store and activate Atlas governance for that checkout.

After init, `daemon start`, `status`, `list`, `history`, `export`, and `mcp-config --json` can resolve the current project from the project root or a nested subdirectory without repeating `--project-id` or `--project-root`. Explicit flags still work for advanced cases, but conflicting project identity fails clearly instead of silently serving the wrong project.

Start the daemon and print JSON config for MCP clients:

```bash
xurgo-atlas daemon start
xurgo-atlas status
xurgo-atlas mcp-config --json
```

Use your MCP client's normal tool and resource discovery after connecting. `tools/list` on the connected server is the source of truth for the available tools, while `docs.capabilities` gives a compact summary of Atlas read/search/write posture.

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

Existing docs are preserved. For a cloned repo that already has project docs, usually omit `--template` and run plain `init --project-id <id>`. Use `--template <name>` for new or empty projects, or when intentionally filling missing docs.

Next references:

- [Daemon, CLI & MCP Reference](./daemon-mcp.md) for endpoint details, client setup, live tool discovery, and guarded document workflows
- [Root / Worktree Safety Model](./root-worktree-safety.md) for project identity and write/export safety
- [Storage Migration](./storage-migration.md) for custom storage roots and legacy storage migration
- [Documentation Overview](../README.md) for the rest of the docs map

## Contributor Checkout & Validation

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd xurgo-atlas
npm install
npm run build
```

The CLI binary is `xurgo-atlas` in the published package. From this repository checkout, use `npm start` or `node dist/index.js` after building.

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

- `npm run validate:*` - repo-level validation gates (tests + build)
- `npm run verify:*` - installed-package runtime smoke checks
- `npm run bundle:*` - local private RC artifact bundle generation

See [Development Workflow](./development-workflow.md) for the complete reference on validation tiers, smoke testing, artifact generation, and script naming conventions.

## NPM Pack (Dry Run)

To verify the published package contents without publishing:

```bash
npm_config_cache=/tmp/xurgo-atlas-npm-cache npm pack --dry-run
```

The published package is limited to `dist/`, `README.md`, and `package.json` (defined in `package.json` `files`).
