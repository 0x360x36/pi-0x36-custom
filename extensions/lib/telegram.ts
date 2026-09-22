/**
 * Helpers de notificaciones Telegram — sin dependencias de pi/TUI, testeables
 * con `node test/telegram.test.ts`.
 */

import { readFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_MAX_CHARS = 4096;
export const BODY_MAX_CHARS = 3500; // margen bajo el límite de Telegram para cabecera + "…"
export const FETCH_TIMEOUT_MS = 10_000;
export const CONFIG_FILENAME = "telegram-notify.json";
export const ENV_FILENAME = ".env";

export type AgentOutcome = "completed" | "aborted" | "error";

export interface TelegramConfig {
	token?: string;
	chatId?: string;
	enabled: boolean;
}

type FetchLike = typeof fetch;

export function maskToken(token: string): string {
	if (!token) return "";
	return token.length <= 10 ? "***" : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

// ponytail: solo partes de texto; thinking/toolCall se ignoran.
export function assistantText(message: { content?: unknown }): string {
	const content = message?.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(p): p is { type: string; text: string } =>
				!!p && typeof p === "object" && (p as { type?: string }).type === "text" && typeof (p as { text?: string }).text === "string",
		)
		.map((p) => p.text.trim())
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

export function truncate(text: string, max = BODY_MAX_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function buildNotifyText(opts: {
	project: string;
	model?: string;
	outcome?: AgentOutcome;
	text?: string;
	now?: Date;
}): string {
	const icon = opts.outcome === "aborted" ? "⚠️" : opts.outcome === "error" ? "❌" : "✅";
	const time = (opts.now ?? new Date()).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
	const meta = [opts.model, time].filter(Boolean).join(" · ");
	const body = opts.text?.trim() ? truncate(opts.text.trim()) : "(sin texto final — listo para input)";
	return `${icon} Pi terminó en ${opts.project}\n${meta}\n\n${body}`;
}

export function parseTelegramCommand(raw: string): { sub: string; args: string[] } {
	const tokens = (raw ?? "").trim().split(/\s+/).filter(Boolean);
	const sub = (tokens.shift() ?? "status").toLowerCase();
	return { sub, args: tokens };
}

// --- configuración: gana la última fuente (global → proyecto → .env → env real) ---

export function configPaths(home: string, cwd: string): string[] {
	return [join(home, ".pi", "agent", CONFIG_FILENAME), join(cwd, ".pi", CONFIG_FILENAME)];
}

export function parseEnvConfig(env: Record<string, string | undefined>): Partial<TelegramConfig> {
	const out: Partial<TelegramConfig> = {};
	if (env.TELEGRAM_BOT_TOKEN?.trim()) out.token = env.TELEGRAM_BOT_TOKEN.trim();
	if (env.TELEGRAM_CHAT_ID?.trim()) out.chatId = env.TELEGRAM_CHAT_ID.trim();
	const flag = (env.TELEGRAM_NOTIFY ?? "").toLowerCase();
	if (["0", "off", "false", "no"].includes(flag)) out.enabled = false;
	else if (["1", "on", "true", "yes"].includes(flag)) out.enabled = true;
	return out;
}

/** `.env` como fuente de config: mismas claves que el entorno real (TELEGRAM_*). */
export async function readEnvFile(path: string): Promise<Partial<TelegramConfig>> {
	try {
		return parseEnvConfig(parseEnv(await readFile(path, "utf8")));
	} catch {
		return {}; // ausente, ilegible o mal formado: se ignora
	}
}

/** Upsert de claves en un `.env`, conservando comentarios y demás variables. */
export function writeEnvFile(path: string, updates: Record<string, string>): void {
	let lines: string[] = [];
	try {
		lines = readFileSync(path, "utf8").split("\n");
	} catch {
		// no existe: se crea desde cero
	}
	const quote = (v: string) => (/[\s#"']/.test(v) ? JSON.stringify(v) : v);
	const pending = new Map(Object.entries(updates));
	const out = lines.map((line) => {
		const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
		if (key === undefined) return line;
		const value = pending.get(key);
		if (value === undefined) return line;
		pending.delete(key);
		return `${key}=${quote(value)}`;
	});
	while (out.length && out[out.length - 1].trim() === "") out.pop();
	for (const [key, value] of pending) out.push(`${key}=${quote(value)}`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${out.join("\n")}\n`, { mode: 0o600 }); // 0600: contiene el token
}

export function mergeConfig(...sources: Array<Partial<TelegramConfig> | undefined>): TelegramConfig {
	const merged: TelegramConfig = { enabled: true };
	for (const src of sources) {
		if (!src) continue;
		if (src.token) merged.token = src.token;
		if (src.chatId) merged.chatId = src.chatId;
		if (typeof src.enabled === "boolean") merged.enabled = src.enabled;
	}
	return merged;
}

export function parseConfig(raw: string): Partial<TelegramConfig> {
	try {
		const value = JSON.parse(raw) as Record<string, unknown> | null;
		if (value === null || typeof value !== "object") return {};
		const out: Partial<TelegramConfig> = {};
		if (typeof value.token === "string" && value.token.trim()) out.token = value.token.trim();
		if (typeof value.chatId === "string" && value.chatId.trim()) out.chatId = value.chatId.trim();
		if (typeof value.enabled === "boolean") out.enabled = value.enabled;
		return out;
	} catch {
		return {};
	}
}

export async function readConfigFiles(paths: string[]): Promise<TelegramConfig> {
	const sources: Array<Partial<TelegramConfig>> = [];
	for (const path of paths) {
		try {
			sources.push(parseConfig(await readFile(path, "utf8")));
		} catch {
			// fichero ausente o ilegible: se ignora
		}
	}
	return mergeConfig(...sources);
}

export function writeConfig(path: string, cfg: TelegramConfig): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 }); // 0600: contiene el token
}

// --- API de Telegram ---

async function apiCall<T = unknown>(token: string, method: string, payload: unknown, f: FetchLike = fetch): Promise<T> {
	const res = await f(`${TELEGRAM_API}/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	const data = (await res.json().catch(() => undefined)) as { ok?: boolean; description?: string; result?: T } | undefined;
	if (!res.ok || !data?.ok) throw new Error(data?.description ?? `Telegram HTTP ${res.status}`);
	return data.result as T;
}

export async function sendTelegram(
	cfg: Pick<TelegramConfig, "token" | "chatId">,
	text: string,
	f?: FetchLike,
): Promise<void> {
	if (!cfg.token || !cfg.chatId) throw new Error("faltan token o chat_id");
	await apiCall(cfg.token, "sendMessage", { chat_id: cfg.chatId, text }, f);
}

/** Último chat que escribió al bot (requiere haberle enviado /start antes). */
export async function detectChatId(token: string, f?: FetchLike): Promise<string | undefined> {
	const updates = await apiCall<Array<{ message?: { chat?: { id?: number | string } } }>>(token, "getUpdates", {}, f);
	for (const update of [...(updates ?? [])].toReversed()) {
		const id = update?.message?.chat?.id;
		if (id !== undefined && id !== null) return String(id);
	}
	return undefined;
}
