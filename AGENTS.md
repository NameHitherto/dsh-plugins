# AGENTS.md

Repository rules for `dsh-plugins` — the plugin monorepo for DeepSeek Harness (DSH).

## Release and installation policy

1. **Publish to npm first for normal use.** Every plugin package created in this repository (`dsh-*`) must be built, verified, and published to npm before normal installation. DeepSeek Harness profiles subscribe to and install plugins from npm by package name (e.g., `dsh plugin --profile <profile> add <package-name>` or `<package-name>@<version>`).
2. **Local tarball installation is for development and testing only.** Packing a local `.tgz` (`pnpm --filter <pkg> run build && pnpm --filter <pkg> pack`) and installing it directly (`dsh plugin --profile <profile> add ./<pkg>/<pkg>-<version>.tgz`) is permitted only during local development, integration debugging, and smoke testing. Never treat local tarball or local path installs as the normal delivery method, and never commit `.tgz` files.
3. **Never silently bind unpublished local artifacts into a user's regular DSH profile.** Only install a local `.tgz` into a user profile when explicitly asked to test locally; for normal rollout, guide or perform the npm publish first and then subscribe via npm.
4. **Keep release tags aligned with npm versions.** After publishing `<package-name>` at `<version>`, tag the commit as `<package-name>@<version>` so GitHub releases and the DSH plugin market index stay consistent with npm.

## Package publication requirements

Every publishable `dsh-*` package in this workspace must:

- Declare `"publishConfig": { "access": "public" }`, accurate `"files"`, `"exports"`, `"engines"` (`dsh` and `node`), `"dsh.bundle"`, `"locale/*.json"`, `README.md`, and `README.zh.md`.
- Define `"prepublishOnly": "pnpm run typecheck && pnpm run test && pnpm run build"` so no package can publish without passing checks and emitting both runtime bundles and `.d.ts` declarations.
- Document npm installation (`dsh plugin --profile <profile> add <package-name>`) as the primary installation method, and clearly mark local tarball installation as development/testing only.

## Pre-publish checklist

Run from repository root (`~/research/dsh-plugins`) before publishing any package:

```sh
pnpm run typecheck
pnpm run test
pnpm run build
pnpm --filter <pkg> pack --dry-run
pnpm --filter <pkg> publish --no-git-checks   # or standard `pnpm --filter <pkg> publish` on a clean branch
```

Verify the `pack --dry-run` file list includes all runtime entries, chunks, type declarations (`lib/types/**`), `cordis.patch.yml`, and `locale/*.json`, and contains no stray artifacts.

## Repository layout and commands

- Workspace packages match `dsh-*` (see `pnpm-workspace.yaml`).
- Node.js `>=24.9.0`, pnpm `11.x`, ESM everywhere (`"type": "module"`), strict TypeScript.
- Commands: `pnpm install`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`, `pnpm run clean`.
- All text files end with a single trailing newline.
