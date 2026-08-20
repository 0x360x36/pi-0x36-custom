/**
 * /panel — monitor en vivo de la sesión, en la vista del chat.
 *
 * Tres paneles:
 *   1. Izquierda — log de eventos en tiempo real: preguntas del usuario,
 *      respuestas del modelo (streaming y finalización), uso de herramientas
 *      (inicio/resultado), cambios de modelo/thinking, compactación…
 *   2. Centro — gráfico de tok/s vs tiempo (muestras de ventana deslizante,
 *      barras de bloque con gradiente), con live/avg/max.
 *   3. Derecha — dashboard de sesión: modelo, thinking, uso de contexto con
 *      barra de progreso, totales reales de tokens/cache/coste (usage del
 *      provider), turnos, herramientas más usadas y actividad actual.
 *
 * Los eventos se registran a nivel de factory: fluyen mientras el panel está
 * abierto y mientras el agente corre (los comandos se ejecutan incluso
 * durante streaming, así que puedes abrirlo a mitad de una respuesta larga).
 * Render throttled a ~10 fps (touch()/RENDER_INTERVAL). Cierra con Q o Esc.
 *
 * Sin import runtime de @earendil-works/pi-tui: reusa helpers de
 * tok-per-second.ts (mismo convenio del repo, los tests no resuelven pi-tui).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	formatTokens,
	sessionAverage,
	tokensFromChars,
	tokGradientRgb,
	truncateToWidth,
	visibleWidth,
} from "./tok-per-second.ts";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4; // mismo estimador que tok-per-second
export const SAMPLE_MS = 500; // ventana de muestreo del gráfico
export const MAX_SAMPLES = 240; // 120 s de historia a SAMPLE_MS
const MAX_LOG = 300;
const RENDER_INTERVAL_MS = 100; // ~10 fps
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

// ---------------------------------------------------------------------------
// Funciones puras (testeables sin TUI)
// ---------------------------------------------------------------------------

/** tok/s instantáneo de una ventana: chars/4 entre dos muestras. */
export function computeTps(deltaChars: number, deltaMs: number): number {
	if (deltaMs <= 0) return 0;
	return deltaChars / CHARS_PER_TOKEN / (deltaMs / 1000);
}

/** Añade un elemento a un buffer circular (desplaza el más viejo si se llena). */
export function pushSample<T>(buffer: T[], max: number, item: T): T[] {
	const next = buffer.length >= max ? buffer.slice(1) : buffer.slice();
	next.push(item);
	return next;
}

