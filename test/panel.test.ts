import {
	chartLines,
	computeTps,
	contextBar,
	pushSample,
	summarizeToolArgs,
} from "../extensions/panel.ts";
import { stripAnsi } from "../extensions/tok-per-second.ts";
import assert from "node:assert";

// --- computeTps: chars/4 por segundo, 0 sin tiempo transcurrido ---
assert.equal(computeTps(400, 1000), 100);
assert.equal(computeTps(200, 500), 100);
assert.equal(computeTps(0, 1000), 0);
assert.equal(computeTps(100, 0), 0);

// --- pushSample: buffer circular con tope ---
assert.deepEqual(pushSample([1, 2, 3], 3, 4), [2, 3, 4]);
assert.deepEqual(pushSample([], 5, 1), [1]);
assert.deepEqual(pushSample([1, 2], 3, 3), [1, 2, 3]);

// --- chartLines: sin muestras → `height` líneas vacías, dentro de ancho ---
let chart = chartLines([], 40, 5);
assert.equal(chart.length, 5);
for (const l of chart)
	assert.ok(stripAnsi(l).length <= 40, "blank line too wide");

// --- chartLines: con muestras → ancho respetado, etiqueta máxima, eje ---
const samples = [10, 20, 40, 80, 160, 320];
chart = chartLines(samples, 24, 5);
assert.equal(chart.length, 5);
for (const l of chart) assert.ok(stripAnsi(l).length <= 24, "line too wide");
assert.ok(chart[0]!.includes("320"), "max label on top row");
assert.ok(chart[chart.length - 1]!.includes("─"), "axis row present");
assert.ok(
	stripAnsi(chart[0]!).includes("320"),
	"top row label visible after strip",
);

// altura pedida se respeta (filas de bloque crecen hasta 8 + eje)
assert.equal(chartLines([50], 24, 9).length, 9);
assert.equal(chartLines([50], 24, 4).length, 4);
// más muestras que columnas → solo las últimas, sin exceder ancho
chart = chartLines(
	Array.from({ length: 60 }, (_, i) => i * 10),
	20,
	6,
);
for (const l of chart) assert.ok(stripAnsi(l).length <= 20);

// --- summarizeToolArgs: campo principal o JSON truncado ---
assert.equal(summarizeToolArgs("bash", { command: "npm test" }), "npm test");
assert.equal(
	summarizeToolArgs("read", { path: "src/a.ts", offset: 1 }),
	"src/a.ts",
);
assert.equal(summarizeToolArgs("grep", { pattern: "foo" }), "foo");
assert.equal(summarizeToolArgs("webfetch", { url: "https://x" }), "https://x");
assert.equal(summarizeToolArgs("write", { path: "a/b.ts" }), "a/b.ts");
assert.ok(summarizeToolArgs("custom", { a: 1, b: 2 }).startsWith("{"));
assert.equal(summarizeToolArgs("x", null), "");

// --- contextBar: clamp y ancho exacto ---
assert.equal(contextBar(50, 10), "█████░░░░░");
assert.equal(contextBar(0, 4), "░░░░");
assert.equal(contextBar(100, 4), "████");
assert.equal(contextBar(200, 4), "████");
assert.equal(contextBar(-10, 6), "░░░░░░");

console.log("panel: all checks passed");
