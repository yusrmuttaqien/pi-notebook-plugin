import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readNotebook, readCell, editNotebook } from "../src/notebook.js";

async function makeNotebook(cells: any[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-nb-"));
	const path = join(dir, "test.ipynb");
	const nb = {
		nbformat: 4,
		nbformat_minor: 5,
		metadata: { kernelspec: { display_name: "Python 3" } },
		cells,
	};
	await writeFile(path, JSON.stringify(nb, null, 1));
	return path;
}

test("readNotebook: summary view", async () => {
	const path = await makeNotebook([
		{ cell_type: "markdown", source: ["# Title\n"] },
		{ cell_type: "code", source: ["import pandas as pd\n", "df = pd.read_csv('data.csv')\n"] },
		{ cell_type: "code", source: ["df.head()\n"], outputs: [{ output_type: "stream", text: ["   col1\n"] }] },
	]);
	try {
		const result = await readNotebook(path);
		assert.match(result, /Notebook: test\.ipynb \(3 cells\)/);
		assert.match(result, /Kernel: Python 3/);
		assert.match(result, /markdown/);
		assert.match(result, /import pandas/);
		assert.match(result, /✓/);
	} finally {
		await rm(path, { force: true });
	}
});

test("readNotebook: full cell detail", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n", "y = 2\n", "print(x + y)\n"] },
	]);
	try {
		const result = await readNotebook(path, { cells: "0" });
		assert.match(result, /--- Cell 0 \(code\) ---/);
		assert.match(result, /x = 1/);
		assert.match(result, /y = 2/);
		assert.match(result, /print\(x \+ y\)/);
	} finally {
		await rm(path, { force: true });
	}
});

test("readCell: full source", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["hello = 'world'\n"] },
	]);
	try {
		const result = await readCell(path, 0);
		assert.match(result, /Cell 0 \(code\):/);
		assert.match(result, /hello = 'world'/);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: replace", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"] },
	]);
	try {
		const result = await editNotebook(path, { op: "replace", index: 0, source: "x = 42\n" });
		assert.match(result, /OK: replaced cell 0/);
		const content = await readCell(path, 0);
		assert.match(content, /x = 42/);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: targeted", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n", "y = 2\n", "print(x + y)\n"] },
	]);
	try {
		const result = await editNotebook(path, {
			op: "targeted",
			index: 0,
			old_text: "x = 1",
			new_text: "x = 42",
		});
		assert.match(result, /OK: targeted edit in cell 0/);
		const content = await readCell(path, 0);
		assert.match(content, /x = 42/);
		assert.match(content, /y = 2/);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: targeted no match", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"] },
	]);
	try {
		await assert.rejects(
			editNotebook(path, { op: "targeted", index: 0, old_text: "z = 99", new_text: "z = 100" }),
			/old_text not found in cell 0/,
		);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: targeted multiple matches", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n", "x = 2\n"] },
	]);
	try {
		await assert.rejects(
			editNotebook(path, { op: "targeted", index: 0, old_text: "x = ", new_text: "y = " }),
			/matches 2 times/,
		);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: insert", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"] },
	]);
	try {
		const result = await editNotebook(path, {
			op: "insert",
			index: 0,
			source: "print('hello')\n",
			position: "after",
		});
		assert.match(result, /OK: inserted code cell at 1/);
		const nb = JSON.parse(await readFile(path, "utf-8"));
		assert.equal(nb.cells.length, 2);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: delete", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"] },
		{ cell_type: "code", source: ["y = 2\n"] },
	]);
	try {
		const result = await editNotebook(path, { op: "delete", index: 0 });
		assert.match(result, /OK: deleted cell 0/);
		const nb = JSON.parse(await readFile(path, "utf-8"));
		assert.equal(nb.cells.length, 1);
	} finally {
		await rm(path, { force: true });
	}
});

test("editNotebook: clear_outputs", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"], outputs: [{ output_type: "stream", text: ["1\n"] }], execution_count: 1 },
		{ cell_type: "markdown", source: ["# Hello\n"] },
	]);
	try {
		const result = await editNotebook(path, { op: "clear_outputs", index: 0 });
		assert.match(result, /OK: cleared outputs from 1 cells/);
		const nb = JSON.parse(await readFile(path, "utf-8"));
		assert.equal(nb.cells[0].outputs.length, 0);
	} finally {
		await rm(path, { force: true });
	}
});

test("readNotebook: invalid file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-nb-"));
	const path = join(dir, "bad.ipynb");
	await writeFile(path, "not json");
	try {
		await assert.rejects(readNotebook(path), /Not a valid/);
	} finally {
		await rm(dir, { recursive: true });
	}
});

test("readNotebook: index out of range", async () => {
	const path = await makeNotebook([
		{ cell_type: "code", source: ["x = 1\n"] },
	]);
	try {
		await assert.rejects(
			readNotebook(path, { cells: "5" }),
			/out of range/,
		);
	} finally {
		await rm(path, { force: true });
	}
});
