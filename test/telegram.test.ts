import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assistantText,
	buildNotifyText,
	configPaths,
	detectChatId,
	ENV_FILENAME,
	maskToken,
	mergeConfig,
	parseConfig,
	parseEnvConfig,
	parseTelegramCommand,
	readConfigFiles,
	readEnvFile,
	sendTelegram,
	truncate,
	writeConfig,
	writeEnvFile,
	BODY_MAX_CHARS,
	TELEGRAM_API,
	TELEGRAM_MAX_CHARS,
} from "../extensions/lib/telegram.ts";

// assistantText — solo partes de texto (thinking/toolCall fuera)
assert.equal(assistantText({ content: "hola" }), "hola");
assert.equal(
	assistantText({
		content: [
			{ type: "thinking", thinking: "…" },
			{ type: "text", text: "primera" },
			{ type: "toolCall", name: "bash" },
			{ type: "text", text: " segunda " },
		],
	}),
	"primera\n\nsegunda",
);
assert.equal(assistantText({ content: [{ type: "thinking", thinking: "x" }] }), "");
assert.equal(assistantText({}), "");

// truncate — respeta el límite y marca el corte
assert.equal(truncate("corto", 10), "corto");
const long = "a".repeat(5000);
const cut = truncate(long);
assert.ok(cut.length <= BODY_MAX_CHARS, `truncate devolvió ${cut.length}`);
assert.ok(cut.endsWith("…"));

// buildNotifyText — icono por outcome + proyecto + modelo + cuerpo
const now = new Date("2026-01-02T15:04:00");
assert.ok(buildNotifyText({ project: "proj", model: "m1", outcome: "completed", text: "listo", now }).startsWith("✅ Pi terminó en proj\nm1 ·"));
assert.ok(buildNotifyText({ project: "proj", outcome: "aborted", text: "x", now }).startsWith("⚠️"));
assert.ok(buildNotifyText({ project: "proj", outcome: "error", text: "x", now }).startsWith("❌"));
assert.ok(buildNotifyText({ project: "proj", text: "", now }).includes("(sin texto final"));
const huge = buildNotifyText({ project: "p", model: "m", outcome: "completed", text: long, now });
assert.ok(huge.length <= TELEGRAM_MAX_CHARS, `mensaje de ${huge.length} chars excede Telegram`);

// maskToken — nunca expone el token completo
assert.equal(maskToken(""), "");
assert.equal(maskToken("123456"), "***");
assert.equal(maskToken("1234567890abc"), "123456…0abc");

// parseTelegramCommand
assert.deepEqual(parseTelegramCommand(""), { sub: "status", args: [] });
assert.deepEqual(parseTelegramCommand("  "), { sub: "status", args: [] });
assert.deepEqual(parseTelegramCommand("set 123:abc 42"), { sub: "set", args: ["123:abc", "42"] });
assert.deepEqual(parseTelegramCommand("ON"), { sub: "on", args: [] });

// config — precedencia global < proyecto < env
const env = parseEnvConfig({ TELEGRAM_BOT_TOKEN: " tk ", TELEGRAM_CHAT_ID: "9", TELEGRAM_NOTIFY: "off" });
assert.deepEqual(env, { token: "tk", chatId: "9", enabled: false });
assert.deepEqual(parseEnvConfig({ TELEGRAM_NOTIFY: "yes" }), { enabled: true });
assert.deepEqual(parseEnvConfig({}), {});
const merged = mergeConfig({ token: "file", chatId: "1", enabled: true }, { token: "proj" }, env);
assert.deepEqual(merged, { token: "tk", chatId: "9", enabled: false });
assert.deepEqual(mergeConfig(undefined), { enabled: true });

// parseConfig — JSON inválido o basura no rompe
assert.deepEqual(parseConfig("{nope"), {});
assert.deepEqual(parseConfig('{"token":" a ","chatId":" b ","enabled":false}'), { token: "a", chatId: "b", enabled: false });

