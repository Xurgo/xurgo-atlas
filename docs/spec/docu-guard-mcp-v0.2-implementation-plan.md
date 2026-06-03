# Implementation Plan: docu-guard-mcp v0.2 — Multi-Project Daemon

## Overview

This document describes the detailed implementation plan for v0.2 of `docu-guard-mcp`. The work is organized into 6 phases, each producing a shippable increment. Phases should be implemented in order — each phase builds on the previous one.

**Estimated total effort:** ~400-600 lines of new TypeScript, ~200 lines of new tests, ~50 lines of refactored existing code.

**No npm dependencies added.** Node.js built-in `http` module is used for the HTTP server.

---

## Phase 1: Extract Shared MCP Server Registration

**Goal:** Decouple MCP server creation from stdio transport so the same tools/resources can be used with HTTP.

### Files to Create

| File | Purpose |
|------|---------|
| `src/mcp/create-server.ts` | Creates MCP `Server` instance and registers tools + resources. Does NOT connect a transport. |

### Files to Modify

| File | Change |
|------|--------|
| `src/mcp/server.ts` | Delegate server creation + registration to `create-server.ts`, keep only stdio transport connection |
| `src/mcp/tools.ts` | No changes needed (already receives `Server` and `Project`) |
| `src/mcp/resources.ts` | No changes needed (already receives `Server` and `Project`) |

### Implementation Detail: `create-server.ts`

```typescript
// src/mcp/create-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Project } from '../core/project.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export interface CreateServerOptions {
  name?: string;
  version?: string;
}

export function createMcpServer(
  projectOrProjects: Project | (() => Project | Promise<Project>),
  options: CreateServerOptions = {},
): Server {
  const server = new Server(
    {
      name: options.name || 'docu-guard-mcp',
      version: options.version || '0.2.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tools and resources with the project resolver
  // For stdio mode: projectOrProjects is a single Project instance
  // For daemon mode: projectOrProjects is a resolver function that looks up by projectId
  registerTools(server, projectOrProjects);
  registerResources(server, projectOrProjects);

  return server;
}
```

**Design decision:** Tools currently receive a single `Project` instance at registration time. For the daemon, tools need to resolve the correct `Project` per-request based on `projectId`. The cleanest approach is to make `registerTools` accept either a `Project` or a `ProjectResolver` function:

```typescript
type ProjectResolver = (projectId: string) => Promise<Project>;
```

Then each tool handler calls the resolver with the `projectId` from its arguments instead of using a pre-loaded project. This requires a small refactor of the tool handlers (Phase 5), but the registration interface can be designed now.

For Phase 1, `create-server.ts` accepts a single `Project` for stdio, and the resolver pattern is added in Phase 5.

### Updated `server.ts`

```typescript
// src/mcp/server.ts (refactored)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Project } from '../core/project.js';
import { createMcpServer } from './create-server.js';

export interface ServerOptions {
  projectRoot: string;
  projectId: string;
}

export async function startMcpServer(options: ServerOptions): Promise<void> {
  const project = await Project.load({
    projectRoot: options.projectRoot,
    projectId: options.projectId,
  });

  const server = createMcpServer(project);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
```

### Verification

- All 25 v0.1 tests pass.
- `docu-guard server` starts and responds to MCP tools.
- No behavioral changes.

---

## Phase 2: Project Registry

**Goal:** Create the `Registry` class that manages `~/.config/docu-guard/projects.json`.

### Files to Create

| File | Purpose |
|------|---------|
| `src/core/registry.ts` | Registry class: load, save, add, remove, list, show, set default, resolve |

### Registry Structure

