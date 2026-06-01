# docu-guard-mcp v0.3 Storage Model Proposal

## Current Behavior

As of v0.2, `docu-guard init` creates the following inside every target project:

| Path | Purpose | Type |
|------|---------|------|
| `./.docu-guard/repo.git` | Bare Git repository — full docs history | Managed state |
| `./.docu-guard/events.sqlite` | SQLite database — events, proposals | Managed state |
| `./.docs-policy.yml` | Documentation policy (protected paths, risk rules) | Project file |
| `./docs/` | Documentation directory with initial templates | Project file |
| `./AGENTS.md` | Agent safety rules for docu-guard-mcp | Project file |

The **project registry** lives globally at `~/.config/docu-guard/projects.json` (or `$XDG_CONFIG_HOME/docu-guard/projects.json`).

The registry maps `projectId → projectRoot` only. It stores no information about whether the managed state (Git repo + SQLite DB) is project-local or global.

### Key observations from source code

- `src/core/project.ts` line 74: `this.docsMcpDir = path.join(this.root, '.docu-guard')`
- `src/core/project.ts` line 74-75: `gitStore` at `.docu-guard/repo.git`, `eventLog` at `.docu-guard/events.sqlite`
- `src/core/registry.ts` lines 38-44: Registry at `~/.config/docu-guard/projects.json`
- `src/core/registry.ts` line 264: Validation checks `projectRoot/.docu-guard` existence
- `.gitignore` contains `.docu-guard/` — it is not committed

---

## Problem

The current project-local `.docu-guard/` store model has several limitations that become more acute as docu-guard-mCP evolves toward v0.3 (web UI) and beyond:

1. **Repo bloat.** A bare Git repo inside every project adds ~400 KB+ of binary data. The SQLite DB grows with every proposal and event. These are implementation details that pollute the project directory.

2. **Daemon-mode redundancy.** In daemon mode (v0.2), the daemon already manages multiple projects via a global registry. Having each project carry its own `.docu-guard/` means the daemon must read/write to potentially many scattered directories. A centralized store is more natural for a daemon.

3. **Backup complexity.** Users must remember to include `.docu-guard/` in backups. The `.gitignore` excludes it, so `git push` does not back up history.

4. **No history portability across machines.** Cloning a repo from GitHub does not bring docu-guard history with it, because `.docu-guard/` is gitignored.

5. **Monorepo and submodule friction.** In workspaces with multiple packages or git submodules, each sub-project having its own `.docu-guard/` creates unnecessary duplication and management overhead.

6. **Web UI architecture.** A future web UI would ideally read managed state from a centralized location, not from scattered project directories. A global store simplifies the web UI's data access layer.

7. **Multi-agent conflict potential.** Multiple agents working on the same project via the daemon share the same `.docu-guard/` Git bare repo on disk. While Git handles this well, SQLite contention could become an issue with concurrent writes (though Node.js single-threaded model mitigates this).

---

## Goals

1. Keep project-facing documentation files (`docs/`, `AGENTS.md`, `.docs-policy.yml`) in the project where users expect them.
2. Move managed tool state (Git bare repo, SQLite DB) to user-global storage by default.
3. Continue to support project-local `.docu-guard/` as an opt-in for portability and CI/CD scenarios.
4. Maintain full backward compatibility for existing v0.2 users who have `.docu-guard/` directories.
5. Enable a cleaner multi-project daemon architecture where the daemon manages all state from a single global directory tree.
6. Lay the foundation for the v0.3 web UI by centralizing where managed state lives.

## Non-Goals

1. No storage migration implementation in this document — this is a planning pass only.
2. No web UI implementation.
3. No changes to the v0.2 daemon behavior unless documentation-only corrections are needed.
4. No merging/tagging/publishing of v0.2 until migration is implemented.
5. No changes to the MCP tool interface — all tools continue to accept the same parameters.

---

## Options Considered

### Option A: Project-local store only (current v0.2 behavior)

```
/project/.docu-guard/repo.git
/project/.docu-guard/events.sqlite
/project/.docs-policy.yml
/project/docs/
/project/AGENTS.md
```

**Pros:**
- Everything self-contained in the project.
- Git clone gives you everything (except history, since .docu-guard/ is gitignored).
- Simple mental model — one project, one store.
- No changes needed — current behavior.

