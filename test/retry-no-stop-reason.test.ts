import assert from "node:assert";
import { isMissingStopReason, MAX_RETRIES } from "../extensions/lib/retry-no-stop-reason.ts";

// isMissingStopReason — solo las razones terminales de pi cuentan como válidas
for (const reason of ["stop", "toolUse", "error", "aborted", "deferred"])
	assert.equal(isMissingStopReason(reason), false, reason);
for (const reason of [undefined, null, "", "pending", "desconocida", "length"])
	assert.equal(isMissingStopReason(reason), true, String(reason));

// extensión — wiring con un pi/ctx de mentira
const { default: retryNoStopReason } = await import("../extensions/retry-no-stop-reason.ts");
const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
retryNoStopReason({
	on: (name: string, fn: (event: any, ctx: any) => any) => {
		(handlers[name] ??= []).push(fn);
	},
} as never);
assert.deepEqual(Object.keys(handlers).sort(), ["before_agent_start", "turn_end"]);

const uiCalls: string[] = [];
const ctx = { ui: { notify: (message: string) => uiCalls.push(message) } };
const turn = (overrides: Record<string, unknown> = {}) => ({
	message: { role: "assistant", stopReason: undefined, content: [] },
	messageEntryId: "entry-1",
	toolResults: [],
	outcome: "completed",
	...overrides,
});
const run = (event: Record<string, unknown>) => handlers.turn_end[0](turn(event), ctx);

handlers.before_agent_start[0]({}, ctx);

// sin razón de término → omite la respuesta y pide continuar
const first = await run({});
assert.deepEqual(first, {
	entries: [{ type: "context_edit", targetId: "entry-1", replacement: null }],
	continue: true,
});
assert.match(uiCalls.at(-1) ?? "", /reintentando \(1\/3\)/);

// razones válidas, tool results, outcome abortado y mensajes que no son del asistente: no toca nada
assert.equal(await run({ message: { role: "assistant", stopReason: "stop", content: [] } }), undefined);
assert.equal(await run({ toolResults: [{ role: "toolResult" }] }), undefined);
assert.equal(await run({ outcome: "aborted" }), undefined);
assert.equal(await run({ message: { role: "user", content: "hola" } }), undefined);

// respuesta truncada ("Response was truncated before completion.") → también reintenta
const truncated = await run({ message: { role: "assistant", stopReason: "length", content: [] } });
assert.equal(truncated.continue, true);
assert.match(uiCalls.at(-1) ?? "", /Respuesta truncada.*\(2\/3\)/);

// se agotan los reintentos y avisa una sola vez
const retry = await run({});
assert.equal(retry.continue, true);
await run({});
assert.equal(await run({}), undefined);
assert.match(uiCalls.at(-1) ?? "", /3 reintentos agotados/);
assert.equal(await run({}), undefined);
assert.equal(uiCalls.filter((message) => message.includes("agotados")).length, 1);

// un prompt nuevo vuelve a habilitar los reintentos
handlers.before_agent_start[0]({}, ctx);
assert.equal((await run({})).continue, true);

// MAX_RETRIES sigue siendo el límite documentado
assert.equal(MAX_RETRIES, 3);
for (let i = 0; i < MAX_RETRIES; i++) await run({});
assert.equal(await run({}), undefined);

console.log("retry-no-stop-reason: all checks passed");
