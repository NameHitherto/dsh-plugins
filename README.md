# dsh-plugins

English | [中文](README.zh.md)

Plugin monorepo for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). Each directory matching `dsh-*` is a self-contained Cordis bundle package declaring `dsh.bundle` and a `prepare` script so it can be installed directly from GitHub, packed as a tarball, published to npm, or indexed by the DSH plugin market generator.

## Plugins

| Package | Directory | Description |
|---|---|---|
| [`dsh-step-review-plugin`](./dsh-step-review-plugin) | `dsh-step-review-plugin` | Pause after each completed agent step and prompt the user with predefined evaluation options via `ctx.userQuestions` before resuming. |

## Installing a plugin into DeepSeek Harness

### From GitHub (recommended)

Install a plugin into your profile (pinning a release tag or commit SHA is recommended):

```sh
dsh plugin --profile <profile> add "git+https://github.com/NameHitherto/dsh-plugins.git#dsh-step-review-plugin@0.1.0&path:/dsh-step-review-plugin"
```

Because Git-hosted plugins ship TypeScript source and build via their `prepare` script on install, pnpm ≥10 blocks the build script on the first run and prints the exact package key to allow. Copy that key under `allowBuilds` in `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` and re-run the `add` command:

```yaml
allowBuilds:
  dsh-step-review-plugin@https://codeload.github.com/NameHitherto/dsh-plugins/tar.gz/<commit-sha>#path:/dsh-step-review-plugin: true
```

Verify the composed configuration without launching:

```sh
dsh --profile <profile> --dump-config
```

To remove the plugin later:

```sh
dsh plugin --profile <profile> remove dsh-step-review-plugin
```

### From a prebuilt tarball

```sh
pnpm --filter dsh-step-review-plugin run build
pnpm --filter dsh-step-review-plugin pack
dsh plugin --profile <profile> add ./dsh-step-review-plugin/dsh-step-review-plugin-0.1.0.tgz
```

## Development

Requirements: Node.js `>=24.9.0`, pnpm `11.x`.

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## Release tagging convention

To remain compatible with the DSH plugin market index generator, tag package releases as `<package-name>@<version>` (for example, `dsh-step-review-plugin@0.1.0`).

## License

[MIT](./LICENSE)
