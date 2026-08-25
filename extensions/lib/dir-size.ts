/**
 * Helpers puros para dir-size — sin dependencias de pi/typebox, testeables
 * con `node test/dir-size.test.ts`.
 */

import { execFile } from "node:child_process";
import { readdir, lstat } from "node:fs/promises";
import { join, relative, resolve, sep, isAbsolute } from "node:path";

export const KILO = 1024;
export const MEGA = 1024 * 1024;
export const GIGA = 1024 * 1024 * 1024;
export const MAX_GB = 5;
export const MAX_BYTES = MAX_GB * GIGA;
export const DU_POLL_MS = 15000;

// ponytail: gradiente blanco→rojo 0–5 GB, lerp lineal O(1). 0 GB = #ffffff, 5 GB = #ff0000 (clamped).
export function sizeGradientRgb(bytes: number): { r: number; g: number; b: number } {
	const f = Math.min(1, Math.max(0, bytes / MAX_BYTES));
	return { r: 255, g: Math.round(255 * (1 - f)), b: Math.round(255 * (1 - f)) };
}
export function sizeGradientHex(bytes: number): string {
	const { r, g, b } = sizeGradientRgb(bytes);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
export function sizeGradientFg(text: string, bytes: number): string {
	const { r, g, b } = sizeGradientRgb(bytes);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

// ponytail: auto escala 1024, 2 decimales fijos (simple, legible).
export function formatBytes(bytes: number, opts?: { unit?: string }): string {
	const b = Math.max(0, bytes);
	const u = opts?.unit?.toLowerCase();
	if (u === "bytes" || u === "byte" || u === "b") return `${b} B`;
	if (u === "kb" || u === "k" || u === "kilo" || u === "kilos" || u === "kilobyte" || u === "kilobytes")
		return `${(b / KILO).toFixed(2)} KB`;
	if (u === "mb" || u === "m" || u === "mega" || u === "megas" || u === "megabyte" || u === "megabytes")
		return `${(b / MEGA).toFixed(2)} MB`;
	if (u === "gb" || u === "g" || u === "giga" || u === "gigas" || u === "gigabyte" || u === "gigabytes")
		return `${(b / GIGA).toFixed(2)} GB`;
	if (b >= GIGA) return `${(b / GIGA).toFixed(2)} GB`;
	if (b >= MEGA) return `${(b / MEGA).toFixed(2)} MB`;
	if (b >= KILO) return `${(b / KILO).toFixed(2)} KB`;
	return `${b} B`;
}

export function parseDuArgs(raw: string, cwd: string): { target: string; unit?: string } {
	if (!raw || !raw.trim()) return { target: cwd, unit: undefined };
	const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	let target: string | undefined;
	let unit: string | undefined;
	for (const tok of tokens) {
		const token = tok.replace(/^"|"$/g, "");
		const lower = token.toLowerCase();
		if (["--gb", "--giga", "--gigas", "--gigabytes", "-g"].includes(lower)) unit = "gb";
		else if (["--mb", "--mega", "--megas", "--megabytes", "-m"].includes(lower)) unit = "mb";
		else if (["--kb", "--kilo", "--kilos", "--kilobytes", "-k"].includes(lower)) unit = "kb";
		else if (["--bytes", "--byte", "--b", "-b"].includes(lower)) unit = "bytes";
		else if (["--human", "-h", "--auto", "--humano", "-a"].includes(lower)) unit = undefined;
		else if (lower.startsWith("--unit=")) {
			const v = lower.split("=")[1];
			if (["gb", "giga", "gigas"].includes(v)) unit = "gb";
			else if (["mb", "mega", "megas"].includes(v)) unit = "mb";
			else if (["kb", "kilo", "kilos"].includes(v)) unit = "kb";
			else if (["bytes", "b"].includes(v)) unit = "bytes";
			else unit = undefined;
		} else if (!target) {
			target = token;
		}
	}
	const resolved = target ? resolve(cwd, target) : cwd;
	return { target: resolved, unit };
}

export function formatCwdShort(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	try {
		const rcwd = resolve(cwd);
		const rhome = resolve(home);
		const rel = relative(rhome, rcwd);
		const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
		if (!inside) return cwd;
		return rel === "" ? "~" : `~${sep}${rel}`;
	} catch {
		return cwd;
	}
}

function tryDu(flags: string[], target: string): Promise<number | null> {
	return new Promise((res) => {
		execFile("du", [...flags, target], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
			if (err || !stdout) return res(null);
			const first = stdout.trim().split(/\s+/)[0];
			const n = Number(first);
			if (!Number.isFinite(n)) return res(null);
			res(n);
		});
	});
}

// ponytail: O(n) archivos, stack iterativo, salta symlinks (evita loops).
async function fallbackSize(root: string): Promise<number> {
	let total = 0;
	const stack: string[] = [root];
	while (stack.length) {
		const cur = stack.pop()!;
		try {
			const st = await lstat(cur);
			if (st.isSymbolicLink()) continue;
			if (st.isFile()) total += st.size;
			else if (st.isDirectory()) {
				const entries = await readdir(cur);
				for (const e of entries) stack.push(join(cur, e));
			}
		} catch {}
	}
	return total;
}

export async function getDirSize(target: string): Promise<number> {
	const b = await tryDu(["-sb"], target);
	if (b !== null) return b;
	const k = await tryDu(["-sk"], target);
	if (k !== null) return k * KILO;
	return fallbackSize(target);
}
