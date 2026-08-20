/**
 * Real-time tok/s indicator for the pi footer, ubicado bajo el modelo.
 *
 * Antes usaba ctx.ui.setStatus("tokps"/"tokps-stats") que renderiza como
 * tercera línea izquierda, ordenada alfabéticamente. Ahora usa
 * ctx.ui.setFooter() para replicar el footer nativo (pwd + stats + modelo)
 * y añadir una tercera línea alineada a la derecha, justo bajo el nombre
 * del modelo seleccionado — tok/s live, max y avg con gradiente.
 *
 * Estimación chars/4 y gradiente:
 *   0 tok/s   → rojo   #ff0000
 *  50 tok/s   → verde  #00ff00
 * 100 tok/s   → cyan   #00ffff (capped; >100 stays cyan)
 * 0–50 rojo→verde, 50–100 verde→cyan (ponytail: linear RGB lerp O(1))
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve, sep } from "node:path";

// ponytail: helpers inline para no depender de pi-tui en tests (strip ANSI + truncate simple, O(n))
export function stripAnsi(s: string): string {
	return s
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\]8;;.*?\x1b\\/g, "")
		.replace(/\x1b\\/g, "");
}
export function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}
export function truncateToWidth(
	s: string,
	maxWidth: number,
	ellipsis = "...",
): string {
	if (visibleWidth(s) <= maxWidth) return s;
	const raw = stripAnsi(s);
	if (raw.length <= maxWidth) return s;
	// fallback simple: corta visible y añade ellipsis (preserva ANSI del ellipsis)
	const keep = Math.max(0, maxWidth - stripAnsi(ellipsis).length);
	return `${raw.slice(0, keep)}${ellipsis}`;
}

const CHARS_PER_TOKEN = 4;
const MIN_ELAPSED_MS = 500;
const THROTTLE_MS = 100;
const GRADIENT_GREEN_AT = 50;
const GRADIENT_CYAN_AT = 100;

export function estimateTokPerSec(chars: number, elapsedMs: number): number {
	if (elapsedMs <= 0) return 0;
	return chars / CHARS_PER_TOKEN / (elapsedMs / 1000);
}

export function sessionAverage(
	cumTokens: number,
	cumTimeMs: number,
	turnTokens: number,
	turnElapsedMs: number,
): number {
	const ms = cumTimeMs + turnElapsedMs;
	if (ms <= 0) return 0;
	return (cumTokens + turnTokens) / (ms / 1000);
}

export function tokensFromChars(chars: number): number {
	return chars / CHARS_PER_TOKEN;
}

// ponytail: linear RGB lerp, O(1). Escala 0→50 rojo→verde, 50→100 verde→cyan.
export function tokGradientRgb(tps: number): {
	r: number;
	g: number;
	b: number;
} {
	const v = Math.max(0, tps);
	if (v <= GRADIENT_GREEN_AT) {
		const f = v / GRADIENT_GREEN_AT;
		return { r: Math.round(255 * (1 - f)), g: Math.round(255 * f), b: 0 };
	}
	const f = Math.min(
		1,
		(v - GRADIENT_GREEN_AT) / (GRADIENT_CYAN_AT - GRADIENT_GREEN_AT),
	);
	return { r: 0, g: 255, b: Math.round(255 * f) };
}

export function tokGradientHex(tps: number): string {
	const { r, g, b } = tokGradientRgb(tps);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function gradientFg(text: string, tps: number): string {
	const { r, g, b } = tokGradientRgb(tps);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

// helpers copiados de pi FooterComponent para no drift visual
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." &&
			!relativeToHome.startsWith(`..${sep}`) &&
			!isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

export default function (pi: ExtensionAPI) {
	let streaming = false;
	let chars = 0;
	let startTime = 0;
	let lastPaint = 0;
	let cumTokens = 0;
	let cumTimeMs = 0;
	let maxTokPerSec = 0;

	// refs vivas para el footer custom — se setean en session_start
	let liveCtx: ExtensionContext | null = null;
	let tuiRef: { requestRender: () => void } | null = null;

	const requestRender = () => tuiRef?.requestRender();

	// instala footer que replica el nativo y añade línea tok/s bajo el modelo (derecha)
	const installFooter = (ctx: ExtensionContext) => {
		liveCtx = ctx;
		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui as unknown as { requestRender: () => void };
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: () => {
					unsub();
					if (tuiRef === (tui as unknown as { requestRender: () => void }))
						tuiRef = null;
				},
				invalidate() {},
				render(width: number): string[] {
					if (!liveCtx) return [theme.fg("dim", "~")];

					// --- línea 1: pwd (+branch +sessionName) ---
					const home = process.env.HOME || process.env.USERPROFILE;
					let pwd = formatCwdForFooter(liveCtx!.cwd, home);
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = liveCtx!.sessionManager.getSessionName();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;
					const pwdLine = truncateToWidth(
						theme.fg("dim", pwd),
						width,
						theme.fg("dim", "..."),
					);

					// --- línea 2: stats izquierda + modelo derecha (copia de FooterComponent) ---
					const usageTotals = {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0,
					};
					let latestCacheHitRate: number | undefined;
					for (const entry of liveCtx!.sessionManager.getEntries() as Array<{
						type: string;
						message?: {
							role: string;
							usage?: {
								input: number;
								output: number;
								cacheRead: number;
								cacheWrite: number;
								cost?: { total: number };
							};
						};
						usage?: {
							input?: number;
							output?: number;
							cacheRead?: number;
							cacheWrite?: number;
							cost?: number | { total: number };
						};
					}>) {
						if (
							entry.type === "message" &&
							entry.message?.role === "assistant" &&
							entry.message.usage
						) {
							usageTotals.input += entry.message.usage.input ?? 0;
							usageTotals.output += entry.message.usage.output ?? 0;
							usageTotals.cacheRead += entry.message.usage.cacheRead ?? 0;
							usageTotals.cacheWrite += entry.message.usage.cacheWrite ?? 0;
							usageTotals.cost +=
								(entry.message.usage.cost as { total: number } | undefined)?.total ?? 0;
							const latestPromptTokens =
								(entry.message.usage.input ?? 0) +
								(entry.message.usage.cacheRead ?? 0) +
								(entry.message.usage.cacheWrite ?? 0);
							latestCacheHitRate =
								latestPromptTokens > 0
									? ((entry.message.usage.cacheRead ?? 0) / latestPromptTokens) * 100
									: undefined;
						} else if (
							entry.type === "message" &&
							entry.message?.role === "toolResult" &&
							(entry.message as { usage?: unknown }).usage
						) {
							const u = (
								entry.message as {
									usage: {
										input?: number;
										output?: number;
										cacheRead?: number;
										cacheWrite?: number;
										cost?: { total: number };
									};
								}
							).usage;
							usageTotals.input += u.input ?? 0;
							usageTotals.output += u.output ?? 0;
							usageTotals.cacheRead += u.cacheRead ?? 0;
							usageTotals.cacheWrite += u.cacheWrite ?? 0;
							usageTotals.cost +=
								(u.cost as { total: number } | undefined)?.total ?? 0;
						} else if (
							(entry.type === "branch_summary" || entry.type === "compaction") &&
							entry.usage
						) {
							const u = entry.usage as {
								input?: number;
								output?: number;
								cacheRead?: number;
								cacheWrite?: number;
								cost?: number | { total: number };
							};
							usageTotals.input += u.input ?? 0;
							usageTotals.output += u.output ?? 0;
							usageTotals.cacheRead += u.cacheRead ?? 0;
							usageTotals.cacheWrite += u.cacheWrite ?? 0;
							const c = u.cost;
							usageTotals.cost +=
								typeof c === "number"
									? c
									: ((c as { total: number } | undefined)?.total ?? 0);
						}
					}

					const ctxAny = liveCtx as unknown as {
						getContextUsage?: () =>
							| {
									tokens: number | null;
									contextWindow: number;
									percent: number | null;
							  }
							| undefined;
						model?: {
							id: string;
							provider: string;
							reasoning?: boolean;
							contextWindow?: number;
						};
						thinkingLevel?: string;
						sessionManager: { getCwd: () => string };
					};
					const contextUsage = ctxAny.getContextUsage?.();
					const contextWindow =
						contextUsage?.contextWindow ?? ctxAny.model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent =
						contextUsage?.percent == null ? "?" : contextPercentValue.toFixed(1);

					const statsParts: string[] = [];
					if (usageTotals.input)
						statsParts.push(`↑${formatTokens(usageTotals.input)}`);
					if (usageTotals.output)
						statsParts.push(`↓${formatTokens(usageTotals.output)}`);
					if (usageTotals.cacheRead)
						statsParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
					if (usageTotals.cacheWrite)
						statsParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
					if (
						(usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) &&
						latestCacheHitRate !== undefined
					) {
						statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}
					if (usageTotals.cost) statsParts.push(`$${usageTotals.cost.toFixed(3)}`);
					const ctxPctDisplay =
						contextPercent === "?"
							? `?/${formatTokens(contextWindow)}`
							: `${contextPercent}%/${formatTokens(contextWindow)}`;
					let ctxStr: string;
					if (contextPercentValue > 90) ctxStr = theme.fg("error", ctxPctDisplay);
					else if (contextPercentValue > 70)
						ctxStr = theme.fg("warning", ctxPctDisplay);
					else ctxStr = ctxPctDisplay;
					statsParts.push(ctxStr);

					let statsLeft = statsParts.join(" ");
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					const modelName = ctxAny.model?.id || "no-model";
					const minPadding = 2;
					let rightSideWithoutProvider = modelName;
					if (ctxAny.model?.reasoning) {
						const lvl = ctxAny.thinkingLevel || "off";
						rightSideWithoutProvider =
							lvl === "off" ? `${modelName} • thinking off` : `${modelName} • ${lvl}`;
					}
					let rightSide = rightSideWithoutProvider;
					if (footerData.getAvailableProviderCount() > 1 && ctxAny.model) {
						const withProv = `(${ctxAny.model.provider}) ${rightSideWithoutProvider}`;
						if (statsLeftWidth + minPadding + visibleWidth(withProv) <= width)
							rightSide = withProv;
					}
					const rightSideWidth = visibleWidth(rightSide);
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
						statsLine = statsLeft + padding + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
							const pad = " ".repeat(
								Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)),
							);
							statsLine = statsLeft + pad + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}
					const dimStatsLeft = theme.fg("dim", statsLeft);
					const remainder = statsLine.slice(statsLeft.length);
					const dimRemainder = theme.fg("dim", remainder);
					const statsLineColored = dimStatsLeft + dimRemainder;

					// --- línea 3: tok/s bajo el modelo, alineado a la derecha ---
					let live = 0;
					if (streaming) {
						const elapsed = performance.now() - startTime;
						if (elapsed >= MIN_ELAPSED_MS) live = estimateTokPerSec(chars, elapsed);
					}
					const avg = sessionAverage(
						cumTokens,
						cumTimeMs,
						streaming ? tokensFromChars(chars) : 0,
						streaming ? performance.now() - startTime : 0,
					);
					const tokLine =
						`${theme.fg("dim", "tok/s ")}${gradientFg(live.toFixed(1), live)}` +
						`${theme.fg("dim", "  max ")}${gradientFg(maxTokPerSec.toFixed(1), maxTokPerSec)}` +
						`${theme.fg("dim", "  avg ")}${gradientFg(avg.toFixed(1), avg)}`;
					const tokLineWidth = visibleWidth(tokLine);
					const tokPad = " ".repeat(Math.max(0, width - tokLineWidth));
					const tokLineRight = truncateToWidth(
						tokPad + tokLine,
						width,
						theme.fg("dim", "..."),
					);

					return [pwdLine, statsLineColored, tokLineRight];
				},
			};
		});
	};

	pi.on("session_start", (_e, ctx) => {
		cumTokens = 0;
		cumTimeMs = 0;
		maxTokPerSec = 0;
		streaming = false;
		chars = 0;
		startTime = 0;
		lastPaint = 0;
		installFooter(ctx);
		requestRender();
	});

	pi.on("turn_start", () => {
		streaming = true;
		chars = 0;
		startTime = performance.now();
		lastPaint = 0;
		requestRender();
	});

	pi.on("message_update", (event) => {
		if (!streaming) return;
		const ev = (
			event as { assistantMessageEvent: { type: string; delta: string } }
		).assistantMessageEvent;
		if (
			ev.type !== "text_delta" &&
			ev.type !== "thinking_delta" &&
			ev.type !== "toolcall_delta"
		)
			return;
		chars += ev.delta.length;
		const now = performance.now();
		if (now - startTime < MIN_ELAPSED_MS || now - lastPaint < THROTTLE_MS) return;
		lastPaint = now;
		const tokPerSec = estimateTokPerSec(chars, now - startTime);
		if (tokPerSec > maxTokPerSec) maxTokPerSec = tokPerSec;
		requestRender();
	});

	pi.on("turn_end", () => {
		streaming = false;
		cumTokens += tokensFromChars(chars);
		cumTimeMs += performance.now() - startTime;
		requestRender();
	});

	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
}
