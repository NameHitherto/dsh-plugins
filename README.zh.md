# dsh-plugins

[English](README.md) | 中文

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件开发仓库。仓库中每个匹配 `dsh-*` 的子目录都是一个独立的 Cordis 组合包（bundle）插件，声明了 `dsh.bundle`、`publishConfig` 与 `prepublishOnly` 发布门禁。

## 插件列表

| 包名 | 目录 | 说明 |
|---|---|---|
| [`dsh-step-review-plugin`](./dsh-step-review-plugin) | `dsh-step-review-plugin` | 在智能体每步执行完毕后自动暂停，通过 `ctx.userQuestions` 弹出预设评价选项框，按用户选择恢复执行、注入反馈或终止轮次。 |
| [`dsh-officebench-plugin`](./dsh-officebench-plugin) | `dsh-officebench-plugin` | 面向 DSH Web UI 的交互式 OfficeBench 可视化调试工作台、TypeScript 编程式批量工具调用（PTC）预设与实时逐条评测插件。 |

## 发布与安装规范

- **常规使用必须先发布至 npm，再由 DSH 通过 npm 订阅安装**：本仓库创建的插件面向正式或常规使用时，需先完成验证并发布到 npm registry，DSH Profile 通过 npm 包名订阅安装。
- **本地打包直装仅限开发测试**：只有在本地开发、联调与发版前测试阶段，才允许通过本地 `pnpm pack` 生成 `.tgz` 直接安装到测试 Profile。

### 通过 npm 订阅安装（常规方式）

插件发布到 npm 后，通过包名安装到指定 DSH Profile：

```sh
dsh plugin --profile <profile> add <package-name>
# 或指定版本：
dsh plugin --profile <profile> add <package-name>@<version>
```

安装完成后可通过 `--dump-config` 验证配置层是否生效：

```sh
dsh --profile <profile> --dump-config
```

如需卸载插件：

```sh
dsh plugin --profile <profile> remove <package-name>
```

### 发布插件到 npm

每个子包的 `prepublishOnly` 脚本会在发布前自动执行 `typecheck`、`test` 与 `build`：

```sh
pnpm --filter <package-name> pack --dry-run
pnpm --filter <package-name> publish
```

发布完成后，按 `<包名>@<版本号>` 格式打上 Git Tag（例如 `dsh-officebench-plugin@0.1.0`），确保 GitHub Release 与 DSH 插件市场索引和 npm 版本保持一致。

### 本地打包直装（仅限开发测试）

仅在本地开发、调试及发版前冒烟验证时使用：

```sh
pnpm --filter <package-name> run build
pnpm --filter <package-name> pack
dsh plugin --profile <profile> add ./<package-name>/<package-name>-<version>.tgz
```

## 本地开发

环境要求：Node.js `>=24.9.0`，pnpm `11.x`。

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## 许可证

[MIT](./LICENSE)
