/**
 * telegram-notify — envía un mensaje por un bot de Telegram cuando el agente
 * termina de responder. Usa `agent_settled`, que se dispara cuando pi ya no va
 * a reintentar, compactar ni continuar solo (agent_end no sirve: pi puede
 * seguir trabajando después).
 *
 * Config (gana la última fuente): ~/.pi/agent/telegram-notify.json,
 * .pi/telegram-notify.json, `.env` en la raíz del paquete (se relee en cada
 * uso) y env TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_NOTIFY=0|1.
 * /telegram set|on|off escriben en ese `.env`.
 *
 * Comandos: /telegram [status] | set <token> [chat_id] | test | on | off
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { assistantText, buildNotifyText, configPaths, detectChatId, ENV_FILENAME, maskToken, mergeConfig, parseEnvConfig, parseTelegramCommand, readConfigFiles, readEnvFile, sendTelegram, writeEnvFile, type AgentOutcome, type TelegramConfig } from "./lib/telegram.ts";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function (pi: ExtensionAPI) {
	let lastRun: { text: string; outcome: AgentOutcome } = { text: "", outcome: "completed" };

	// .env junto a extensions/ (raíz del paquete); TELEGRAM_ENV_FILE lo sobreescribe (tests).
	const envPath = () => process.env.TELEGRAM_ENV_FILE?.trim() || join(import.meta.dirname, "..", ENV_FILENAME);

	const configFor = async (cwd: string): Promise<TelegramConfig> =>
		mergeConfig(await readConfigFiles(configPaths(homedir(), cwd)), await readEnvFile(envPath()), parseEnvConfig(process.env));

	pi.on("agent_start", () => {
		lastRun = { text: "", outcome: "completed" };
	});

	pi.on("turn_end", (event) => {
		if (event.message.role !== "assistant") return;
		lastRun = { text: assistantText(event.message), outcome: event.outcome };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const cfg = await configFor(ctx.cwd);
		if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
		const text = buildNotifyText({
			project: basename(ctx.cwd),
			model: ctx.model?.id,
			outcome: lastRun.outcome,
			text: lastRun.text,
		});
		lastRun = { text: "", outcome: "completed" };
		try {
			await sendTelegram(cfg, text);
		} catch (e) {
			ctx.ui.notify(`Telegram: ${errMsg(e)}`, "error");
		}
	});

	pi.registerCommand("telegram", {
		description: "Notificación Telegram al terminar: /telegram [status] | set <token> [chat_id] | test | on | off",
		handler: async (raw, ctx) => {
			const { sub, args } = parseTelegramCommand(raw);

			if (sub === "set") {
				const token = args[0];
				if (!token) {
					ctx.ui.notify("Uso: /telegram set <bot_token> [chat_id]", "warning");
					return;
				}
				let chatId: string | undefined = args[1];
				if (!chatId) {
					chatId = await detectChatId(token).catch(() => undefined);
					if (!chatId) {
						ctx.ui.notify("Sin chat_id: abre t.me/<tu_bot>, envía /start y repite /telegram set <token> [chat_id]", "warning");
						return;
					}
				}
				const cfg: TelegramConfig = { token, chatId, enabled: true };
				writeEnvFile(envPath(), { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, TELEGRAM_NOTIFY: "1" });
				try {
					await sendTelegram(cfg, `✅ Telegram conectado a pi (${basename(ctx.cwd)})`);
					ctx.ui.notify(`Telegram activo — chat ${chatId}`, "info");
				} catch (e) {
					ctx.ui.notify(`Guardado, pero falló el envío: ${errMsg(e)}`, "error");
				}
				return;
			}

			if (sub === "test") {
				const cfg = await configFor(ctx.cwd);
				if (!cfg.token || !cfg.chatId) {
					ctx.ui.notify("Sin configurar: /telegram set <bot_token> [chat_id]", "warning");
					return;
				}
				try {
					await sendTelegram(cfg, `🔔 Test de pi — ${new Date().toLocaleTimeString("es")}`);
					ctx.ui.notify("Test enviado ✔", "info");
				} catch (e) {
					ctx.ui.notify(`Falló: ${errMsg(e)}`, "error");
				}
				return;
			}

			if (sub === "on" || sub === "off") {
				writeEnvFile(envPath(), { TELEGRAM_NOTIFY: sub === "on" ? "1" : "0" });
				ctx.ui.notify(`Notificaciones Telegram ${sub === "on" ? "activadas" : "desactivadas"}`, "info");
				return;
			}

			const cfg = await configFor(ctx.cwd);
			const state = cfg.token && cfg.chatId ? `activo (${cfg.enabled ? "on" : "off"}) — token ${maskToken(cfg.token)}, chat ${cfg.chatId}` : "sin configurar";
			ctx.ui.notify(`Telegram ${state} — /telegram set <bot_token> [chat_id] | test | on | off`, "info");
		},
	});
}
