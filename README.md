# pi-notebook-plugin

Pi extension: notebook tools for reading and editing `.ipynb` files with compact cell views.

Offloads JSON structure to the tool so the model sees a clean, minimal representation — never raw ipynb JSON.

## Tools

| Tool | Purpose |
|---|---|
| `notebook_read` | Compact cell summary (index, type, preview, output status) |
| `notebook_cell` | Full source of one cell by index |
| `notebook_edit` | Replace/targeted/insert/delete cells, clear outputs |

## Key principles

- Model never sees raw JSON
- Edit by cell index, not JSON path
- Plain text in/out (no JSON escaping)
- Outputs invisible by default
- Pure in-memory, no subprocess, no kernel

## Install

```bash
pi install npm:pi-notebook-plugin
```

## Development

```bash
npm install
npm run build
npm test
```