```typescript
// src/core/registry.ts

export interface ProjectEntry {
  projectId: string;
  projectRoot: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface RegistryData {
  version: number;
  defaultProjectId: string | null;
  projects: Record<string, ProjectEntry>;
}

export class Registry {
  private data: RegistryData;
  private configDir: string;
  private configPath: string;

  constructor(configDir?: string);

  // Load from disk (or create default)
  static async load(configDir?: string): Promise<Registry>;
  // Persist to disk
  private async save(): Promise<void>;

  // CRUD
  async addProject(projectId: string, projectRoot: string): Promise<ProjectEntry>;
  async removeProject(projectId: string): Promise<boolean>;
  listProjects(): ProjectEntry[];
  getProject(projectId: string): ProjectEntry | null;
  async setDefault(projectId: string): Promise<void>;
  getDefault(): ProjectEntry | null;

  // Resolution with validation
  async resolve(projectId: string): Promise<{ projectId: string; projectRoot: string }>;
  // Resolve using default if projectId is empty
  async resolveOrFallback(projectId?: string): Promise<{ projectId: string; projectRoot: string }>;

  // File system validation
  private validateProjectRoot(projectRoot: string): Promise<boolean>;
  private validateProjectInitialized(projectRoot: string): Promise<boolean>;
}
```

### Resolution Error Handling

```typescript
// Errors returned (not thrown) as structured results
class RegistryError extends Error {
  code: 'NOT_FOUND' | 'ROOT_MISSING' | 'NOT_INITIALIZED' | 'NO_DEFAULT';
  constructor(code: string, message: string) { ... }
}
```

Each `resolve` method returns a clear, actionable error message matching the PRD specification.

### Error Messages

| Condition | Message |
|-----------|---------|
| `resolve(id)` where id not in registry | `Project '<id>' not found in registry. Use 'docu-guard project add --project-id <id> --project-root <path>' to register it.` |
| `resolve(id)` where project root doesn't exist | `Project root for '<id>' does not exist at <path>.` |
| `resolve(id)` where `.docu-guard` missing | `Project '<id>' has not been initialized. Run 'docu-guard init --project-root <path> --project-id <id>' first.` |
| `resolveOrFallback('')` with no default | `No projectId provided and no default project is set. Provide --project-id or set a default with 'docu-guard project default --project-id <id>'.` |

### Config Directory

- Default: `~/.config/docu-guard/` (respects `XDG_CONFIG_HOME` if set).
- Created automatically on first `addProject`.
- `configDir` is injectable for testing.

### Verification

- Unit tests for all CRUD operations.
- Unit tests for resolution with each error case.
- Registry persists correctly to disk.
- Registry loads correctly from disk on restart.
- Concurrent reads/writes do not corrupt the file (single-threaded Node.js, so no issue).

---

## Phase 3: Project CLI Commands

**Goal:** Add `docu-guard project add`, `remove`, `list`, `show`, `default` commands.

### Files to Create

| File | Purpose |
|------|---------|
| `src/cli/project.ts` | CLI handlers for project registry commands |

### Files to Modify

| File | Change |
|------|--------|
| `src/index.ts` | Add `project` subcommand dispatch |

### Implementation Detail: `project.ts`

```typescript
// src/cli/project.ts
import { Registry } from '../core/registry.js';

export async function projectAddCommand(projectId: string, projectRoot: string): Promise<void> {
  const registry = await Registry.load();
  const entry = await registry.addProject(projectId, projectRoot);
  console.log(`✅ Project "${projectId}" registered at ${projectRoot}`);
}

export async function projectRemoveCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  const removed = await registry.removeProject(projectId);
  if (removed) {
    console.log(`✅ Project "${projectId}" removed from registry.`);
  } else {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
}

export async function projectListCommand(): Promise<void> {
  const registry = await Registry.load();
  const projects = registry.listProjects();
  const defaultId = registry.getDefault()?.projectId;
  
  if (projects.length === 0) {
    console.log('No projects registered.');
    console.log('Use "docu-guard project add --project-id <id> --project-root <path>" to add one.');
    return;
  }

  console.log('Registered projects:');
  for (const p of projects) {
    const isDefault = p.projectId === defaultId ? ' (default)' : '';
    console.log(`  ${isDefault ? '*' : ' '} ${p.projectId} → ${p.projectRoot}${isDefault}`);
  }
}

export async function projectShowCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  const entry = registry.getProject(projectId);
  if (!entry) {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
  console.log(JSON.stringify(entry, null, 2));
}

export async function projectDefaultCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  const entry = registry.getProject(projectId);
  if (!entry) {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
  await registry.setDefault(projectId);
  console.log(`✅ Default project set to "${projectId}".`);
}
```

