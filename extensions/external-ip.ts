/**
 * external-ip — IP pública del equipo.
 *
 * - Comando /ip: consulta bajo demanda y la notifica.
 * - El valor vivo está en el footer de tok-per-second, en la línea de tok/s
 *   a la izquierda (bajo la info de consumo) como `🌐 1.2.3.4`
 *   (poll cada IP_POLL_MS, ver ./lib/external-ip.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetchExternalIp } from "./lib/external-ip.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ip", {
		description: "IP pública del equipo — /ip",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Consultando IP pública…", "info");
			try {
				const ip = await fetchExternalIp();
				ctx.ui.notify(`🌐 IP pública: ${ip}`, "info");
			} catch (e) {
				ctx.ui.notify(`No se pudo obtener la IP: ${String(e)}`, "error");
			}
		},
	});
}