// configPaths — global y luego proyecto (el proyecto pisa al global)
const home = mkdtempSync(join(tmpdir(), "pi-tg-home-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-tg-cwd-"));
try {
	assert.deepEqual(configPaths(home, cwd), [
		join(home, ".pi", "agent", "telegram-notify.json"),
		join(cwd, ".pi", "telegram-notify.json"),
	]);

	// ficheros ausentes se ignoran; el proyecto pisa al global
	assert.deepEqual(await readConfigFiles(configPaths(home, cwd)), { enabled: true });

	const globalPath = configPaths(home, cwd)[0];
	const projectPath = configPaths(home, cwd)[1];
	writeConfig(globalPath, { token: "g", chatId: "1", enabled: true });
	writeConfig(projectPath, { token: "p", enabled: false });
	assert.deepEqual(await readConfigFiles(configPaths(home, cwd)), { token: "p", chatId: "1", enabled: false });

	// writeConfig crea directorios y guarda con permisos 0600 (contiene el token)
	const mode = statSync(globalPath).mode & 0o777;
	if (process.platform !== "win32") assert.equal(mode, 0o600, `permisos ${mode.toString(8)}`);

	// JSON corrupto en un fichero: se ignora y sigue el resto
	writeFileSync(projectPath, "{ roto");
	assert.deepEqual(await readConfigFiles(configPaths(home, cwd)), { token: "g", chatId: "1", enabled: true });
} finally {
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
}