### CLI Dispatch Update

In `src/index.ts`, add handling for the `project` subcommand with its own sub-argument parsing:

```typescript
case 'project': {
  const subcommand = args['_subcommand'] || '';
  switch (subcommand) {
    case 'add': ...
    case 'remove': ...
    case 'list': ...
    case 'show': ...
    case 'default': ...
  }
}
```

The argument parser needs a small enhancement to handle subcommands like `docu-guard project add --project-id ...`. The `_default` arg or a new positional parser handles the subcommand token.

### Verification

- Each `docu-guard project *` command produces the expected output.
- Registry file is created/updated correctly.
- Error cases produce clear messages.
- Adding the same project again updates the root path and timestamp.

---

## Phase 4: Streamable HTTP Daemon

**Goal:** Add `docu-guard daemon` command with Streamable HTTP transport.

### Files to Create

| File | Purpose |
|------|---------|
| `src/mcp/http.ts` | Streamable HTTP transport implementation |
| `src/cli/daemon.ts` | Daemon CLI command handler |

### Files to Modify

| File | Change |
|------|--------|
| `src/index.ts` | Add `daemon` command to the command switch |

### HTTP Transport: `http.ts`

The transport uses Node.js built-in `http` module. No external HTTP framework.

```typescript
// src/mcp/http.ts
import * as http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface HttpServerOptions {
  host: string;
  port: number;
  allowedOrigins?: string[];
}

export async function startHttpServer(
  mcpServer: Server,
  options: HttpServerOptions,
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      handleCors(req, res, options.allowedOrigins);
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // MCP endpoint
    if (req.method === 'POST' && req.url === '/mcp') {
      // Validate Origin header
      // Parse JSON body
      // Call mcpServer.handleRequest() or process directly
      // Return JSON or SSE response
      return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(options.port, options.host, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}
```

**Key implementation details:**

1. **Body parsing:** Read the entire request body as UTF-8 JSON.
2. **JSON-RPC dispatch:** Pass the parsed JSON-RPC message to the MCP `Server`'s handler. The SDK provides `server.handleRequest()` or equivalent. If not directly available, parse the method and dispatch to the appropriate internal handler.
3. **Response format:** If the client accepts `text/event-stream`, return SSE. Otherwise return `application/json`.
4. **CORS:** Set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` on all responses.
5. **Origin validation:** Check `Origin` header against allowed origins list. Default: `null` and `http://127.0.0.1:*` and `http://localhost:*`.

**Integration with MCP SDK:**

The `@modelcontextprotocol/sdk` (version ^1.11.0) provides `StreamableHTTPServerTransport` in newer versions. If available, use it directly:

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const transport = new StreamableHTTPServerTransport({
  sessionId: 'auto',  // or undefined for sessionless
});
// Then connect: await server.connect(transport);
// Handle HTTP in the request handler by calling transport.handleRequest()
```

If the SDK version does not include `StreamableHTTPServerTransport`, implement the JSON-RPC over HTTP handling manually using the SDK's internal `Server.handleMessage()` or by dispatching to the registered tool/resource handlers.

### Daemon CLI: `daemon.ts`

```typescript
// src/cli/daemon.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Registry } from '../core/registry.js';
import { createMcpServer } from '../mcp/create-server.js';
import { startHttpServer } from '../mcp/http.js';