**Cons:**
- Bloats the project with binary/transient data.
- Daemon mode reads from many scattered directories.
- History not portable across clones (gitignored).
- Web UI would need to discover stores by scanning projects.
- SQLite DB inside project is unusual and may confuse users.

### Option B: Global user store only

```
~/.local/share/docu-guard/projects/<projectId>/repo.git
~/.local/share/docu-guard/projects/<projectId>/events.sqlite
```

With project files remaining:
```
/project/docs/
/project/AGENTS.md
/project/.docs-policy.yml
```

**Pros:**
- Clean project root — no `.docu-guard/` clutter.
- Centralized management for daemon mode.
- Web UI reads from one location.
- History preserved even if project is deleted (still in global store).
- Better for daemon — all state in one directory tree.

**Cons:**
- No portability — cloning a repo does not bring history.
- New contributors must run `docu-guard init` to create global store.
- Breaking change for all existing users.
- Project and its managed state can get out of sync.
- No way to carry history in a CI/CD artifact without extra steps.

### Option C: Hybrid model (recommended)

```
# Default: global managed state
~/.local/share/docu-guard/projects/<projectId>/repo.git
~/.local/share/docu-guard/projects/<projectId>/events.sqlite

# Project files (always project-local)
/project/docs/
/project/AGENTS.md
/project/.docs-policy.yml

# Optional: project-local managed state (for portability)
/project/.docu-guard/repo.git
/project/.docu-guard/events.sqlite

# Registry (global, as today)
~/.config/docu-guard/projects.json
```

**Pros:**
- Best of both worlds — clean default with opt-in portability.
- Backward compatible — existing `.docu-guard/` continues to work.
- Daemon defaults to global store for cleaner management.
- Web UI reads from global store by default.
- Migration path: one-time copy from `.docu-guard/` to global store.
- Project-local mode for CI/CD, air-gapped environments, portable USB drives.

**Cons:**
- Two code paths to maintain (global and project-local store).
- More complex configuration (store type selection).
- Migration tool needed for existing users.
- Slightly more complex CLI.

---

## Recommended Model

**Option C — Hybrid model** is recommended. Specifically:

### Default behavior (v0.3+)

`docu-guard init` (without flags) creates:

| Location | Content | Committed? |
|----------|---------|------------|
| `/project/docs/` | Documentation directory | ✅ Yes |
| `/project/AGENTS.md` | Agent safety rules | ✅ Yes |
| `/project/.docs-policy.yml` | Policy configuration | ✅ Yes |
| `~/.local/share/docu-guard/projects/<projectId>/repo.git` | Git bare repo (history) | ❌ No (global) |
| `~/.local/share/docu-guard/projects/<projectId>/events.sqlite` | Event/proposal database | ❌ No (global) |

### Project-local mode (opt-in)

`docu-guard init --store project` creates the v0.2-compatible layout:

| Location | Content |
|----------|---------|
| `/project/.docu-guard/repo.git` | Git bare repo |
| `/project/.docu-guard/events.sqlite` | Event/proposal database |
| `/project/docs/` | Documentation directory |
| `/project/AGENTS.md` | Agent safety rules |
| `/project/.docs-policy.yml` | Policy configuration |

This preserves full v0.2 compatibility and enables portability.

### Global mode (explicit)

`docu-guard init --store global` creates the same layout as the default (same as no flag), matching the recommended default. This flag exists for explicitness and scripting.

---

## What Stays in the Project

These files remain in the project directory and should be committed to version control:

| File | Purpose | Why in project |
|------|---------|----------------|
| `docs/` | Documentation content | Users expect docs alongside code |
| `AGENTS.md` | Agent safety rules | Agents read this at workspace root |
| `.docs-policy.yml` | Policy configuration | Defines per-project policy rules |

These are the files that the MCP tools protect and manage. They are the user-facing artifacts of docu-guard-mcp.

---

## What Moves to User-Global Storage

These files move from project-local `.docu-guard/` to `~/.local/share/docu-guard/projects/<projectId>/`:

| Current Location | New Location | Content |
|-----------------|--------------|---------|
| `.docu-guard/repo.git` | `~/.local/share/docu-guard/projects/<projectId>/repo.git` | Git bare repository |
| `.docu-guard/events.sqlite` | `~/.local/share/docu-guard/projects/<projectId>/events.sqlite` | Event/proposal database |

