/**
 * Real-time tok/s indicator for the pi footer with live gradient.
 *
 * Footer shows two statuses (sorted by key, so they appear left→right):
 *   tokps        live rate of the current streaming response
 *   tokps-stats  session max rate reached and overall average
 *
 * Token count is estimated from streamed characters (chars/4) — the only
 * smooth real-time signal across all providers, since OpenAI-compatible and
 * Anthropic streams only report exact usage at block/stream boundaries.
 *
 * Gradient (real-time, ponytail: linear RGB):
 *   0 tok/s   → rojo   #ff0000
 *   100 tok/s → verde  #00ff00
 *   200 tok/s → azul   #0000ff (capped; >200 stays blue)
 *   0–100 interpolates rojo→verde, 100–200 verde→azul.
 *   Midpoint 50 is olive #808000 / 150 is teal #008080 — vivid yellow/cyan
 *   variant would need a 4-stop scale (red→yellow→green→cyan→blue); add when
 *   dull middle bothers.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CHARS_PER_TOKEN = 4; // 4 chars ≈ 1 token for mixed code/text
const MIN_ELAPSED_MS = 500; // no rate until a real window exists
const THROTTLE_MS = 100; // repaint footer at most 10x/sec
const GRADIENT_BLUE_AT = 200; // tok/s value that reaches pure blue (capped)

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

// ponytail: linear RGB lerp, O(1). Upgrade to HSL / 4-stop (red→yellow→green→cyan→blue) for vivid mids if needed.
export function tokGradientRgb(tps: number): {
	r: number;
	g: number;
	b: number;
} {
	const v = Math.max(0, tps);
	if (v <= 100) {
		const f = v / 100;
		return { r: Math.round(255 * (1 - f)), g: Math.round(255 * f), b: 0 };
	}
	const f = Math.min(1, (v - 100) / (GRADIENT_BLUE_AT - 100));
	return { r: 0, g: Math.round(255 * (1 - f)), b: Math.round(255 * f) };
}

export function tokGradientHex(tps: number): string {
	const { r, g, b } = tokGradientRgb(tps);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function gradientFg(
	theme: { getColorMode?: () => string },
	text: string,
	tps: number,
): string {
	const { r, g, b } = tokGradientRgb(tps);
	const mode: string = theme?.getColorMode?.() ?? "truecolor";
	// ponytail: 256-color fallback is approximate (cube quantize); truecolor path is exact
	if (mode === "256color") {
		const r5 = Math.round((r / 255) * 5);
		const g5 = Math.round((g / 255) * 5);
		const b5 = Math.round((b / 255) * 5);
		const idx = 16 + 36 * r5 + 6 * g5 + b5;
		return `\x1b[38;5;${idx}m${text}\x1b[39m`;
	}
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

export default function (pi: ExtensionAPI) {
	let streaming = false;
	let chars = 0;
	let startTime = 0;
	let lastPaint = 0;
	let cumTokens = 0; // finalized across completed turns
	let cumTimeMs = 0; // streaming time across completed turns
	let maxTokPerSec = 0;

	const paintLive = (ctx: ExtensionContext, tokPerSec: number) => {
		const t = ctx.ui.theme;
		ctx.ui.setStatus(
			"tokps",
			`${t.fg("dim", "tok/s ")}${gradientFg(t, tokPerSec.toFixed(1), tokPerSec)}`,
		);
	};

	const paintStats = (
		ctx: ExtensionContext,
		turnTokens: number,
		turnElapsedMs: number,
	) => {
		const t = ctx.ui.theme;
		const avg = sessionAverage(cumTokens, cumTimeMs, turnTokens, turnElapsedMs);
		ctx.ui.setStatus(
			"tokps-stats",
			`${t.fg("dim", "max ")}${gradientFg(t, maxTokPerSec.toFixed(1), maxTokPerSec)}${t.fg(
				"dim",
				"  avg ",
			)}${gradientFg(t, avg.toFixed(1), avg)}`,
		);
	};

	pi.on("session_start", (_e, ctx) => {
		cumTokens = 0;
		cumTimeMs = 0;
		maxTokPerSec = 0;
		paintLive(ctx, 0);
		paintStats(ctx, 0, 0);
	});

	pi.on("turn_start", () => {
		streaming = true;
		chars = 0;
		startTime = performance.now();
		lastPaint = 0;
	});

	pi.on("message_update", (event, ctx) => {
		if (!streaming) return;
		const ev = event.assistantMessageEvent;
		if (
			ev.type === "text_delta" ||
			ev.type === "thinking_delta" ||
			ev.type === "toolcall_delta"
		) {
			chars += ev.delta.length;
			const now = performance.now();
			if (now - startTime < MIN_ELAPSED_MS || now - lastPaint < THROTTLE_MS)
				return;
			lastPaint = now;
			const elapsed = now - startTime;
			const tokPerSec = estimateTokPerSec(chars, elapsed);
			if (tokPerSec > maxTokPerSec) maxTokPerSec = tokPerSec;
			paintLive(ctx, tokPerSec);
			paintStats(ctx, tokensFromChars(chars), elapsed);
		}
	});

	pi.on("turn_end", (_e, ctx) => {
		streaming = false;
		// Finalize this turn into the session totals, then show idle values.
		cumTokens += tokensFromChars(chars);
		cumTimeMs += performance.now() - startTime;
		paintLive(ctx, 0); // persistent: show idle 0 (rojo) instead of clearing
		paintStats(ctx, 0, 0);
	});
}
