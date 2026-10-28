/**
 * retry-no-stop-reason — reintenta la misma consulta cuando el modelo termina
 * el turno sin una razón de término válida (`stopReason` ausente, `null`, `""`
 * o `"pending"`) o trunca la respuesta (`"length"`, el aviso "Response was
 * truncated before completion." de pi).
 *
 * Omite la respuesta incompleta con un `context_edit` y pide una continuación:
 * el siguiente request reenvía exactamente el mismo contexto. Máximo 3
 * reintentos por corrida para no entrar en un bucle, ya que pi no reintenta
 * este caso por su cuenta.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isMissingStopReason, MAX_RETRIES } from "./lib/retry-no-stop-reason.ts";

export default function (pi: ExtensionAPI) {
	let attempts = 0;

	// Un nuevo prompt reinicia el contador; `agent_start` también se emite en
	// cada continuación, así que no sirve para esto.
	pi.on("before_agent_start", () => {
		attempts = 0;
	});

	pi.on("turn_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		if (event.outcome !== "completed") return;
		if (event.toolResults.length > 0) return; // los tool calls ya fuerzan otro turno
		if (!isMissingStopReason(event.message.stopReason)) return;

		if (attempts >= MAX_RETRIES) {
			if (attempts === MAX_RETRIES) {
				attempts++;
				ctx.ui.notify(`Respuesta incompleta: ${MAX_RETRIES} reintentos agotados`, "error");
			}
			return;
		}

		attempts++;
		const problem = event.message.stopReason === "length" ? "Respuesta truncada" : "Sin razón de término";
		ctx.ui.notify(`${problem}: reintentando (${attempts}/${MAX_RETRIES})`, "warning");
		return {
			entries: [{ type: "context_edit" as const, targetId: event.messageEntryId, replacement: null }],
			continue: true,
		};
	});
}
