# pi-notebook — Specification

**Version:** 0.1.0 (draft)
**Date:** 2026-07-11
**Status:** Draft

## 1. Overview

A pi extension that provides notebook-aware tools for reading and editing `.ipynb` files. The core principle: **offload JSON structure to the tool, give the model a compact view**. The model never sees raw ipynb JSON — it sees a clean, minimal representation and interacts via cell indices.

**Problem:** Raw `.ipynb` files are large JSON documents (often 100KB–5MB+). When a model reads the full file, outputs and metadata dominate, causing:
- Token waste on structure the model doesn't need
- Confusion from nested JSON
- Loop behavior when trying to "find" the right cell in raw JSON
- Edit errors from JSON escaping

**Solution:** Tools that parse, compact, and manipulate the JSON internally. The model sees summaries and edits by cell index.

## 2. Tools

### 2.1 `notebook_read`

Read a notebook and return a compact cell summary.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Path to `.ipynb` file (relative or absolute) |
| `cells` | string | no | Cell indices to include in full detail, e.g. `"3"` or `"1,4,7"`. Omit for summary-only. |
| `outputs` | boolean | no | Include output text in the response (default: `false`). |
| `max_lines` | number | no | Max source lines per cell in summary view (default: 5). |

**Response format (summary mode):**
```
Notebook: my_analysis.ipynb (12 cells)
Kernel: python3

 #  | Type     | Preview                          | Out
----+----------+----------------------------------+----
  0 | markdown | # Data Loading Pipeline            | —
  1 | code     | import pandas as pd                | ✓
  2 | code     | df = pd.read_csv("data.csv")       | ✓
  3 | code     | df.head()                          | ✗ ValueError
  4 | markdown | ## Analysis                        | —
  5 | code     | plt.figure(figsize=(10, 6))        | 📊
  ...
```

**Response format (with `cells` param):**
```
Notebook: my_analysis.ipynb (12 cells)

--- Cell 3 (code) ---
df = pd.read_csv("data.csv")
df.head()

Output (error):
ValueError: shape mismatch: objects of length 5 cannot be
broadcast to dimension 0 with size 3

--- Cell 5 (code) ---
plt.figure(figsize=(10, 6))
df.plot(x="date", y="value")
plt.show()

Output: [image/png, 50KB]
```

