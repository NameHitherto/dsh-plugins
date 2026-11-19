# dsh-officebench-plugin

[English](README.md) | 中文

面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web UI 的交互式 [OfficeBench](https://github.com/zlwang-cs/OfficeBench) 可视化调试工作台、TypeScript 编程式批量工具调用（PTC）预设与实时逐条评测插件。

专为与 [`dsh-step-review-plugin`](../dsh-step-review-plugin) 叠加使用而设计：在智能体每次执行完一步（例如一次批量 `run_code` 调用）暂停审阅时，你可以直接在右侧检查器中查看文件变更、预览生成的 Excel/Word/PDF、实时跑通评测规则，再选择继续、注入反馈微调或终止轮次。

## 核心能力

- **左侧栏 OfficeBench 工作台**：支持在界面内配置并持久化本地 OfficeBench 数据集路径（或通过 `OFFICEBENCH_DIR` 环境变量指定），浏览与筛选全部 300 个子任务（按应用数 `1` / `2` / `3`、应用标签 `excel` / `word` / `pdf` / `ocr` / `email` / `calendar` / `shell` 或关键词搜索），支持「盲测模式」隐藏评测真值，一键创建完全隔离的运行目录并启动任务。
- **独立 `OfficeBench (PTC)` 智能体预设（`officebench`）**：基于 `@deepseek-ai/dsh-tool-executor-ptc`（`run_code`），让模型直接编写 TypeScript 代码通过循环或 `Promise.all(...)` 批量调用全部 24 个 OfficeBench 办公工具；所有只读工具开启并发安全，所有文件路径严格限制在当前运行的 `testbed/` 目录内。
- **纯 Node 跨平台办公引擎 + 可选本地原生加速**：内置 `exceljs`、`jszip`（OOXML Word）、`unpdf`、`pdf-lib`、`postal-mime`、RFC 5545 `.ics` 日历引擎与 `tesseract.js`，在 Windows / macOS / Linux 下无需 Docker 即可开箱运行；本机安装 LibreOffice、Tesseract CLI 或 Python PyMuPDF 时自动优先调用以提升转换与渲染质量。
- **右侧栏实时 Testbed 检查器**：展示相对初始快照的文件 diff（新增 / 修改 / 删除），点击任意文件直接用 DSH 原生 Document Preview 预览（支持 `.xlsx`、`.docx`、`.pdf`、图片与文本）；集中查看 `answer.txt`、所有账号邮件与日历日程；随时点击「立即评测」逐条查看 9 类 OfficeBench 规则的 PASS/FAIL 明细，并支持一键重置 `testbed/` 回到干净初始状态。
- **与 `dsh-step-review-plugin` 无缝叠加**：在同一 Web Profile 中同时启用两个插件后，每完成一步 `run_code` 批量调用都会通过 `ctx.userQuestions` 弹出单步审阅卡片，你可以在暂停期间实时检查文件与评测结果，再决定放行或给出纠偏指令。

## 安装

### 通过 npm 订阅安装（常规方式）

插件发布至 npm 后，在目标 Profile 中按包名订阅安装：

```sh
dsh plugin --profile <profile> add dsh-officebench-plugin
```

### 与 `dsh-step-review-plugin` 组合安装

在同一个 Web Profile（例如 `web` 或 `research-web`）中通过 npm 同时订阅安装两个插件：

```sh
dsh plugin --profile research-web add dsh-step-review-plugin
dsh plugin --profile research-web add dsh-officebench-plugin
dsh --profile research-web --dump-config
```

随后启动 DSH Web UI：

```sh
# Windows PowerShell
$env:OFFICEBENCH_DIR = "D:\Research\EEG\experiments\OfficeBench"
dsh --profile research-web

# macOS / Linux
OFFICEBENCH_DIR=/path/to/OfficeBench dsh --profile research-web
```

也可以不设环境变量，启动后直接在 Web UI 左侧 **OfficeBench** 页面填入本地数据集路径并保存。

### 本地打包直装（仅限开发测试）

仅在本地开发、联调或发版前冒烟验证时使用：

```sh
pnpm --filter dsh-officebench-plugin run build
pnpm --filter dsh-officebench-plugin pack
dsh plugin --profile <profile> add ./dsh-officebench-plugin/dsh-officebench-plugin-0.1.0.tgz
```

## 交互式调试流程

1. 打开左侧栏 **OfficeBench** 面板，确认本地数据集路径已加载（完整仓库显示 300 个任务）。
2. 按应用数量（`1` / `2` / `3`）、应用标签或关键词筛选任务，查看任务描述、虚拟时间/用户名与初始文件。
3. 点击 **启动并运行（PTC）**（或点击 **打开草稿（PTC）** 以便在发送前微调提示词）。插件会自动在 `runsDir` 下拷贝出一份隔离的 `testbed/`，绑定 Workspace 并选中 `OfficeBench (PTC)` 预设，注入任务虚拟时钟上下文，同时打开右侧 **OfficeBench** 检查器标签页。
4. 模型通过 `run_code` 编写 TypeScript 程序批量调用办公工具。配合 `dsh-step-review-plugin` 时，每步完成后自动暂停，你可以切换右侧标签查看文件变化、点击预览文档、点击 **立即评测** 检查逐条规则通过情况，再选择继续或输入纠偏反馈。
5. 调试完毕或想重试时，点击 **重置 Testbed** 即可将运行目录一键恢复到初始状态，绝不会污染原始 OfficeBench 数据集仓库。

## 内置办公工具一览（24 个）

| 类别 | 工具名 |
|---|---|
| Testbed 辅助 | `officebench_list_files`, `officebench_read_text`, `finish_task` |
| Excel | `excel_read_file`, `excel_create_new_file`, `excel_set_cell`, `excel_delete_cell`, `excel_convert_to_pdf` |
| Word | `word_create_new_file`, `word_read_file`, `word_write_to_file`, `word_convert_to_pdf` |
| PDF 与图片 | `pdf_read_file`, `pdf_convert_to_word`, `pdf_convert_to_image`, `image_convert_to_pdf` |
| OCR | `ocr_recognize_file` |
| Email | `email_list_emails`, `email_read_email`, `email_send_email` |
| Calendar | `calendar_list_events`, `calendar_create_event`, `calendar_delete_event` |
| Shell | `shell_command` |

所有只读工具均声明 `isConcurrencySafe: () => true`，可在 `run_code` 中配合 `Promise.all(...)` 并发执行；所有路径严格约束在当前运行目录的 `testbed/` 之下。

## 支持的评测函数（完整覆盖 OfficeBench 全部 9 类）

- `evaluate_contain`（支持 `txt`、`xlsx`、`docx` / `doc`、`pdf`、`email`、`ics`）
- `evaluate_not_contain`
- `evaluate_file_exist`
- `evaluate_file_not_exist`
- `evaluate_diff_contain_text`（兼容 `../../../../cache/<subtask>/testbed/...` 初始基线路径）
- `evaluate_excel_cell_value`
- `evaluate_excel_cell_comparator`（安全解析 Python `lambda` 表达式，无动态 `eval`）
- `evaluate_exact_match`（兼容 `../../../../reference/...` 标准参考文件）
- `evaluate_calendar_no_overlap`

## 配置项

可在 Profile 的 `cordis.patch.yml` 中覆盖 `officebench` 条目：

```yaml
- id: officebench
  name: dsh-officebench-plugin
  config:
    datasetDir: 'D:/Research/EEG/experiments/OfficeBench'
    runsDir: ''                 # 留空默认存放在 $DSH_HOME/officebench-runs（或 ~/.dsh/officebench-runs）
    shellTimeoutMs: 30000       # 范围 1000..600000
    ocrLanguage: 'eng'
    libreOfficePath: ''         # 可选：手动指定 soffice 可执行路径
    tesseractPath: ''           # 可选：手动指定 tesseract CLI 路径
    pythonPath: ''              # 可选：用于 pdf_convert_to_image 的 Python（需安装 PyMuPDF）
    registerToolsGlobally: false # Web 模式下保持 false（工具由 preset-officebench 按会话作用域挂载）
```

## 许可证

[MIT](../LICENSE)
