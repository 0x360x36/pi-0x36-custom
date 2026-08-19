/**
 * Real-time tok/s indicator for the pi footer.
 *
 * Footer shows two statuses (sorted by key, so they appear left→right):
 *   tokps        live rate of the current streaming response
 *   tokps-stats  session max rate reached and overall average
 *
 * Token count is estimated from streamed characters (chars/4) — the only
 * smooth real-time signal across all providers, since OpenAI-compatible and
 * Anthropic streams only report exact usage at block/stream boundaries.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CHARS_PER_TOKEN = 4; // 4 chars ≈ 1 token for mixed code/text
const MIN_ELAPSED_MS = 500; // no rate until a real window exists
const THROTTLE_MS = 100; // repaint footer at most 10x/sec

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
			`${t.fg("dim", "tok/s ")}${t.fg("success", tokPerSec.toFixed(1))}`,
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
			`${t.fg("dim", "max ")}${t.fg("accent", maxTokPerSec.toFixed(1))}${t.fg(
				"dim",
				"  avg ",
			)}${t.fg("accent", avg.toFixed(1))}`,
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
		paintLive(ctx, 0); // persistent: show idle 0 instead of clearing
		paintStats(ctx, 0, 0);
	});
}
