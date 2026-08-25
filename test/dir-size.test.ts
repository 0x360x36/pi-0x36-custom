import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBytes, parseDuArgs, getDirSize, sizeGradientRgb, sizeGradientHex, KILO, MEGA, GIGA, MAX_BYTES } from "../extensions/lib/dir-size.ts";

// formatBytes — auto (gigas/megas/kilos)
assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(500), "500 B");
assert.equal(formatBytes(KILO), "1.00 KB");
assert.equal(formatBytes(1536), "1.50 KB");
assert.equal(formatBytes(MEGA), "1.00 MB");
assert.equal(formatBytes(2.5 * MEGA), "2.50 MB");
assert.equal(formatBytes(GIGA), "1.00 GB");
assert.equal(formatBytes(1.5 * GIGA), "1.50 GB");

// unidades forzadas (gigas/megas/kilos/bytes) — alias en español
assert.equal(formatBytes(500, { unit: "bytes" }), "500 B");
assert.equal(formatBytes(KILO, { unit: "kb" }), "1.00 KB");
assert.equal(formatBytes(KILO, { unit: "kilos" }), "1.00 KB");
assert.equal(formatBytes(KILO, { unit: "kilo" }), "1.00 KB");
assert.equal(formatBytes(MEGA, { unit: "mb" }), "1.00 MB");
assert.equal(formatBytes(MEGA, { unit: "megas" }), "1.00 MB");
assert.equal(formatBytes(MEGA, { unit: "mega" }), "1.00 MB");
assert.equal(formatBytes(GIGA, { unit: "gb" }), "1.00 GB");
assert.equal(formatBytes(GIGA, { unit: "gigas" }), "1.00 GB");
assert.equal(formatBytes(GIGA, { unit: "giga" }), "1.00 GB");

// parseDuArgs — cwd y flags
const cwd = "/tmp/pi-test";
assert.deepEqual(parseDuArgs("", cwd), { target: cwd, unit: undefined });
assert.deepEqual(parseDuArgs("--gb", cwd), { target: cwd, unit: "gb" });
assert.deepEqual(parseDuArgs("--gigas", cwd), { target: cwd, unit: "gb" });
assert.deepEqual(parseDuArgs("--mb ./dist", cwd), { target: join(cwd, "dist"), unit: "mb" });
assert.deepEqual(parseDuArgs("./dist --kb", cwd), { target: join(cwd, "dist"), unit: "kb" });
assert.deepEqual(parseDuArgs("--bytes /tmp", "/"), { target: "/tmp", unit: "bytes" });
assert.deepEqual(parseDuArgs('"my dir" --mb', cwd), { target: join(cwd, "my dir"), unit: "mb" });
assert.deepEqual(parseDuArgs("--unit=gb", cwd), { target: cwd, unit: "gb" });
assert.deepEqual(parseDuArgs("--unit=megas /var", cwd), { target: "/var", unit: "mb" });

// getDirSize — sobre directorio temporal real (du o fallback debe dar >= suma de ficheros)
const root = mkdtempSync(join(tmpdir(), "pi-dirsize-"));
try {
	mkdirSync(join(root, "sub"));
	writeFileSync(join(root, "a.txt"), Buffer.alloc(100));
	writeFileSync(join(root, "sub", "b.txt"), Buffer.alloc(200));
	const bytes = await getDirSize(root);
	// du incluye overhead de bloques; fallback suma exacta. Solo exigimos >= 300
	assert.ok(bytes >= 300, `expected >=300 got ${bytes}`);
	// no debe ser absurdamente grande para 2 ficheros de 300B
	assert.ok(bytes < 10 * MEGA, `too large: ${bytes}`);
} finally {
	rmSync(root, { recursive: true, force: true });
}

// gradiente blanco (0 GB) → rojo (5 GB) — clamped
assert.deepEqual(sizeGradientRgb(0), { r: 255, g: 255, b: 255 });
assert.equal(sizeGradientHex(0), "#ffffff");
assert.deepEqual(sizeGradientRgb(MAX_BYTES), { r: 255, g: 0, b: 0 });
assert.equal(sizeGradientHex(MAX_BYTES), "#ff0000");
assert.deepEqual(sizeGradientRgb(MAX_BYTES * 2), { r: 255, g: 0, b: 0 }); // clamped >5GB
assert.deepEqual(sizeGradientRgb(-100), { r: 255, g: 255, b: 255 }); // clamped <0
// punto medio 2.5 GB → rosa #ff8080 (255,128,128)
const mid = Math.round(MAX_BYTES / 2);
assert.deepEqual(sizeGradientRgb(mid), { r: 255, g: 128, b: 128 });
assert.equal(sizeGradientHex(mid), "#ff8080");

console.log("dir-size: all checks passed");
