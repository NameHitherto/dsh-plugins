# dsh-plugins

[English](README.md) | 中文

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件开发仓库。仓库中每个匹配 `dsh-*` 的子目录都是一个独立的 Cordis 组合包（bundle）插件，声明了 `dsh.bundle` 与独立的 `prepare` 构建脚本，支持直接从 GitHub 安装、打包为 `.tgz` 安装、发布到 npm，或接入 DSH 插件市场索引生成器。

## 插件列表

| 包名 | 目录 | 说明 |
|---|---|---|
| [`dsh-step-review-plugin`](./dsh-step-review-plugin) | `dsh-step-review-plugin` | 在智能体每步执行完毕后自动暂停，通过 `ctx.userQuestions` 弹出预设评价选项框，按用户选择恢复执行、注入反馈或终止轮次。 |

## 安装到 DeepSeek Harness

### 通过 GitHub 仓库安装（推荐）

通过 `dsh plugin` 安装指定插件（建议固定到版本 Tag 或 Commit SHA）：

```sh
dsh plugin --profile <profile> add "git+https://github.com/NameHitherto/dsh-plugins.git#dsh-step-review-plugin@0.1.0&path:/dsh-step-review-plugin"
```

由于从 Git 仓库安装的插件只分发源码并在安装时执行 `prepare` 脚本构建产物，pnpm ≥10 会在首次安装时拦截构建脚本并输出需要放行的精确包键。将该键复制到 `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 下后重新执行安装命令即可：

```yaml
allowBuilds:
  dsh-step-review-plugin@https://codeload.github.com/NameHitherto/dsh-plugins/tar.gz/<commit-sha>#path:/dsh-step-review-plugin: true
```

安装完成后可通过 `--dump-config` 验证配置层是否生效：

```sh
dsh --profile <profile> --dump-config
```

如需卸载插件：

```sh
dsh plugin --profile <profile> remove dsh-step-review-plugin
```

### 通过预构建 tarball 安装

```sh
pnpm --filter dsh-step-review-plugin run build
pnpm --filter dsh-step-review-plugin pack
dsh plugin --profile <profile> add ./dsh-step-review-plugin/dsh-step-review-plugin-0.1.0.tgz
```

## 本地开发

环境要求：Node.js `>=24.9.0`，pnpm `11.x`。

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## 发布标签规范

为兼容 DSH 官方插件市场索引生成器（`dsh-plugin-market-generator`），单插件发版标签统一采用 `<包名>@<版本号>` 格式（例如 `dsh-step-review-plugin@0.1.0`）。

## 许可证

[MIT](./LICENSE)
