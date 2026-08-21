/**
 * Git branch/status para el footer — separado de tok-per-second.
 *
 * Estado de rama en tiempo real: `git status --porcelain --branch`
 * sondeado cada GIT_DIRTY_POLL_MS y re-render solo al cambiar.
 */

import { execFile } from "node:child_process";

// ponytail: helpers puros para testear sin TUI
export type GitState = {
	dirty?: boolean | null;
	ahead?: boolean | number | null;
	behind?: boolean | number | null;
	staged?: number | null;
	unstaged?: number | null;
	untracked?: number | null;
	conflicted?: number | null;
};

type BranchFg = (
	text: string,
	color: "warning" | "error" | "success" | "white",
) => string;

export const GIT_DIRTY_POLL_MS = 2000;

// ponytail: parse v1 --porcelain --branch, O(n) líneas. Cuenta staged (X),
// unstaged (Y), untracked (??), conflicto (DD/AA/UU/AU/UA/DU/UD) y ahead/behind
// de la cabecera "## branch...origin/branch [ahead N, behind M]".
export function parsePorcelain(stdout: string): GitState {
	const lines = stdout.split("\n");
	const header = lines[0] ?? "";
	const body = lines.slice(1);
	const ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0);
	const behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0);
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	let conflicted = 0;
	for (const line of body) {
		if (!line) continue;
		if (line.startsWith("??")) {
			untracked++;
			continue;
		}
		if (line.startsWith("!!")) continue;
		if (line.length < 2) continue;
		const x = line[0];
		const y = line[1];
		const pair = x + y;
		if (["DD", "AA", "UU", "AU", "UA", "DU", "UD"].includes(pair)) {
			conflicted++;
			continue;
		}
		if (!" ?!#".includes(x)) staged++;
		if (!" ?!#".includes(y)) unstaged++;
	}
	const s: GitState = {};
	if (staged) s.staged = staged;
	if (unstaged) s.unstaged = unstaged;
	if (untracked) s.untracked = untracked;
	if (conflicted) s.conflicted = conflicted;
	if (ahead) s.ahead = ahead;
	if (behind) s.behind = behind;
	if (staged || unstaged || untracked || conflicted) s.dirty = true;
	return s;
}

// Segmento de rama para el footer: " [±main ●2 ?1 ↑1]" — [ ] blancos, ± verde,
// + verde = staged, ● amarillo = unstaged, ? amarillo = untracked,
// ✖ rojo = conflicto, ↑/↓ rojo = ahead/behind. " [±main]" limpio o mientras el
// primer sondeo no responde, " [detached]" en detached HEAD y "" fuera
// de un repo. Puro: sin fg pinta plano y sirve para testearlo.
export function branchSegment(
	branch: string | null | undefined,
	state: GitState,
	fg?: BranchFg,
): string {
	if (!branch) return "";
	if (branch === "detached") return " [detached]";
	const paint: BranchFg = fg ?? ((t) => t);
	const left = paint("[", "white");
	const pm = paint("±", "success");
	const name = paint(branch, "white");
	const hasDetailed =
		state.staged != null ||
		state.unstaged != null ||
		state.untracked != null ||
		state.conflicted != null ||
		typeof state.ahead === "number" ||
		typeof state.behind === "number";
	if (!hasDetailed) {
		const marks =
			(state.dirty ? paint("●", "warning") : "") +
			(state.ahead ? paint("●", "error") : "") +
			(state.behind ? paint("●", "error") : "");
		const right = paint("]", "white");
		return ` ${left}${pm}${name}${marks ? ` ${marks}` : ""}${right}`;
	}
	const marks: string[] = [];
	if (state.conflicted) {
		const n = state.conflicted;
		marks.push(paint(`✖${n > 1 ? n : ""}`, "error"));
	}
	if (state.staged) {
		const n = state.staged;
		marks.push(paint(`+${n > 1 ? n : ""}`, "success"));
	}
	if (state.unstaged) {
		const n = state.unstaged;
		marks.push(paint(`●${n > 1 ? n : ""}`, "warning"));
	}
	if (
		!state.staged &&
		!state.unstaged &&
		!state.conflicted &&
		!state.untracked &&
		state.dirty
	) {
		marks.push(paint("●", "warning"));
	}
	if (state.untracked) {
		const n = typeof state.untracked === "number" ? state.untracked : 1;
		marks.push(paint(`?${n > 1 ? n : ""}`, "warning"));
	}
	const aheadVal = state.ahead;
	if (typeof aheadVal === "number" && aheadVal > 0) {
		marks.push(paint(`↑${aheadVal > 1 ? aheadVal : ""}`, "error"));
	} else if (aheadVal) {
		marks.push(paint("●", "error"));
	}
	const behindVal = state.behind;
	if (typeof behindVal === "number" && behindVal > 0) {
		marks.push(paint(`↓${behindVal > 1 ? behindVal : ""}`, "error"));
	} else if (behindVal) {
		marks.push(paint("●", "error"));
	}
	const right = paint("]", "white");
	return ` ${left}${pm}${name}${marks.length ? ` ${marks.join(" ")}` : ""}${right}`;
}

// ponytail: sondeo con setInterval en vez de fs.watch del worktree — un edit
// de archivo plano no toca .git, así que watch solo daría falsos negativos.
// Si algún día molesta en repos enormes: subir GIT_DIRTY_POLL_MS.
export function startGitPoller(
	getCwd: () => string | undefined,
	onChange: (s: GitState) => void,
): () => void {
	let lastState: GitState = {};
	let inFlight = false;

	const poll = () => {
		const cwd = getCwd();
		if (!cwd || inFlight) return;
		inFlight = true;
		execFile(
			"git",
			["--no-optional-locks", "status", "--porcelain", "--branch"],
			{ cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
			(err, stdout) => {
				inFlight = false;
				const next: GitState = err ? {} : parsePorcelain(stdout);
				if (JSON.stringify(next) !== JSON.stringify(lastState)) {
					lastState = next;
					onChange(next);
				}
			},
		);
	};

	const timer = setInterval(poll, GIT_DIRTY_POLL_MS);
	poll();
	return () => clearInterval(timer);
}