// .env — ausente no rompe, se parsea como env y el upsert conserva el resto
const envDir = mkdtempSync(join(tmpdir(), "pi-tg-env-"));
try {
	const envPath = join(envDir, ENV_FILENAME);
	assert.deepEqual(await readEnvFile(envPath), {}); // ausente → vacío
	writeEnvFile(envPath, { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42", TELEGRAM_NOTIFY: "off" }); // fichero nuevo
	if (process.platform !== "win32") assert.equal(statSync(envPath).mode & 0o777, 0o600, "0600: contiene el token");
	writeFileSync(envPath, "# bot de pi\nTELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_CHAT_ID='42'\nexport TELEGRAM_NOTIFY=off\nOTRO=1\n");
	assert.deepEqual(await readEnvFile(envPath), { token: "123:abc", chatId: "42", enabled: false });
	writeEnvFile(envPath, { TELEGRAM_BOT_TOKEN: "999:zzz", TELEGRAM_NOTIFY: "1" });
	assert.ok(readFileSync(envPath, "utf8").includes("OTRO=1"), "el upsert no debe borrar otras variables");
	assert.deepEqual(await readEnvFile(envPath), { token: "999:zzz", chatId: "42", enabled: true });
} finally {
	rmSync(envDir, { recursive: true, force: true });
}

// API — fetch inyectado
const fakeFetch = (data: unknown, ok = true) => {
	const calls: Array<{ url: string; body: any }> = [];
	const f = (async (url: string, init: any) => {
		calls.push({ url: String(url), body: JSON.parse(init.body) });
		return { ok, status: ok ? 200 : 400, json: async () => data };
	}) as unknown as typeof fetch;
	return { f, calls };
};

const sent = fakeFetch({ ok: true, result: { message_id: 1 } });
await sendTelegram({ token: "123:abc", chatId: "42" }, "hola", sent.f);
assert.deepEqual(sent.calls, [
	{ url: `${TELEGRAM_API}/bot123:abc/sendMessage`, body: { chat_id: "42", text: "hola" } },
]);

await assert.rejects(() => sendTelegram({ token: "t", chatId: "" }, "x", sent.f), /faltan token o chat_id/);
const failing = fakeFetch({ ok: false, description: "chat not found" }, false);
await assert.rejects(() => sendTelegram({ token: "t", chatId: "1" }, "x", failing.f), /chat not found/);

// detectChatId — coge el chat del último update
const updates = fakeFetch({ ok: true, result: [{ message: { chat: { id: 111 } } }, { message: { chat: { id: 222 } } }, {}] });
assert.equal(await detectChatId("t", updates.f), "222");
assert.equal(updates.calls[0].url, `${TELEGRAM_API}/bott/getUpdates`);
const empty = fakeFetch({ ok: true, result: [] });
assert.equal(await detectChatId("t", empty.f), undefined);

// extensión — wiring de eventos y comando con un pi/ctx de mentira
const { default: telegramNotify } = await import("../extensions/telegram-notify.ts");
const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
const commands: Record<string, any> = {};
telegramNotify({
	on: (name: string, fn: (event: any, ctx: any) => any) => {
		(handlers[name] ??= []).push(fn);
	},
	registerCommand: (name: string, def: unknown) => {
		commands[name] = def;
	},
} as never);
assert.deepEqual(Object.keys(handlers).sort(), ["agent_settled", "agent_start", "turn_end"]);
assert.ok(commands.telegram?.handler);

// turn_end guarda la última respuesta; agent_settled sin config no toca la red
const savedEnv = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID, flag: process.env.TELEGRAM_NOTIFY, home: process.env.HOME, envFile: process.env.TELEGRAM_ENV_FILE };
const tmpHome = mkdtempSync(join(tmpdir(), "pi-tg-wiring-"));
const tmpEnv = join(tmpHome, ENV_FILENAME);
process.env.HOME = tmpHome; // config global de mentira: no tocar la real
process.env.TELEGRAM_ENV_FILE = tmpEnv; // .env de mentira: no tocar el del paquete
delete process.env.TELEGRAM_BOT_TOKEN; // el entorno real no debe pisar el .env de prueba
delete process.env.TELEGRAM_CHAT_ID;
process.env.TELEGRAM_NOTIFY = "0";
const uiCalls: string[] = [];
const ctx = { cwd: process.cwd(), model: { id: "m" }, ui: { notify: (m: string) => uiCalls.push(m) } };
try {
	handlers.agent_start[0]({}, ctx);
	handlers.turn_end[0]({ message: { role: "assistant", content: [{ type: "text", text: "final" }] }, outcome: "completed" }, ctx);
	await handlers.turn_end[0]({ message: { role: "toolResult", content: "x" }, outcome: "completed" }, ctx);
	await handlers.agent_settled[0]({ type: "agent_settled" }, ctx);
	assert.equal(uiCalls.length, 0, uiCalls.join(" | ")); // sin config: ni envío ni error

	// el .env se relee en cada uso: basta escribir el fichero, sin reiniciar pi
	const sentTo: Array<{ url: string; body: any }> = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: any, init: any) => {
		sentTo.push({ url: String(url), body: JSON.parse(init.body) });
		return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
	}) as typeof fetch;
	writeEnvFile(tmpEnv, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "7", TELEGRAM_NOTIFY: "1" });
	delete process.env.TELEGRAM_NOTIFY;
	try {
		handlers.turn_end[0]({ message: { role: "assistant", content: [{ type: "text", text: "final" }] }, outcome: "completed" }, ctx);
		await handlers.agent_settled[0]({}, ctx);
		assert.equal(sentTo.length, 1);
		assert.equal(sentTo[0].url, `${TELEGRAM_API}/bott/sendMessage`);
		assert.equal(sentTo[0].body.chat_id, "7");
		assert.ok(sentTo[0].body.text.includes("✅ Pi terminó"), sentTo[0].body.text);
		assert.ok(sentTo[0].body.text.includes("m ·"), sentTo[0].body.text);
		assert.ok(sentTo[0].body.text.endsWith("final"), sentTo[0].body.text);

		// cambia el .env → el siguiente settle ya usa el token nuevo
		writeEnvFile(tmpEnv, { TELEGRAM_BOT_TOKEN: "t2", TELEGRAM_CHAT_ID: "8" });
		handlers.turn_end[0]({ message: { role: "assistant", content: [{ type: "text", text: "otra" }] }, outcome: "completed" }, ctx);
		await handlers.agent_settled[0]({}, ctx);
		assert.equal(sentTo[1].url, `${TELEGRAM_API}/bott2/sendMessage`);
		assert.equal(sentTo[1].body.chat_id, "8");

		// el texto se limpia tras enviar: un settle sin turno nuevo manda el placeholder
		await handlers.agent_settled[0]({}, ctx);
		assert.ok(sentTo[2].body.text.includes("(sin texto final"), sentTo[2].body.text);
	} finally {
		globalThis.fetch = realFetch;
	}

	await commands.telegram.handler("", ctx);
	assert.ok(uiCalls.at(-1)?.includes("Telegram"), uiCalls.at(-1));
	await commands.telegram.handler("off", ctx);
	assert.match(uiCalls.at(-1) ?? "", /desactivadas/);
	assert.equal((await readEnvFile(tmpEnv)).enabled, false); // on|off persisten en el .env
	await commands.telegram.handler("on", ctx);
	assert.match(uiCalls.at(-1) ?? "", /activadas/);
	assert.equal((await readEnvFile(tmpEnv)).enabled, true);
} finally {
	if (savedEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
	else process.env.TELEGRAM_BOT_TOKEN = savedEnv.token;
	if (savedEnv.chat === undefined) delete process.env.TELEGRAM_CHAT_ID;
	else process.env.TELEGRAM_CHAT_ID = savedEnv.chat;
	if (savedEnv.flag === undefined) delete process.env.TELEGRAM_NOTIFY;
	else process.env.TELEGRAM_NOTIFY = savedEnv.flag;
	if (savedEnv.home === undefined) delete process.env.HOME;
	else process.env.HOME = savedEnv.home;
	if (savedEnv.envFile === undefined) delete process.env.TELEGRAM_ENV_FILE;
	else process.env.TELEGRAM_ENV_FILE = savedEnv.envFile;
	rmSync(tmpHome, { recursive: true, force: true });
}

console.log("telegram: all checks passed");