**Rationale for `~/.local/share/` vs `~/.config/`:**

- `~/.config/` (XDG_CONFIG_HOME) is for configuration files — small, editable, user-facing.
- `~/.local/share/` (XDG_DATA_HOME) is for application state — potentially large, machine-generated, not user-editable.
- Git bare repos and SQLite databases are data, not configuration.
- The registry (`projects.json`) stays in `~/.config/` because it is configuration.

---

## CLI Changes

### New flags

```
docu-guard init [--store <global|project>]
```

- `--store global` (default): Global managed state in `~/.local/share/docu-guard/`.
- `--store project`: Project-local managed state in `.docu-guard/` (v0.2 compatible).

### `docu-guard server` (stdio mode)

```bash
# Global store (default in v0.3):
docu-guard server --project-id my-app --project-root /path/to/project

# Project-local store (v0.2 compatible):
docu-guard server --project-root . --store project
```

Or detect automatically: if `.docu-guard/` exists, use project-local; otherwise use global.

### `docu-guard daemon`

No CLI changes needed for the daemon itself. The daemon already resolves projects via the registry. The store type is read from the registry entry.

### Registry schema changes

The registry `projects.json` schema needs a new field:

```json
{
  "version": 2,
  "defaultProjectId": "my-app",
  "projects": {
    "my-app": {
      "projectId": "my-app",
      "projectRoot": "/home/jason/projects/my-app",
      "storeType": "global",          // NEW: "global" | "project"
      "storePath": "~/.local/share/docu-guard/projects/my-app",  // NEW: only for global
      "createdAt": "2026-05-30T10:00:00.000Z",
      "updatedAt": "2026-05-30T10:00:00.000Z"
    },
    "my-legacy-app": {
      "projectId": "my-legacy-app",
      "projectRoot": "/home/jason/projects/my-legacy-app",
      "storeType": "project",          // NEW
      "createdAt": "2026-05-30T11:00:00.000Z",
      "updatedAt": "2026-05-30T11:00:00.000Z"
    }
  }
}
```

The `storePath` for `storeType: "global"` is deterministic from the project ID:
`{xdgDataHome}/docu-guard/projects/{projectId}/`

### Registry validation changes

- `resolve()` for `storeType: "global"` validates the global store exists rather than `.docu-guard/`.
- `resolve()` for `storeType: "project"` validates `.docu-guard/` exists (current behavior).

---

## Migration Plan

### What needs to migrate

Existing projects with `.docu-guard/` need:

1. `.docu-guard/repo.git` → `~/.local/share/docu-guard/projects/<projectId>/repo.git`
2. `.docu-guard/events.sqlite` → `~/.local/share/docu-guard/projects/<projectId>/events.sqlite`
3. Registry entry updated with `storeType: "global"` (or keep `storeType: "project"`)

### Migration command

```
docu-guard migrate --project-id <id> [--to global|project]
```

This would:
1. Detect the current store type.
2. Copy files to the new location.
3. Update the registry entry.
4. Optionally remove the old `.docu-guard/` directory (`--cleanup`).

### Non-migration path

Users who prefer project-local storage can continue using `--store project` indefinitely. No migration required. The old `docu-guard init` (without `--store`) in v0.2 produced project-local stores; these will continue to work in v0.3.

---

## Impact on Existing v0.2 Behavior

| Area | Impact |
|------|--------|
| Stdio mode | Minimal — `docu-guard server` detects store type from registry or `.docu-guard/` presence |
| Daemon mode | Minimal — daemon reads store type from registry, uses correct path |
| Project registry | Schema version bump (v1 → v2), backward compatible |
| CLI commands | New `--store` flag for `init`; new `migrate` command |
| MCP tools | No interface changes — tools continue to accept `projectId`, `path`, `branch` etc. |
| `.gitignore` | No change — `.docu-guard/` remains in `.gitignore` for project-local mode |
| Existing `.docu-guard/` | Continues to work — detected as `storeType: "project"` |

---

## Impact on Future Web UI

A centralized global store (`~/.local/share/docu-guard/projects/`) simplifies the web UI architecture:

- **Single data source:** Web UI reads from `~/.local/share/docu-guard/projects/`.
- **Project discovery:** List directories in the global store path.
- **History browsing:** Read Git repos from global store.
- **Event log queries:** Read SQLite DBs from global store.
- **No need to scan user filesystem:** The registry + global store provide everything.

For project-local stores, the web UI would need to either:
- Read `.docu-guard/` from the project root (requires filesystem access).
- Or require the project to be registered so the daemon can proxy data.

The recommendation is for the web UI to primarily use the global store and optionally support project-local stores via the daemon.

---

## Security and Privacy Considerations

1. **Global store location.** `~/.local/share/docu-guard/` follows XDG Base Directory specification. It inherits the home directory's permissions (typically `750` or `700`).

2. **Cross-project isolation.** Each project's store is in a separate subdirectory. No project can access another project's store through the file system (standard UNIX permissions apply).

3. **Sensitive content.** Documentation files may contain sensitive information. The global store inherits the home directory's security model. If the project's docs are sensitive, the project-local store option provides equivalent security (also in the user's home/project directory).

4. **Daemon access control.** The daemon already binds to localhost only. The global store location does not change the daemon's security model.

5. **Backup considerations.** Users should include `~/.local/share/docu-guard/` in their backup strategy if they want to preserve documentation history.

---

## Test Plan

### New tests needed

| Test Area | Tests | Description |
|-----------|-------|-------------|
| Store type detection | 4-5 | Detect global vs project-local store; auto-detect from `.docu-guard/` presence |
| Global init | 3-4 | `init --store global` creates correct structure in global path |
| Project-local init | 2-3 | `init --store project` creates v0.2-compatible `.docu-guard/` structure |
| Registry schema v2 | 4-5 | Version bump, storeType field, backward-compatible load of v1 registry |
| Migrate command | 4-5 | Copy from project-local to global; update registry; rollback on failure |
| Global store validation | 2-3 | `Registry.resolve()` checks global store path for `storeType: "global"` |
| Mixed-mode daemon | 3-4 | Daemon serves both global and project-local projects simultaneously |

### Existing tests

All 25 v0.1 tests + 30 v0.2 tests must continue to pass. Project-local mode (`--store project`) should behave identically to current v0.2 behavior.

---

## Recommendation

**Adopt the hybrid model (Option C).**

Make global managed state the default (`docu-guard init` without flags), with project-local mode available via `docu-guard init --store project` for portability and backward compatibility.

### Rationale

1. **The registry is already global.** `~/.config/docu-guard/projects.json` was designed as a global resource in v0.2. Extending this pattern to managed state is a natural evolution.

2. **Daemon mode is the future.** v0.2 introduced the daemon for multi-project management. A global store aligns with this architecture. The daemon should manage state centrally, not scatter it across projects.

3. **Web UI needs a single source of truth.** v0.3's web UI will be simpler to build if all managed state is in one place.

4. **Backward compatibility is preserved.** The `--store project` flag maintains full v0.2 behavior. Existing `.docu-guard/` directories continue to work. Migration is optional.

5. **Portability is not sacrificed.** Users who need portable docu-guard history (e.g., CI/CD, USB drives, air-gapped environments) can use `--store project`.

### Implementation order

1. Add `storeType` and `storePath` to registry schema (v2).
2. Implement global store path resolution in `Project` class.
3. Add `--store` flag to `docu-guard init`.
4. Update `Registry.resolve()` to validate correct store type.
5. Add `docu-guard migrate` command.
6. Update documentation.
7. Update tests.
8. Dogfood.

### What this means for `.docu-guard/`

- `.docu-guard/` is no longer the default — but it remains fully supported.
- Users who already have `.docu-guard/` can keep it (storeType: "project").
- Users who start fresh in v0.3+ get global storage by default.
- The `.docu-guard/` directory name remains for project-local mode.

---

## Summary of Key Decisions

| Decision | Choice |
|----------|--------|
| Default store location | Global (`~/.local/share/docu-guard/projects/<id>/`) |
| Project-local support | Yes, via `--store project` flag |
| Registry schema version | v2 with `storeType` and `storePath` fields |
| Project files location | Unchanged — `docs/`, `AGENTS.md`, `.docs-policy.yml` |
| `.docu-guard/` meaning | Project-local managed state (opt-in) |
| Migration | Optional `docu-guard migrate` command |
| Backward compatibility | Full — existing `.docu-guard/` continues to work |