export interface DaemonOptions {
  host: string;
  port: number;
  projectId?: string;
  projectRoot?: string;
}

export async function daemonCommand(options: DaemonOptions): Promise<void> {
  // Optionally register a project on startup
  if (options.projectId && options.projectRoot) {
    const registry = await Registry.load();
    await registry.addProject(options.projectId, options.projectRoot);
    console.error(`Registered project "${options.projectId}" at ${options.projectRoot}`);
  }

  // Create the MCP server with a project resolver
  const registry = await Registry.load();
  const mcpServer = createMcpServer(async (projectId: string) => {
    const resolved = await registry.resolve(projectId);
    return Project.load({
      projectRoot: resolved.projectRoot,
      projectId: resolved.projectId,
    });
  }, { version: '0.2.0' });

  // Start HTTP server
  const httpServer = await startHttpServer(mcpServer, {
    host: options.host,
    port: options.port,
  });

  console.error(`docu-guard daemon listening on http://${options.host}:${options.port}/mcp`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.error('\nShutting down...');
    await closeHttpServer(httpServer);
    process.exit(0);
  });
}
```

### CLI Entry Point Update

Add to `src/index.ts`:

```typescript
case 'daemon': {
  await daemonCommand({
    host: args['host'] || '127.0.0.1',
    port: parseInt(args['port'] || '3737', 10),
    projectId: args['project-id'],
    projectRoot: args['project-root'] ? path.resolve(args['project-root']) : undefined,
  });
  break;
}
```

### Usage Text Update

Add daemon and project commands to the usage text in `src/index.ts`.

### Verification

- `docu-guard daemon` starts and listens on `127.0.0.1:3737`.
- `GET /health` returns `200 { "status": "ok" }`.
- `POST /mcp` with a valid MCP request returns a valid MCP response.
- `OPTIONS /mcp` returns CORS headers.
- `SIGINT` shuts down the server gracefully.
- Binding to `0.0.0.0` prints a warning.
- Binding to a port in use prints a clear error.
- Origin validation rejects invalid origins.

---

## Phase 5: Multi-Project Resolution in Tools

**Goal:** Make MCP tools resolve `projectId` through the registry when running in daemon mode.

### Files to Modify

| File | Change |
|------|--------|
| `src/mcp/tools.ts` | Accept `ProjectResolver` function instead of single `Project`; resolve per-request |
| `src/mcp/resources.ts` | Same pattern for resource handlers |
| `src/mcp/create-server.ts` | Pass resolver to tools/resources registration |

### Tool Handler Refactor

**Current pattern (v0.1):**

```typescript
export function registerTools(server: Server, project: Project): void {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case 'docs.read': {
        // Use project directly
        const result = await project.gitStore.readFile(...);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    }
  });
}
```

**New pattern (v0.2):**

```typescript
type ProjectResolver = (projectId: string) => Promise<Project>;

