# Project Resolution Hardening

## Purpose

This document tracks release hardening and follow-up edge cases for Xurgo Atlas project resolution discovered during the `0.1.0` RC process. It applies to the Xurgo Atlas source repository itself and is not a template for downstream projects.

## Current Invariants

- one project id maps to one registered root.
- one marked root maps to one project id.
- `.xurgo-atlas/project.json` stores `schemaVersion` and `projectId`, not an absolute root.
- `init` is idempotent only when identity matches.
- conflicting `init` fails clearly.
- duplicate project id in another root fails clearly.
- explicit project id and project root conflicts fail clearly.
- daemon startup prints the resolved project id, project root, and resolution source.
- `daemon start` does not silently use a registry default from a non-project directory.
- for `0.1.0`, a running daemon is single-project-bound.
- same-project already-running daemon start exits successfully and identifies the bound project when available.
- cross-project already-running daemon start fails clearly and tells the user to stop the current daemon first.
- MCP requests without a project id may use the bound daemon project.
- MCP requests for a different project id fail clearly instead of silently serving another project.

## Already Addressed in `fix/project-auto-resolution`

- [x] marker creation.
- [x] marker preservation.
- [x] conflicting marker rejection.
- [x] duplicate project id rejection.
- [x] cwd and ancestor marker resolution.
- [x] explicit daemon id mismatch rejection.
- [x] conflicting `--project-id` and `--project-root` rejection.
- [x] simplified daemon happy path after `init`.

## Addressed in `fix/daemon-bound-project-safety`

- [x] same-project already-running daemon exits successfully and identifies the bound project.
- [x] cross-project `daemon start` fails non-zero when an existing daemon is bound to another project.
- [x] explicit `--project-id` for another project fails non-zero while an existing daemon is bound to a different project.
- [x] daemon status identifies the bound project id/root when available.
- [x] bound MCP requests for the daemon project continue to work.
- [x] MCP requests without a project id use the bound daemon project.
- [x] MCP requests for a different project id fail clearly.
- [x] non-project daemon start wording says no Xurgo Atlas project could be resolved from the current directory.
- [x] non-project daemon start still avoids registry-default fallback.

## P0 Before Public `0.1.0`

- [x] Verify already-running daemon behavior when project A is running and the user starts from project B.
- [x] Decide single-project-bound daemon vs. registry-wide daemon semantics for `0.1.0`.
- [x] Verify whether a project-bound daemon can serve a different project through MCP tools.
- [ ] Verify malformed marker JSON errors are clean.
- [ ] Verify unsupported marker schema errors are clean.
- [ ] Verify missing `projectId` marker errors are clean.
- [ ] Verify marker and registry mismatch errors are clean.
- [ ] Verify moved-project and stale-registry behavior fails clearly enough for `0.1.0`.
- [ ] Confirm expected user errors do not print unhandled stack traces.
- [ ] Confirm docs and the private reviewer workflow match the new auto-resolution happy path.

## P1 Soon After `0.1.0`

- [ ] Define recovery for a project moved on disk or a stale registry entry.
- [ ] Add an explicit repair or re-register command.
- [ ] Define and verify `project remove` and unregister behavior.
- [ ] Handle marker exists but registry entry is missing.
- [ ] Handle registry entry exists but marker is missing.
- [ ] Document and test nested project behavior if it is not fully covered before release.
- [ ] Improve troubleshooting for missing roots, missing managed stores, or not-initialized projects.

## P2 Later

- [ ] Evaluate an optional multi-project daemon mode.
- [ ] Define a team and shared project identity policy.
- [ ] Decide whether `.xurgo-atlas/project.json` should normally be committed or remain local-only.
- [ ] Add fish-safe and POSIX-safe reviewer command examples.
- [ ] Consider broader parent-project agent docs such as `docs/AI/*`, if they are useful later outside this repo.

## Next Private RC Checklist

- [ ] Source repo is clean.
- [ ] `main == origin/main`.
- [ ] `v0.1.0-rc.2` is left untouched.
- [ ] Full validation passes.
- [ ] Private RC bundle is created from a clean tree.
- [ ] Bundle smoke passes.
- [ ] Dummy consumer install succeeds.
- [ ] Marker creation works.
- [ ] Re-init with the same id succeeds.
- [ ] Re-init with a different id fails clearly.
- [ ] Duplicate project id in another root fails clearly.
- [ ] `daemon start` works from the project root without repeated flags.
- [ ] `daemon start` from a non-project directory fails clearly.
- [ ] Same-project already-running `daemon start` exits successfully.
- [ ] Cross-project already-running `daemon start` fails clearly.
- [ ] Explicit different-project `daemon start --project-id <id>` fails clearly while another daemon is bound.
- [ ] MCP reads for the bound project pass.
- [ ] MCP reads for another project fail clearly.
- [ ] No npm publish is run.
- [ ] No GitHub release is created.
- [ ] No public release automation is run.
- [ ] No public tag is created.