function ansiFg(r: number, g: number, b: number, s: string): string {
	return `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}

/**
 * Render del gráfico de barras de bloque. Devuelve exactamente `height` líneas,
 * cada una ≤ `width`. Máx auto-escalado; gutter con la etiqueta del máximo
 * arriba y "0" en el eje; cada columna coloreada con el gradiente tokps.
 */
export function chartLines(
	samples: number[],
	width: number,
	height: number,
): string[] {
	if (samples.length === 0)
		return Array.from({ length: Math.max(height, 0) }, () => "");

	const blockRows = Math.max(2, Math.min(height - 1, 8));
	const maxTps = Math.max(1, ...samples);
	const maxLabel = String(Math.round(maxTps));

	// ancho mínimo: sin gutter, una sola fila de barras
	if (width < 6) {
		const row = samples
			.slice(-width)
			.map(
				(v) => BLOCKS[Math.min(7, Math.max(0, Math.round((v / maxTps) * 8) - 1))],
			)
			.join("");
		return [row, ...Array.from({ length: Math.max(height - 1, 0) }, () => "")];
	}

	const gutter = Math.max(3, maxLabel.length);
	const plotW = Math.max(1, width - gutter - 1);
	const shown = samples.slice(Math.max(0, samples.length - plotW));
	const levels = shown.map((v) =>
		Math.min(8, Math.max(0, Math.round((v / maxTps) * 8))),
	);

	const lines: string[] = [];
	for (let r = 0; r < blockRows; r++) {
		const threshold = blockRows - r; // fila 0 (arriba) = nivel más alto
		const label = r === 0 ? maxLabel.padStart(gutter) : " ".repeat(gutter);
		const cols = shown
			.map((v, i) => {
				const l = levels[i]!;
				if (l < threshold) return " ";
				const { r: cr, g, b } = tokGradientRgb(v);
				return ansiFg(cr, g, b, BLOCKS[Math.max(0, l - 1)]!);
			})
			.join("");
		lines.push(label + "│" + cols);
	}
	lines.push("0".padStart(gutter) + "│" + "─".repeat(plotW));

	while (lines.length < height) lines.push("");
	return lines;
}

/** Barra de progreso de ancho fijo, con clamp a [0,100]. */
export function contextBar(percent: number, width: number): string {
	const p = Math.max(0, Math.min(100, percent));
	const filled = Math.round((p / 100) * width);
	return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Resumen de argumentos de herramienta para el log: el campo principal o JSON truncado. */
export function summarizeToolArgs(name: string, args: unknown): string {
	if (args == null) return "";
	const a = args as Record<string, unknown>;
	for (const k of ["command", "path", "pattern", "query", "url"]) {
		if (typeof a[k] === "string") return a[k] as string;
	}
	void name;
	const s = JSON.stringify(args);
	if (!s) return "";
	return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

// ---------------------------------------------------------------------------
// Store compartido: los handlers de eventos escriben, el componente lee.
// ---------------------------------------------------------------------------

type Tag = "user" | "model" | "tool" | "sys";

interface LogEntry {
	t: number;
	tag: Tag;
	text: string;
	ok?: boolean;
	live?: boolean;
	toolCallId?: string;
}

interface Store {
	events: LogEntry[];
	samples: { t: number; tps: number }[];
	streaming: boolean;
	activity: string;
	turnChars: number;
	turnStart: number;
	lastSampleChars: number;
	lastSampleAt: number;
	cumTokens: number;
	cumTimeMs: number;
	turns: number;
	stats: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		tools: Map<string, number>;
	};
	context: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	} | null;
	modelInfo: string;
	thinking: string;
	sessionName: string;
	// render-throttle
	attached: { requestRender: () => void } | null;
	lastRenderAt: number;
	pending: ReturnType<typeof setTimeout> | null;
}

function createStore(): Store {
	return {
		events: [],
		samples: [],
		streaming: false,
		activity: "idle",
		turnChars: 0,
		turnStart: 0,
		lastSampleChars: 0,
		lastSampleAt: 0,
		cumTokens: 0,
		cumTimeMs: 0,
		turns: 0,
		stats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			tools: new Map(),
		},
		context: null,
		modelInfo: "",
		thinking: "",
		sessionName: "",
		attached: null,
		lastRenderAt: 0,
		pending: null,
	};
}

function resetStore(s: Store): void {
	s.events.length = 0;
	s.samples.length = 0;
	s.streaming = false;
	s.activity = "idle";
	s.turnChars = 0;
	s.turnStart = 0;
	s.lastSampleChars = 0;
	s.lastSampleAt = 0;
	s.cumTokens = 0;
	s.cumTimeMs = 0;
	s.turns = 0;
	s.stats.input = 0;
	s.stats.output = 0;
	s.stats.cacheRead = 0;
	s.stats.cacheWrite = 0;
	s.stats.cost = 0;
	s.stats.tools.clear();
	s.context = null;
}

function pushEvent(
	s: Store,
	tag: Tag,
	text: string,
	extra?: Partial<LogEntry>,
): LogEntry {
	const e: LogEntry = { t: Date.now(), tag, text, ...extra };
	s.events.push(e);
	if (s.events.length > MAX_LOG) s.events.shift();
	touch(s);
	return e;
}

/** Render throttled: a lo sumo uno cada RENDER_INTERVAL_MS, con trailing edge. */
function touch(s: Store): void {
	if (!s.attached) return;
	if (s.pending) return;
	const now = Date.now();
	const wait = s.lastRenderAt + RENDER_INTERVAL_MS - now;
	const fire = () => {
		s.pending = null;
		s.lastRenderAt = Date.now();
		try {
			s.attached?.requestRender();
		} catch {
			/* componente ya desmontado */
		}
	};
	if (wait <= 0) fire();
	else s.pending = setTimeout(fire, wait);
}

function sampleWindow(s: Store): void {
	const now = Date.now();
	if (!s.lastSampleAt) {
		s.lastSampleAt = now;
		s.lastSampleChars = s.turnChars;
		return;
	}
	if (now - s.lastSampleAt < SAMPLE_MS) return;
	s.samples = pushSample(s.samples, MAX_SAMPLES, {
		t: now,
		tps: computeTps(s.turnChars - s.lastSampleChars, now - s.lastSampleAt),
	});
	s.lastSampleChars = s.turnChars;
	s.lastSampleAt = now;
}

function liveTps(s: Store): number {
	if (!s.streaming || !s.lastSampleAt) return 0;
	return computeTps(
		s.turnChars - s.lastSampleChars,
		Date.now() - s.lastSampleAt,
	);
}

function avgTps(s: Store): number {
	return sessionAverage(s.cumTokens, s.cumTimeMs, 0, 0);
}

function maxTps(s: Store): number {
	return Math.max(0, ...s.samples.map((x) => x.tps));
}

// ---------------------------------------------------------------------------
// Componente TUI
// ---------------------------------------------------------------------------

interface ThemeLike {
	fg: (color: string, s: string) => string;
	bold: (s: string) => string;
}
interface TuiLike {
	requestRender: () => void;
	terminal?: { rows?: number; columns?: number };
}

const TAG_COLOR: Record<Tag, string> = {
	user: "accent",
	model: "success",
	tool: "warning",
	sys: "dim",
};

class PanelComponent {
	private tui: TuiLike;
	private theme: ThemeLike;
	private store: Store;
	private onClose: () => void;
	private cachedWidth = -1;
	private cachedLines: string[] = [];

	constructor(
		tui: TuiLike,
		theme: ThemeLike,
		store: Store,
		onClose: () => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.store = store;
		this.onClose = onClose;
	}

	invalidate(): void {
		this.cachedWidth = -1;
	}

	handleInput(data: string): void {
		// esc, q o ctrl+c cierran el panel; el resto se ignora
		if (data === "\x1b" || data === "q" || data === "Q" || data === "\x03") {
			this.onClose();
		}
	}

	render(width: number): string[] {
		const rows = this.tui.terminal?.rows ?? 24;
		if (width === this.cachedWidth && this.cachedLines.length === rows) {
			return this.cachedLines;
		}
		this.cachedWidth = width;
		const { theme } = this;
		const s = this.store;
		const lines: string[] = [];

		// header
		const live = s.streaming
			? theme.fg("success", theme.bold("●"))
			: theme.fg("dim", "○");
		const title = `${live} ${theme.bold("panel")} ${theme.fg(
			"dim",
			"· monitor de sesión",
		)}`;
		const hint = theme.fg("dim", "esc/q cerrar — el agente sigue trabajando");
		lines.push(
			padTo(
				truncateToWidth(
					title +
						" ".repeat(
							Math.max(1, width - visibleWidth(title) - visibleWidth(hint)),
						) +
						hint,
					width,
					"…",
				),
				width,
			),
		);

		const bodyH = Math.max(6, rows - 2);

		// partición de anchos
		if (width < 60) {
			// terminal muy estrecho: solo el log
			lines.push(...this.renderLog(width, bodyH));
			while (lines.length < rows) lines.push("");
			this.cachedLines = lines;
			return lines;
		}
		const inner = width - 2; // 2 separadores verticales
		const lw = Math.round(inner * 0.4);
		const cw = Math.round(inner * 0.33);
		const rw = inner - lw - cw;

		const left = this.renderLog(lw, bodyH);
		const center = this.renderChart(cw, bodyH);
		const right = this.renderSession(rw, bodyH);

		for (let i = 0; i < bodyH; i++) {
			const sep = theme.fg("borderMuted", "│");
			lines.push(
				padTo(left[i] ?? "", lw) +
					sep +
					padTo(center[i] ?? "", cw) +
					sep +
					padTo(right[i] ?? "", rw),
			);
		}

		while (lines.length < rows) lines.push("");
		this.cachedLines = lines;
		return lines;
	}

	// --- panel izquierdo: log de eventos ---
	private renderLog(w: number, bodyH: number): string[] {
		const { theme } = this;
		const s = this.store;
		const title = theme.fg("muted", theme.bold("EVENTOS"));
		const lines = [padTo(truncateToWidth(title, w, "…"), w)];
		const avail = Math.max(1, bodyH - 1);
		const evs = s.events;
		const truncated = evs.length > avail;
		const shown = evs.slice(
			Math.max(0, evs.length - (truncated ? avail - 1 : avail)),
		);
		if (evs.length > shown.length) {
			lines.push(
				padTo(
					theme.fg("dim", `⋯ ${evs.length - shown.length} eventos anteriores`),
					w,
				),
			);
		}
		for (const e of shown) {
			let body: string;
			if (e.tag === "tool") {
				const mark = e.ok === false ? "✗" : e.ok === true ? "✓" : "•";
				const color =
					e.ok === false ? "error" : e.ok === true ? "success" : "warning";
				body = theme.fg(color, `${mark} ${e.text}`);
			} else if (e.tag === "model") {
				body = e.live
					? theme.fg("success", `… ${e.text}`)
					: theme.fg("success", `${e.text}`);
			} else {
				body = theme.fg(TAG_COLOR[e.tag], e.text);
			}
			const stamp = theme.fg(
				"dim",
				new Date(e.t).toLocaleTimeString("en-GB", { hour12: false }),
			);
			lines.push(padTo(truncateToWidth(`${stamp} ${body}`, w, "…"), w));
		}
		while (lines.length < bodyH) lines.push("");
		return lines;
	}

	// --- panel central: gráfico tok/s ---
	private renderChart(w: number, bodyH: number): string[] {
		const { theme } = this;
		const s = this.store;
		const lines: string[] = [];
		lines.push(
			padTo(
				truncateToWidth(theme.fg("muted", theme.bold("TOK/S · TIEMPO")), w, "…"),
				w,
			),
		);

		const tps = s.samples.map((x) => x.tps);
		const live = liveTps(s);
		const avg = avgTps(s);
		const max = maxTps(s);
		const n = (v: number) =>
			s.streaming && v === live ? v.toFixed(1) : v.toFixed(0);
		const current = s.streaming
			? `${theme.fg("dim", "live ")}${tpsColored(live)}`
			: theme.fg("dim", "live —");
		lines.push(
			padTo(
				truncateToWidth(
					`${current}${theme.fg("dim", "  avg ")}${tpsColored(avg)}${theme.fg("dim", "  max ")}${tpsColored(max)}`,
					w,
					"…",
				),
				w,
			),
		);

		const blockHeight = Math.max(3, bodyH - 3);
		for (const l of chartLines(tps, w, blockHeight)) {
			lines.push(padTo(l, w));
		}
		if (lines.length < bodyH) {
			lines.push(
				padTo(theme.fg("dim", `muestras ${s.samples.length} · ${SAMPLE_MS} ms`), w),
			);
		}
		while (lines.length < bodyH) lines.push("");
		return lines;

		function tpsColored(v: number): string {
			const { r, g, b } = tokGradientRgb(v);
			return ansiFg(r, g, b, n(v));
		}
	}

	// --- panel derecho: dashboard de sesión ---
	private renderSession(w: number, bodyH: number): string[] {
		const { theme } = this;
		const s = this.store;
		const lines: string[] = [];
		lines.push(
			padTo(truncateToWidth(theme.fg("muted", theme.bold("SESIÓN")), w, "…"), w),
		);

		const kv = (label: string, value: string, pad = 8) => {
			const l = theme.fg("dim", label.padEnd(pad));
			return padTo(truncateToWidth(l + value, w, "…"), w);
		};

		lines.push(kv("modelo", s.modelInfo || "—"));
		lines.push(kv("thinking", s.thinking || "—"));

		const c = s.context;
		if (c && c.contextWindow > 0) {
			const pct = c.percent ?? 0;
			const barW = Math.max(4, Math.min(16, w - 10));
			lines.push(kv("contexto", `${pct.toFixed(1)}%`, 7));
			lines.push(" ".repeat(7) + theme.fg("dim", contextBar(pct, barW)));
		} else {
			lines.push(kv("contexto", "—"));
		}

		const st = s.stats;
		lines.push(
			kv(
				"tokens",
				`↑${formatTokens(st.input)} ↓${formatTokens(st.output)} R${formatTokens(st.cacheRead)} W${formatTokens(st.cacheWrite)}`,
				6,
			),
		);
		lines.push(kv("coste", `$${st.cost.toFixed(4)}`));
		lines.push(kv("turnos", String(s.turns)));

		const top = [...st.tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
		lines.push(
			kv(
				"herramientas",
				top.length ? top.map(([n, c2]) => `${n}×${c2}`).join(" ") : "—",
				10,
			),
		);

		const act =
			s.activity === "streaming"
				? `streaming · ${liveTps(s).toFixed(1)} tok/s`
				: s.activity;
		lines.push(kv("actividad", act, 8));

		lines.push(kv("sesión", s.sessionName || "—"));

		while (lines.length < bodyH) lines.push("");
		return lines;
	}
}

function padTo(s: string, w: number): string {
	return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}

// ---------------------------------------------------------------------------
// Extensión
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const store = createStore();

	pi.on("session_start", (_ev, ctx) => {
		resetStore(store);
		store.sessionName = ctx.sessionManager.getSessionName() ?? "";
	});

	pi.on("session_compact", () => {
		pushEvent(store, "sys", "compactación de contexto");
	});

	pi.on("input", (ev) => {
		if (ev.source === "extension") return; // mensajes auto-encolados, no del usuario
		pushEvent(store, "user", truncateToWidth(ev.text, 240));
	});

	pi.on("model_select", (ev) => {
		store.modelInfo = ev.model.id;
		pushEvent(store, "sys", `modelo → ${ev.model.id}`);
	});

	pi.on("thinking_level_select", (ev) => {
		store.thinking = ev.level;
		pushEvent(store, "sys", `thinking → ${ev.level}`);
	});

	pi.on("agent_start", () => pushEvent(store, "sys", "agente en marcha"));
	pi.on("agent_end", () => pushEvent(store, "sys", "agente finalizado"));
	pi.on("agent_settled", () => {
		store.activity = "idle";
		touch(store);
	});

	pi.on("turn_start", () => {
		store.turns++;
		store.streaming = true;
		store.activity = "streaming";
		store.turnChars = 0;
		store.turnStart = Date.now();
		store.lastSampleChars = 0;
		store.lastSampleAt = 0;
		pushEvent(store, "sys", `turno ${store.turns}`);
	});

	pi.on("message_update", (event) => {
		const a = (
			event as { assistantMessageEvent?: { type: string; delta?: string } }
		).assistantMessageEvent;
		if (!a) return;
		if (
			a.type !== "text_delta" &&
			a.type !== "thinking_delta" &&
			a.type !== "toolcall_delta"
		)
			return;
		store.turnChars += a.delta?.length ?? 0;
		sampleWindow(store);
		let e = store.events.find((x) => x.live && x.tag === "model");
		if (!e) e = pushEvent(store, "model", "", { live: true });
		e.text = `streaming · ${tokensFromChars(store.turnChars).toFixed(0)} tok`;
		touch(store);
	});

	pi.on("message_end", (event, ctx) => {
		const m = (
			event as {
				message?: {
					role?: string;
					usage?: {
						input?: number;
						output?: number;
						cacheRead?: number;
						cacheWrite?: number;
						cost?: { total?: number } | number;
					};
					content?: Array<{ type?: string }>;
				};
			}
		).message;
		if (!m) return;

		const u = m.usage;
		if (u) {
			store.stats.input += u.input ?? 0;
			store.stats.output += u.output ?? 0;
			store.stats.cacheRead += u.cacheRead ?? 0;
			store.stats.cacheWrite += u.cacheWrite ?? 0;
			store.stats.cost +=
				typeof u.cost === "number" ? u.cost : (u.cost?.total ?? 0);
		}

		if (m.role === "assistant") {
			const e = store.events.find((x) => x.live && x.tag === "model");
			if (e) {
				const secs = ((Date.now() - store.turnStart) / 1000).toFixed(1);
				const hasTools = m.content?.some((c) => c.type === "toolCall");
				e.text = hasTools
					? `respuesta → ${m.content?.length ?? 0} tool calls`
					: `respuesta · ${tokensFromChars(store.turnChars).toFixed(0)} tok (${secs}s)`;
				e.live = false;
			}
		}
		store.context = ctx.getContextUsage?.() ?? null;
		touch(store);
	});

	pi.on("tool_execution_start", (ev) => {
		const tag = ev.toolName;
		store.activity = `herramienta ${tag}`;
		store.stats.tools.set(tag, (store.stats.tools.get(tag) ?? 0) + 1);
		pushEvent(store, "tool", `${tag}: ${summarizeToolArgs(tag, ev.args)}`, {
			toolCallId: ev.toolCallId,
			live: true,
		});
	});

	pi.on("tool_execution_end", (ev) => {
		const e = store.events.find((x) => x.toolCallId === ev.toolCallId);
		const secs = ((Date.now() - (e?.t ?? Date.now())) / 1000).toFixed(1);
		if (e) {
			e.text = `${ev.toolName} (${secs}s)`;
			e.ok = !ev.isError;
			e.live = false;
		} else {
			pushEvent(store, "tool", `${ev.toolName} (${secs}s)`, { ok: !ev.isError });
		}
		store.activity = "idle";
		touch(store);
	});

	pi.on("turn_end", () => {
		if (store.streaming) {
			const now = Date.now();
			if (store.lastSampleAt && store.turnChars > store.lastSampleChars) {
				store.samples = pushSample(store.samples, MAX_SAMPLES, {
					t: now,
					tps: computeTps(
						store.turnChars - store.lastSampleChars,
						now - store.lastSampleAt,
					),
				});
			}
			store.cumTokens += tokensFromChars(store.turnChars);
			store.cumTimeMs += now - store.turnStart;
		}
		store.streaming = false;
		store.activity = "idle";
		touch(store);
	});

	pi.registerCommand("panel", {
		description:
			"Abrir el monitor en vivo de la sesión (eventos, tok/s, estadísticas)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("/panel solo está disponible en modo TUI", "warning");
				return;
			}
			store.modelInfo = store.modelInfo || ctx.model?.id || "—";
			store.thinking = store.thinking || ctx.thinkingLevel || "off";
			store.sessionName = ctx.sessionManager.getSessionName() ?? store.sessionName;

			try {
				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					const component = new PanelComponent(tui, theme, store, () => done());
					store.attached = { requestRender: () => tui.requestRender() };
					return component;
				});
			} finally {
				store.attached = null;
				if (store.pending) {
					clearTimeout(store.pending);
					store.pending = null;
				}
			}
		},
	});
}
