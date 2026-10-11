import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readNotebook, readCell, editNotebook } from "./notebook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function activate(pi: ExtensionAPI) {
	const cwd = process.cwd();

	// --- notebook_read ---
	pi.registerTool({
		name: "notebook_read",
		label: "Notebook Read",
		description:
			"Read a Jupyter notebook (.ipynb) as a compact cell summary. " +
			"Returns cell index, type, source preview, and output status. " +
			"Use cells='N' for full detail on specific cells.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to .ipynb file (relative or absolute)" }),
			cells: Type.Optional(Type.String({ description: "Cell indices for full detail, e.g. '3' or '1,4,7'" })),
			outputs: Type.Optional(Type.Boolean({ description: "Include output text (default: false)" })),
			max_lines: Type.Optional(Type.Number({ description: "Max source lines per cell in summary (default: 5)" })),
		}),
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const path = resolve(cwd, params.path);
			try {
				await stat(path);
			} catch {
				return { content: [{ type: "text", text: `File not found: ${path}` }], details: undefined };
			}
			try {
				const result = await readNotebook(path, {
					cells: params.cells,
					outputs: params.outputs,
					maxLines: params.max_lines,
				});
				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (e: any) {
				return { content: [{ type: "text", text: `[notebook_read: ${e.message}]` }], details: undefined };
			}
		},
	});

	// --- notebook_cell ---
	pi.registerTool({
		name: "notebook_cell",
		label: "Notebook Cell",
		description:
			"Read the full source of a single notebook cell by index. " +
			"Returns plain text (no JSON escaping). Use outputs=true to include cell outputs.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to .ipynb file" }),
			index: Type.Number({ description: "Cell index (0-based)" }),
			outputs: Type.Optional(Type.Boolean({ description: "Include outputs (default: false)" })),
		}),
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const path = resolve(cwd, params.path);
			try {
				const result = await readCell(path, params.index, params.outputs);
				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (e: any) {
				return { content: [{ type: "text", text: `[notebook_cell: ${e.message}]` }], details: undefined };
			}
		},
	});

	// --- notebook_edit ---
	pi.registerTool({
		name: "notebook_edit",
		label: "Notebook Edit",
		description:
			"Edit a Jupyter notebook by cell operations. " +
			"Ops: replace (full cell), targeted (find/replace in cell), insert, delete, clear_outputs. " +
			"Source is plain text — no JSON escaping needed.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to .ipynb file" }),
			op: Type.Union([
				Type.Literal("replace"),
				Type.Literal("targeted"),
				Type.Literal("insert"),
				Type.Literal("delete"),
				Type.Literal("clear_outputs"),
			], { description: "Operation to perform" }),
			index: Type.Number({ description: "Target cell index (0-based). Not needed for clear_outputs." }),
			source: Type.Optional(Type.String({ description: "New cell source (for replace/insert). Plain text." })),
			old_text: Type.Optional(Type.String({ description: "Exact text to find (for targeted). Must match once." })),
			new_text: Type.Optional(Type.String({ description: "Replacement text (for targeted)." })),
			type: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("markdown")], { description: "Cell type (for insert, default: code)" })),
			position: Type.Optional(Type.Union([Type.Literal("before"), Type.Literal("after")], { description: "Insert position (default: after)" })),
		}),
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const path = resolve(cwd, params.path);
			try {
				const result = await editNotebook(path, {
					op: params.op,
					index: params.index,
					source: params.source,
					old_text: params.old_text,
					new_text: params.new_text,
					type: params.type,
					position: params.position,
				});
				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (e: any) {
				return { content: [{ type: "text", text: `[notebook_edit: ${e.message}]` }], details: undefined };
			}
		},
	});
}
