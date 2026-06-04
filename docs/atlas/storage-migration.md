# Storage Migration

## Overview

Xurgo Atlas managed storage lives outside the project tree in configurable directories.

| Path | Default | Content |
|------|---------|---------|
| `<configDir>/projects.json` | `~/.config/xurgo-atlas/projects.json` | Global project registry |
| `<dataDir>/projects/<id>/repo.git` | `~/.local/share/xurgo-atlas/projects/<id>/repo.git` | Git bare repository (docs history) |
| `<dataDir>/projects/<id>/events.sqlite` | `~/.local/share/xurgo-atlas/projects/<id>/events.sqlite` | Event/proposal database |

Fresh installs default to the Xurgo Atlas XDG roots above. Legacy-only installs still fall back to the historical `docu-guard` config and data roots for compatibility. If both Atlas and legacy managed roots are already populated, Atlas roots are selected and a diagnostic is emitted.

## Inspect Current Storage

```bash
xurgo-atlas storage inspect
```

Read-only command that reports:

- The effective selected config and data roots
- Atlas vs legacy candidate state
- Registry presence and readable project counts
- Runtime PID/log artifact presence

No files are created, modified, or migrated.

## Migrate from Legacy Storage

If you have existing managed storage under legacy `docu-guard` roots (`~/.config/docu-guard/`, `~/.local/share/docu-guard/`), you can migrate to Xurgo Atlas roots.

### Step 1: Dry Run (safe to run anytime)

```bash
xurgo-atlas storage migrate --dry-run
```

Reports what would be copied, what would be skipped, any blockers or warnings, and the recommended next action. No files are created or modified.

### Step 2: Apply (copy to Atlas roots)

```bash
xurgo-atlas storage migrate --apply
```

Only proceeds when:

- Legacy roots exist and contain valid data
- Atlas target roots are empty (no existing data)
- No conflicts are detected

The migration is **copy-only**:

- Copies legacy registry and project stores into empty Atlas roots
- Rewrites the copied registry to point at Atlas paths
- Repairs internal Git metadata (bare HEAD, workdir alternates, origin remotes)
- Skips runtime artifacts (PID files, logs)
- Validates copied project stores
- Never deletes or modifies legacy roots

Legacy roots remain fully accessible if rollback is needed.

## Example Workflow

```bash
# 1. Check current state
xurgo-atlas storage inspect

# 2. Preview migration
xurgo-atlas storage migrate --dry-run

# 3. If the dry run reports "legacy-only to empty-Atlas" as safe:
xurgo-atlas storage migrate --apply

# 4. Verify the result
xurgo-atlas storage inspect
```

## Custom Directories

Override defaults with CLI flags:

```bash
xurgo-atlas daemon start --config-dir /path/to/config --data-dir /path/to/data
xurgo-atlas init --project-root /path/to/project --project-id my-project --config-dir /path/to/config --data-dir /path/to/data
```

Flags are available on `init`, `server`, `daemon`, and `project` commands.

## Legacy References

- Legacy-only installs still resolve through `~/.config/docu-guard/projects.json` until migrated.
- Pre-v0.3 project-local `.docu-guard/` folders are development artifacts and are warned about, not used as active storage.
- Both-present states emit a warning; use `--config-dir` or `--data-dir` to select explicitly if needed.
