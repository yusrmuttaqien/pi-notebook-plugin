import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// --- Types ---

interface NotebookCell {
	cell_type: "code" | "markdown";
	source: string[];
	outputs?: any[];
	execution_count?: number;
	id?: string;
	metadata?: Record<string, any>;
}

interface Notebook {
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, any>;
	cells: NotebookCell[];
}

// --- Helpers ---

function cellSource(cell: NotebookCell): string {
	return cell.source.join("");
}

function sourceToLines(source: string): string[] {
	// Split into lines, preserving newlines (per nbformat spec)
	const lines = source.split("\n");
	return lines.map((line, i) =>
		i < lines.length - 1 ? line + "\n" : line
	);
}

function outputStatus(cell: NotebookCell): string {
	if (cell.cell_type === "markdown") return "—";
	if (!cell.outputs || cell.outputs.length === 0) return "—";
	const hasImage = cell.outputs.some(
		(o: any) => o.output_type === "display_data" && o.data?.["image/png"],
	);
	const hasError = cell.outputs.some((o: any) => o.output_type === "error");
	if (hasError) return "✗";
	if (hasImage) return "📊";
	return "✓";
}

function truncate(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

// --- Core functions ---

export async function readNotebook(
	path: string,
	opts: { cells?: string; outputs?: boolean; maxLines?: number } = {},
): Promise<string> {
	const raw = await readFile(path, "utf-8");
	let nb: Notebook;
	try {
		nb = JSON.parse(raw);
	} catch (e: any) {
		throw new Error(`Not a valid .ipynb file: ${e.message}`);
	}

	if (!nb.cells || !Array.isArray(nb.cells)) {
		throw new Error("Not a valid .ipynb file (missing cells array)");
	}

	const maxLines = opts.maxLines ?? 5;
	const kernel = nb.metadata?.kernelspec?.display_name ?? "unknown";
	const lines: string[] = [];

	lines.push(`Notebook: ${path.split("/").pop()} (${nb.cells.length} cells)`);
	lines.push(`Kernel: ${kernel}`);

	// Summary table
	lines.push("");
	lines.push(" #  | Type     | Preview                          | Out");
	lines.push("----+----------+----------------------------------+----");

	for (let i = 0; i < nb.cells.length; i++) {
		const cell = nb.cells[i];
		const preview = truncate(cellSource(cell).trim(), maxLines)
			.replace(/\n/g, " ")
			.slice(0, 38)
			.padEnd(38, " ");
		const status = outputStatus(cell);
		lines.push(
			` ${String(i).padStart(3, " ")}| ${cell.cell_type.padEnd(8, " ")}| ${preview} | ${status}`,
		);
	}

	// Full cell details
	if (opts.cells) {
		const indices = opts.cells
			.split(",")
			.map((s) => parseInt(s.trim(), 10));
		for (const idx of indices) {
			if (idx < 0 || idx >= nb.cells.length) {
				throw new Error(`Cell index ${idx} out of range (0-${nb.cells.length - 1})`);
			}
			const cell = nb.cells[idx];
			lines.push("");
			lines.push(`--- Cell ${idx} (${cell.cell_type}) ---`);
			lines.push(cellSource(cell));

			if (opts.outputs && cell.outputs && cell.outputs.length > 0) {
				for (const out of cell.outputs) {
					if (out.output_type === "stream") {
						lines.push(`Output: ${out.text?.join("") ?? ""}`);
					} else if (out.output_type === "error") {
						lines.push(`Output (error): ${out.ename}: ${evalue(out.evalue)}`);
					} else if (out.output_type === "display_data" || out.output_type === "execute_result") {
						if (out.data?.["image/png"]) {
							lines.push(`Output: [image/png]`);
						} else if (out.data?.["text/plain"]) {
							lines.push(`Output: ${truncate(out.data["text/plain"].join(""), 20)}`);
						}
					}
				}
			}
		}
	}

	return lines.join("\n");
}

function evalue(v: any): string {
	if (typeof v === "string") return v;
	if (Array.isArray(v)) return v.join("");
	return String(v);
}

export async function readCell(
	path: string,
	index: number,
	outputs?: boolean,
): Promise<string> {
	const raw = await readFile(path, "utf-8");
	let nb: Notebook;
	try {
		nb = JSON.parse(raw);
	} catch (e: any) {
		throw new Error(`Not a valid .ipynb file: ${e.message}`);
	}

	if (!nb.cells || !Array.isArray(nb.cells)) {
		throw new Error("Not a valid .ipynb file (missing cells array)");
	}
	if (index < 0 || index >= nb.cells.length) {
		throw new Error(`Cell index ${index} out of range (0-${nb.cells.length - 1})`);
	}

	const cell = nb.cells[index];
	const lines: string[] = [];
	lines.push(`Cell ${index} (${cell.cell_type}):`);
	lines.push(cellSource(cell));

	if (outputs && cell.outputs && cell.outputs.length > 0) {
		for (const out of cell.outputs) {
			if (out.output_type === "stream") {
				lines.push(`\nOutput: ${out.text?.join("") ?? ""}`);
			} else if (out.output_type === "error") {
				lines.push(`\nOutput (error): ${out.ename}: ${evalue(out.evalue)}`);
			} else if (out.output_type === "display_data" || out.output_type === "execute_result") {
				if (out.data?.["image/png"]) {
					lines.push(`\nOutput: [image/png]`);
				} else if (out.data?.["text/plain"]) {
					lines.push(`\nOutput: ${truncate(out.data["text/plain"].join(""), 30)}`);
				}
			}
		}
	}

	if (cell.execution_count != null) {
		lines.push(`\n[In ${cell.execution_count}]`);
	}

	return lines.join("\n");
}

export async function editNotebook(
	path: string,
	opts: {
		op: "replace" | "targeted" | "insert" | "delete" | "clear_outputs";
		index: number;
		source?: string;
		old_text?: string;
		new_text?: string;
		type?: "code" | "markdown";
		position?: "before" | "after";
	},
): Promise<string> {
	const raw = await readFile(path, "utf-8");
	let nb: Notebook;
	try {
		nb = JSON.parse(raw);
	} catch (e: any) {
		throw new Error(`Not a valid .ipynb file: ${e.message}`);
	}

	if (!nb.cells || !Array.isArray(nb.cells)) {
		throw new Error("Not a valid .ipynb file (missing cells array)");
	}

	switch (opts.op) {
		case "replace": {
			if (opts.index < 0 || opts.index >= nb.cells.length) {
				throw new Error(`Cell index ${opts.index} out of range (0-${nb.cells.length - 1})`);
			}
			const cell = nb.cells[opts.index];
			cell.source = sourceToLines(opts.source!);
			const lineCount = opts.source!.split("\n").length;
			await writeNotebook(path, nb);
			return `OK: replaced cell ${opts.index} (${cell.cell_type}, ${lineCount} lines)`;
		}

		case "targeted": {
			if (opts.index < 0 || opts.index >= nb.cells.length) {
				throw new Error(`Cell index ${opts.index} out of range (0-${nb.cells.length - 1})`);
			}
			const cell = nb.cells[opts.index];
			const source = cellSource(cell);
			const matchCount = source.split(opts.old_text!).length - 1;
			if (matchCount === 0) {
				throw new Error(`old_text not found in cell ${opts.index}`);
			}
			if (matchCount > 1) {
				throw new Error(`old_text matches ${matchCount} times in cell ${opts.index} (use more context)`);
			}
			const newSource = source.replace(opts.old_text!, opts.new_text!);
			cell.source = sourceToLines(newSource);
			await writeNotebook(path, nb);
			return `OK: targeted edit in cell ${opts.index}`;
		}

		case "insert": {
			const pos = opts.position === "before" ? opts.index : Math.min(opts.index + 1, nb.cells.length);
			const newCell: NotebookCell = {
				cell_type: opts.type ?? "code",
				source: sourceToLines(opts.source!),
				id: crypto.randomUUID(),
			};
			nb.cells.splice(pos, 0, newCell);
			await writeNotebook(path, nb);
			return `OK: inserted ${newCell.cell_type} cell at ${pos}`;
		}

		case "delete": {
			if (opts.index < 0 || opts.index >= nb.cells.length) {
				throw new Error(`Cell index ${opts.index} out of range (0-${nb.cells.length - 1})`);
			}
			nb.cells.splice(opts.index, 1);
			await writeNotebook(path, nb);
			return `OK: deleted cell ${opts.index}`;
		}

		case "clear_outputs": {
			let count = 0;
			for (const cell of nb.cells) {
				if (cell.cell_type === "code" && cell.outputs?.length) {
					cell.outputs = [];
					cell.execution_count = undefined;
					count++;
				}
			}
			await writeNotebook(path, nb);
			return `OK: cleared outputs from ${count} cells`;
		}

		default:
			throw new Error(`Unknown operation: ${opts.op}`);
	}
}

async function writeNotebook(path: string, nb: Notebook): Promise<void> {
	// Atomic write: write to temp, then rename
	const tmpPath = path + ".tmp";
	await writeFile(tmpPath, JSON.stringify(nb, null, 1));
	const { rename } = await import("node:fs/promises");
	await rename(tmpPath, path);
}
