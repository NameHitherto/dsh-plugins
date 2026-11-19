# dsh-officebench-plugin

English | [中文](README.zh.md)

Interactive [OfficeBench](https://github.com/zlwang-cs/OfficeBench) debugging workbench, programmatic TypeScript batch office tools (PTC), and live rule-by-rule task evaluator for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web UI.

Designed to compose seamlessly with [`dsh-step-review-plugin`](../dsh-step-review-plugin) so you can inspect live testbed mutations, preview generated `.xlsx` / `.docx` / `.pdf` files, evaluate rules mid-trajectory, and steer the agent step by step.

## Features

- **Left-sidebar OfficeBench Workbench**: Point to your local OfficeBench checkout (saved persistently or via `OFFICEBENCH_DIR`), browse and filter all 300 tasks by app count (`1` / `2` / `3`), app tag (`excel`, `word`, `pdf`, `ocr`, `email`, `calendar`, `shell`), or search query, toggle blind mode (hide ground-truth rules), and launch isolated per-task runs with one click.
- **Dedicated `OfficeBench (PTC)` Agent Preset (`officebench`)**: Powered by `@deepseek-ai/dsh-tool-executor-ptc` (`run_code`), so the model writes concise TypeScript programs that batch-call all 24 OfficeBench office tools in loops or `Promise.all(...)` with read-only concurrency safety and strict testbed path confinement.
- **Pure-Node Office Engine + Optional Native Acceleration**: Built-in `exceljs`, `jszip` (OOXML Word), `unpdf`, `pdf-lib`, `postal-mime`, RFC 5545 `.ics` calendar engine, and `tesseract.js` work out of the box on Windows, macOS, and Linux without Docker, automatically upgrading to local LibreOffice, Tesseract CLI, or Python PyMuPDF when present.
- **Right-sidebar Live Testbed Inspector**: Inspect file diffs (`added` / `modified` / `deleted`), click any file to preview it natively in DSH's Document Preview (`.xlsx`, `.docx`, `.pdf`, images, text), inspect `answer.txt`, emails, and calendar events, run all 9 OfficeBench evaluators live, and reset the testbed to its pristine initial snapshot at any time.
- **Step-by-step Human Review**: Combine with `dsh-step-review-plugin` in the same profile so the agent pauses after each `run_code` step via `ctx.userQuestions`, letting you inspect artifacts and run live evaluations before continuing, steering, or stopping.

## Installation

### From npm (standard)

Publish the package to npm first, then subscribe and install by package name into your DSH profile:

```sh
dsh plugin --profile <profile> add dsh-officebench-plugin
```

### Composing with `dsh-step-review-plugin`

Install both published plugins from npm into the same Web profile (for example `web` or `research-web`):

```sh
dsh plugin --profile research-web add dsh-step-review-plugin
dsh plugin --profile research-web add dsh-officebench-plugin
dsh --profile research-web --dump-config
```

Then start DSH Web UI:

```sh
OFFICEBENCH_DIR=/path/to/OfficeBench dsh --profile research-web
```

Or configure the dataset path directly in the **OfficeBench** panel inside the Web UI.

### Local tarball installation (development & testing only)

For local development and pre-publish testing only:

```sh
pnpm --filter dsh-officebench-plugin run build
pnpm --filter dsh-officebench-plugin pack
dsh plugin --profile <profile> add ./dsh-officebench-plugin/dsh-officebench-plugin-0.1.0.tgz
```

## Typical interactive debugging workflow

1. Open the **OfficeBench** entry in the left sidebar and verify the dataset path (e.g. 300 tasks detected).
2. Filter tasks by app count (`1` / `2` / `3`), app tag, or keyword, and inspect the task brief and initial files.
3. Click **Launch & run (PTC)** (or **Open draft (PTC)** to edit the prompt first). DSH creates an isolated run directory under `runsDir`, opens a workspace bound to `testbed/`, selects the `OfficeBench (PTC)` preset, injects the task's virtual clock/user context, and opens the right-sidebar **OfficeBench** Inspector tab.
4. The agent solves the task using TypeScript programs via `run_code`. When `dsh-step-review-plugin` is enabled, execution pauses after every step so you can inspect file changes, preview Excel/Word/PDF files, click **Evaluate now**, and provide targeted feedback or continue.
5. Click **Reset testbed** at any time to restore the initial files cleanly without mutating your source OfficeBench repository.

## Registered tools (24)

| Category | Tools |
|---|---|
| Testbed utilities | `officebench_list_files`, `officebench_read_text`, `finish_task` |
| Excel | `excel_read_file`, `excel_create_new_file`, `excel_set_cell`, `excel_delete_cell`, `excel_convert_to_pdf` |
| Word | `word_create_new_file`, `word_read_file`, `word_write_to_file`, `word_convert_to_pdf` |
| PDF & Images | `pdf_read_file`, `pdf_convert_to_word`, `pdf_convert_to_image`, `image_convert_to_pdf` |
| OCR | `ocr_recognize_file` |
| Email | `email_list_emails`, `email_read_email`, `email_send_email` |
| Calendar | `calendar_list_events`, `calendar_create_event`, `calendar_delete_event` |
| Shell | `shell_command` |

All read-only tools declare `isConcurrencySafe: () => true` for parallel `Promise.all(...)` batching inside `run_code`. All file paths resolve strictly inside the active run's `testbed/` directory.

## Supported evaluators (all 9 OfficeBench functions)

- `evaluate_contain` (`txt`, `xlsx`, `docx` / `doc`, `pdf`, `email`, `ics`)
- `evaluate_not_contain`
- `evaluate_file_exist`
- `evaluate_file_not_exist`
- `evaluate_diff_contain_text` (including `../../../../cache/<subtask>/testbed/...` baseline resolution)
- `evaluate_excel_cell_value`
- `evaluate_excel_cell_comparator` (safe Python lambda expression evaluator)
- `evaluate_exact_match` (including `../../../../reference/...` resolution)
- `evaluate_calendar_no_overlap`

## Configuration

Override the `officebench` row in your profile's `cordis.patch.yml`:

```yaml
- id: officebench
  name: dsh-officebench-plugin
  config:
    datasetDir: 'D:/Research/EEG/experiments/OfficeBench'
    runsDir: ''                 # Defaults to $DSH_HOME/officebench-runs (or ~/.dsh/officebench-runs)
    shellTimeoutMs: 30000       # 1000..600000
    ocrLanguage: 'eng'
    libreOfficePath: ''         # Optional explicit soffice path
    tesseractPath: ''           # Optional explicit tesseract CLI path
    pythonPath: ''              # Optional Python path for PyMuPDF pdf_convert_to_image
    registerToolsGlobally: false # Keep false in Web profiles (preset-officebench scopes tools)
```

## License

[MIT](../LICENSE)