export function registerTools(
  server: Server,
  projectOrResolver: Project | ProjectResolver,
): void {
  const resolveProject = typeof projectOrResolver === 'function'
    ? projectOrResolver
    : async () => projectOrResolver;

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    // For tools that require projectId, resolve the project
    let project: Project;
    if (needsProjectId(name)) {
      const projectId = args?.projectId || '';
      if (!projectId) {
        // Try to resolve default or return error
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'No projectId provided...' }) }], isError: true };
      }
      project = await resolveProject(projectId);
    }
    
    switch (name) {
      case 'docs.read': {
        const result = await project.gitStore.readFile(...);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    }
  });
}
```

**Project resolution within tool handlers:**

Each tool that accepts `projectId` needs to resolve it. The resolution logic:

1. If `projectId` is provided, resolve through the resolver (which in daemon mode uses the registry).
2. If `projectId` is not provided and a default exists, use the default.
3. If `projectId` is not provided and no default exists, return a clear error.

For stdio mode, the resolver is a simple wrapper that returns the single pre-loaded `Project`, ignoring the `projectId` argument (or validating it matches).

### Resource Handler Refactor

Resources also need access to the correct project. The same resolver pattern applies:

```typescript
// Resource URI: docs://project/{projectId}/HEAD/{path}
// Parse projectId from URI, resolve project, serve content
```

### Verification

- Stdio mode: all tools work exactly as before (resolver just returns the single project).
- Daemon mode: tools resolve the correct project by ID.
- Unknown projectId returns a clear error.
- Missing projectId with default works.
- Missing projectId without default returns a clear error.

---

## Phase 6: Docs, Tests, and Dogfooding

**Goal:** Document the new features, write tests, and verify everything works end-to-end.

### Documentation Updates

| File | Change |
|------|--------|
| `README.md` | Add daemon section, project commands section, HTTP config examples, security notes |
| `docs/implementation-checklist.md` | Add v0.2 section (below) |

### README Updates

Add the following sections to `README.md`:

1. **Daemon Mode** — How to start and use the daemon.
2. **Project Registry** — How to register, list, and manage projects.
3. **HTTP Configuration** — MCP client config for Streamable HTTP.
4. **Security Notes** — Default localhost binding, warning about `0.0.0.0`.

### MCP Client Configuration Examples

**Stdio (per-project, v0.1 compatible):**
```json
{
  "mcpServers": {
    "docu-guard-mcp": {
      "command": "npx",
      "args": ["docu-guard", "server", "--project-root", "/path/to/project", "--project-id", "my-project"]
    }
  }
}
```

**HTTP (multi-project daemon):**
```json
{
  "mcpServers": {
    "docu-guard-mcp": {
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

### Test Plan (New Tests)

#### Registry Tests (`tests/registry.test.ts`)

| # | Test | Expected |
|---|------|----------|
| 1 | Create registry, add project, list contains it | 1 project in list |
| 2 | Add project, remove it, list is empty | 0 projects |
| 3 | Add project, show it returns correct entry | Match input |
| 4 | Set default, get default returns correct entry | Match input |
| 5 | Resolve valid projectId returns root | Correct root |
| 6 | Resolve unknown projectId throws RegistryError | NOT_FOUND |
| 7 | Resolve project with missing root throws RegistryError | ROOT_MISSING |
| 8 | Resolve project with missing .docu-guard throws RegistryError | NOT_INITIALIZED |
| 9 | Resolve empty string with no default throws RegistryError | NO_DEFAULT |
| 10 | Resolve empty string with default uses default | Correct default |
| 11 | Registry persists to disk and reloads | Same data after reload |

#### HTTP Server Tests (`tests/http-server.test.ts`)

| # | Test | Expected |
|---|------|----------|
| 1 | Start server, GET /health returns 200 | `{ status: "ok" }` |
| 2 | POST /mcp with tools/list returns tool list | Valid MCP response |
| 3 | POST /mcp with invalid JSON returns 400 | Error response |
| 4 | OPTIONS /mcp returns CORS headers | ACAO, ACAM, ACAH headers |
| 5 | POST /mcp with invalid Origin returns 403 | Rejected |

#### Daemon Integration Tests (`tests/daemon.test.ts`)

| # | Test | Expected |
|---|------|----------|
| 1 | Start daemon, register project, call docs.read via HTTP | Same result as stdio |
| 2 | Call docs.read with unknown projectId via HTTP | Clear error message |
| 3 | Call docs.read without projectId and with default set | Uses default project |

### Dogfooding

Once v0.2 is built, dogfood it on the docu-guard-mcp project itself:

```bash
# Register this project
docu-guard project add --project-id docu-guard-mcp --project-root /home/jason/projects/docs-mcp

# Start the daemon
docu-guard daemon

# Test via HTTP
curl -X POST http://127.0.0.1:3737/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Complete File Change Summary

### New Files

```
src/core/registry.ts          ~120 lines  (Registry class)
src/mcp/create-server.ts      ~40 lines   (Shared server factory)
src/mcp/http.ts               ~150 lines  (Streamable HTTP transport)
src/cli/daemon.ts             ~80 lines   (Daemon CLI handler)
src/cli/project.ts            ~100 lines  (Project registry CLI)
tests/registry.test.ts        ~200 lines  (Registry tests)
tests/http-server.test.ts     ~150 lines  (HTTP server tests)
tests/daemon.test.ts          ~100 lines  (Daemon integration tests)
```

### Modified Files

```
src/index.ts                  ~+30 lines  (Add daemon + project commands)
src/mcp/server.ts             ~-20 lines  (Refactor to use create-server.ts)
src/mcp/tools.ts              ~+40 lines  (Accept resolver, resolve per-request)
src/mcp/resources.ts          ~+20 lines  (Accept resolver, resolve per-request)
README.md                     ~+80 lines  (Daemon + HTTP docs)
```

### Unchanged Files

```
src/core/project.ts           Unchanged (except possible minor resolver helper)
src/core/git-store.ts         Unchanged
src/core/events.ts            Unchanged
src/core/patch.ts             Unchanged
src/core/policy.ts            Unchanged
src/core/risk.ts              Unchanged
src/cli/init.ts               Unchanged
src/utils.ts                  Unchanged
package.json                  Unchanged (no new deps)
tsconfig.json                 Unchanged
```

---

## Recommended Implementation Order

```
Phase 1  ─────────────────────────────────────────────────────────────┐
Extract create-server.ts, refactor server.ts                          │
                                                                       │
Phase 2  ─────────────────────────────────────────────────────────────┤
Add Registry class (core/registry.ts)                                  │
                                                                       │
Phase 3  ─────────────────────────────────────────────────────────────┤
Add project CLI commands (cli/project.ts, index.ts dispatch)           │
                                                                       │
Phase 4  ─────────────────────────────────────────────────────────────┤
Add Streamable HTTP transport (mcp/http.ts, cli/daemon.ts)             │
                                                                       │
Phase 5  ─────────────────────────────────────────────────────────────┤
Refactor tools.ts and resources.ts for per-request project resolution  │
                                                                       │
Phase 6  ─────────────────────────────────────────────────────────────┤
Add tests, update README, update implementation checklist, dogfood     │
```

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| MCP SDK does not expose `handleRequest()` for HTTP | Use `StreamableHTTPServerTransport` if available in SDK v1.11+. If not, implement manual JSON-RPC dispatch to registered handlers. |
| Tool refactoring breaks stdio mode | Keep the `Project` overload in `registerTools`. Stdio passes a single `Project`, daemon passes a resolver. Both paths are tested. |
| Registry file corruption on concurrent CLI calls | Single-threaded Node.js makes this unlikely. Read-before-write pattern with atomic `writeFileSync` (or `writeFile` with temp + rename) for safety. |
| Port conflicts | Clear error message. User-configurable `--port`. |
| `~/.config` does not exist on Windows/macOS | Use `process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')` — works cross-platform. |
| Origin validation blocks legitimate MCP clients | Default allow list includes `null` origin (non-browser clients) and localhost origins. Custom `--allow-origin` flag for advanced use. |

---

## Rollback Plan

Each phase of the v0.2 implementation is designed to be independently reversible. The following table describes the rollback strategy for each phase and the overall release.

| Phase | Rollback Action | Risk Level | Notes |
|-------|----------------|------------|-------|
| **Phase 1** (create-server.ts extraction) | Revert `src/mcp/server.ts` to the v0.1 implementation; delete `src/mcp/create-server.ts`. All tests pass as before. | Low | Pure refactor — no new behavior. Rollback is safe at any point. |
| **Phase 2** (Registry) | Delete `src/core/registry.ts`. The registry is only referenced by Phase 3+ code, so no existing v0.1 code depends on it. | Low | Registry is additive; nothing in v0.1 references it. |
| **Phase 3** (Project CLI) | Revert changes to `src/index.ts`; delete `src/cli/project.ts`. CLI simply won't have `project` subcommand. | Low | CLI commands are additive. No v0.1 behavior changes. |
| **Phase 4** (HTTP daemon) | Revert changes to `src/index.ts`; delete `src/mcp/http.ts` and `src/cli/daemon.ts`. Stdio mode is unaffected. | Medium | The daemon is a new entry point. Stdio continues to work even if HTTP has bugs. |
| **Phase 5** (Multi-project resolution) | Revert changes to `src/mcp/tools.ts` and `src/mcp/resources.ts`; restore the single-`Project` registration pattern. | Medium | This is the riskiest phase because it touches existing tool handlers. Each change is test-gated. |
| **Phase 6** (Tests/docs) | Revert test files and README changes. No production code impact. | Low | Pure documentation and test additions. |

### Overall Release Rollback

If v0.2 is deployed and a critical issue is discovered:

1. **Stdio users:** No action needed. The stdio code path is unchanged. Users simply continue using v0.1 commands.
2. **Daemon users:** Stop the daemon process. Remove or rename `~/.config/docu-guard/projects.json` if registry corruption is suspected. Switch back to stdio mode.
3. **Git revert:** The entire v0.2 feature set can be reverted with a single `git revert` of the v0.2 merge commit, restoring the v0.1 tag state.
4. **Rollback window:** The decision to roll back should be made within 48 hours of a v0.2 release. After that, forward fixes are preferred over rollback.

### Hotfix Strategy

For bugs that don't warrant a full rollback:

- **Registry bugs:** Fix in-place; the registry file format is forward-compatible (version field).
- **HTTP server bugs:** Fix in-place; the HTTP transport is entirely new code with no integration with existing paths.
- **Tool dispatch bugs:** Fix under test; the resolver pattern has a clear abstraction boundary (the `ProjectResolver` type).

### Rollback Testing

Each phase's test suite should be run against the **previous** phase's commit to verify that the rollback produces a working state. Specifically:

- After Phase 1: `git stash && npm test` should show 25/25 pass (pure v0.1).
- After Phase 2: `git revert HEAD~1 && npm test` should restore Phase 1 state.
- After Phase 3: Dropping the `project` CLI should leave all Phase 2 registry code intact.
- After Phase 4: Removing daemon code should leave all CLI + registry code intact.
- After Phase 5: Reverting tools.ts changes should restore Phase 4 tool behavior.

---

## Dependencies

**No new npm dependencies.** The v0.2 work uses:

- `node:http` (built-in) — HTTP server
- `node:fs` (built-in) — Registry file I/O
- `@modelcontextprotocol/sdk` (already present) — MCP server, possibly `StreamableHTTPServerTransport`

If `StreamableHTTPServerTransport` is not available in the current SDK version, the `@modelcontextprotocol/sdk` may need a minor version bump, or the transport can be implemented manually using the SDK's existing `Server.handleMessage()` or equivalent internal API.

---

## Final Validation Checklist

(Also serves as the Acceptance Criteria tracker — all items must be green before calling v0.2 complete.)

- [ ] Phase 1: `create-server.ts` extracted, stdio still works, all tests pass
- [ ] Phase 2: Registry CRUD + resolution works with tests
- [ ] Phase 3: `docu-guard project add/remove/list/show/default` all work
- [ ] Phase 4: `docu-guard daemon` starts, `/health` responds, `/mcp` handles MCP requests
- [ ] Phase 5: Tools resolve `projectId` correctly in both stdio and daemon modes
- [ ] Phase 6: All new tests pass, README updated, implementation checklist updated
- [ ] Dogfooding: docu-guard-mcp runs itself via daemon mode
- [ ] Full regression: all 25 v0.1 tests pass with zero changes
