# dsh-plugins

English | [中文](README.zh.md)

Plugin monorepo for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). Each directory matching `dsh-*` is a self-contained Cordis bundle package declaring `dsh.bundle`, `publishConfig`, and `prepublishOnly` checks.

## Plugins

| Package | Directory | Description |
|---|---|---|
| [`dsh-step-review-plugin`](./dsh-step-review-plugin) | `dsh-step-review-plugin` | Pause after each completed agent step and prompt the user with predefined evaluation options via `ctx.userQuestions` before resuming. |
| [`dsh-officebench-plugin`](./dsh-officebench-plugin) | `dsh-officebench-plugin` | Interactive OfficeBench debugging workbench, programmatic TypeScript batch office tools (PTC preset), and live rule-by-rule task evaluator for DSH Web UI. |

## Release and installation policy

- **Standard delivery (npm first):** Every plugin created in this repository must be published to npm before normal use. DeepSeek Harness profiles subscribe to and install plugins from npm by package name.
- **Local tarball installation (development & testing only):** Packing a local `.tgz` and installing it directly is intended only for local development, debugging, and smoke testing before publishing to npm.

### Installing a published plugin from npm (standard)

Install or subscribe to a published plugin into your DSH profile:

```sh
dsh plugin --profile <profile> add <package-name>
# Or pin a specific version:
dsh plugin --profile <profile> add <package-name>@<version>
```

Verify the composed configuration without launching:

```sh
dsh --profile <profile> --dump-config
```

To remove a plugin later:

```sh
dsh plugin --profile <profile> remove <package-name>
```

### Publishing a plugin to npm

Each package's `prepublishOnly` script automatically runs `typecheck`, `test`, and `build` before publishing:

```sh
pnpm --filter <package-name> pack --dry-run
pnpm --filter <package-name> publish
```

After publishing, tag the release as `<package-name>@<version>` (for example, `dsh-officebench-plugin@0.1.0`) so GitHub releases and the DSH plugin market index stay aligned with npm.

### Local tarball installation (development & testing only)

For local development and pre-release testing before publishing to npm:

```sh
pnpm --filter <package-name> run build
pnpm --filter <package-name> pack
dsh plugin --profile <profile> add ./<package-name>/<package-name>-<version>.tgz
```

## Development

Requirements: Node.js `>=24.9.0`, pnpm `11.x`.

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## License

[MIT](./LICENSE)