**Design notes:**
- Outputs are **stripped by default** (they're the bulk of file size)
- `outputs: true` includes text outputs (truncated to ~2KB per cell) and image placeholders
- Cell indices are 0-based, matching the `cells` array in the JSON
- Markdown cells show full source (they're usually short)
- Code cells show first `max_lines` lines in summary, full source when requested
- Output status: `✓` (success), `✗` (error), `📊` (has image output), `—` (no output / markdown)

### 2.2 `notebook_cell`

Read the full content of a single cell.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Path to `.ipynb` file |
| `index` | number | yes | Cell index (0-based) |
| `outputs` | boolean | no | Include outputs (default: `false`) |

**Response:**
```
Cell 3 (code):
df = pd.read_csv("data.csv")
df.head()

Output:
   col1  col2  col3
0  0.12  3.45  6.78
1  0.23  4.56  7.89
```

**Design notes:**
- Returns source as a plain string (not JSON-escaped)
- Outputs included only if requested
- Image outputs shown as `[image/png, 12KB]` placeholder
- Execution count included if present

### 2.3 `notebook_edit`

Edit a notebook by cell operations.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Path to `.ipynb` file |
| `op` | string | yes | Operation: `replace`, `targeted`, `insert`, `delete`, `clear_outputs` |
| `index` | number | yes (except `clear_outputs`) | Target cell index |
| `source` | string | yes (for `replace`/`insert`) | New cell source (plain text, tool handles JSON encoding) |
| `old_text` | string | yes (for `targeted`) | Exact text to find (must match once) |
| `new_text` | string | yes (for `targeted`) | Replacement text |
| `type` | string | no (for `insert`) | Cell type: `code` (default) or `markdown` |
| `position` | string | no (for `insert`) | `before` or `after` (default: `after`) |

**Operations:**
| Op | Description |
|---|---|
| `replace` | Replace entire source of cell at `index`. Preserves cell type. |
| `targeted` | Find-and-replace within cell at `index`. `old_text` must match exactly once. |
| `insert` | Insert new cell at `index` (`before` or `after`). |
| `delete` | Delete cell at `index`. |
| `clear_outputs` | Clear all `outputs` and `execution_count` from all code cells. |

**`targeted` behavior:**
- Like pi's native `edit` tool, scoped to a single cell
- `old_text` must match exactly once in the cell source
- No match → error: `"old_text not found in cell N"`
- Multiple matches → error: `"old_text matches N times in cell M (use more context)"`
- Plain text in/out, no JSON escaping

**Response:**
```
OK: replaced cell 3 (code, 4 lines)
```
or
```
OK: inserted markdown cell at 5 (before)
```
or
```
OK: cleared outputs from 8 cells
```

**Design notes:**
- Source is plain text — the tool handles JSON array-of-strings encoding
- Cell type is preserved on `replace` (can't change type, use `delete` + `insert`)
- `clear_outputs` is a whole-notebook operation (no index needed)
- File is written atomically (write to temp, rename)
- Backup: original file saved as `<name>.ipynb.bak` (overwritten each edit)

### 2.4 `notebook_clear`

Clear all outputs and execution counts from the notebook.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Path to `.ipynb` file |

**Response:**
```
OK: cleared outputs from 8 cells (freed ~45KB)
```

**Design notes:**
- Convenience wrapper around `notebook_edit` with `op: clear_outputs`
- Reports how much space was freed
- Useful before committing notebooks to git

## 3. What the model does NOT see

- Raw JSON structure (`cells`, `metadata`, `nbformat`, etc.)
- Full outputs (unless explicitly requested)
- Cell IDs (internal UUIDs)
- Attachment data (base64 images in outputs)
- Metadata fields (kernel specs, language info)

## 4. What the model DOES see

- Cell index (0-based)
- Cell type (code/markdown)
- Source preview (first N lines)
- Output status (success/error/image/none)
- Notebook metadata: cell count, kernel name

## 5. File format handling

- **Read:** Parse JSON, validate `nbformat` field (support 4.x)
- **Write:** Preserve `nbformat`, `nbformat_minor`, top-level `metadata`
- **Cell IDs:** Preserve existing `id` fields; generate new ones for inserted cells
- **Outputs:** Preserved in file (only hidden from model view), except when explicitly cleared
- **Encoding:** Source is always an array of strings (one per line), per nbformat spec

## 6. Edge cases

| Case | Behavior |
|---|---|
| File not found | Return error: "File not found: <path>" |
| Invalid JSON | Return error: "Invalid notebook: <parse error>" |
| Not a notebook (no `cells` field) | Return error: "Not a valid .ipynb file" |
| Cell index out of range | Return error: "Cell index 15 out of range (0-11)" |
| Empty notebook (0 cells) | Return "Notebook: <path> (0 cells)" |
| Very long cell (>1000 lines) | Truncate in summary with `... (N more lines)` |
| Binary outputs (base64 images) | Show as `[image/png, 12KB]` placeholder |
| Corrupted file | Return error with line/position info |

## 7. Performance

- **Target:** <50ms for `notebook_read` on a 1MB notebook
- **Target:** <20ms for `notebook_cell`
- **Target:** <100ms for `notebook_edit` (including file write)
- No external processes, no subprocess calls
- Pure in-memory JSON manipulation

## 8. Dependencies

- **Runtime:** Node.js (built-in `fs`, no external packages for core functionality)
- **Optional:** `@lumino/nbformat` for validation (if we want strict nbformat compliance)
- **No:** No Jupyter kernel, no jupyter server, no Python required

## 9. Installation

```bash
pi install npm:pi-notebook
```

## 10. Future work (not in v1)

- `notebook_run` — execute cells via Jupyter kernel (requires `jupyter-client` or `nbdime`)
- `notebook_diff` — show changes between two notebook versions
- `notebook_search` — search across cells (grep-like)
- `notebook_tag` — tag cells for batch operations
- Integration with `pi-jupyter` preview extension (auto-refresh on edit)
- Support for `.jl` (JupyterLite) and `.qmd` (Quarto) notebook formats
- Multi-file notebooks (nbconvert-style)

## 11. Design principles

1. **Model sees compact, tool sees full** — the model gets a ~2KB summary of a 500KB notebook
2. **Edit by index + targeted text** — no `cells[3].source[0]` addressing; small changes use `targeted` (find/replace), full rewrites use `replace`
3. **Plain text in, plain text out** — the model never deals with JSON escaping
4. **Outputs are invisible by default** — they're the bulk of file size and rarely needed for editing
5. **Atomic writes** — no partial writes on failure
6. **No external processes** — pure in-memory, no subprocess, no kernel
