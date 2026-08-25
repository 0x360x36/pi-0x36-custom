/**
 * dir-size — tamaño del directorio donde se abrió pi, en GB/MB/KB.
 *
 * - Comandos /du, /dir-size, /tamaño [ruta] [--gb|--mb|--kb|--bytes|-h]
 * - Tool dir_size para que el LLM responda "¿cuánto pesa?" sin bash.
 * - El peso en footer se muestra a la derecha del estado de git (tok-per-second
 *   lo lee de ./lib/dir-size.ts y lo pinta con gradiente blanco→rojo 0–5 GB).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { formatBytes, getDirSize, parseDuArgs } from "./lib/dir-size.ts";

// re-export helpers para que `import ... from "../extensions/dir-size.ts"` siga funcionando en tests viejos
export { DU_POLL_MS, formatBytes, formatCwdShort, getDirSize, parseDuArgs, sizeGradientFg, sizeGradientHex, sizeGradientRgb } from "./lib/dir-size.ts";
export { KILO, MEGA, GIGA, MAX_GB, MAX_BYTES } from "./lib/dir-size.ts";

export default function (pi: ExtensionAPI) {
	let liveCtx: ExtensionContext | null = null;

	// liveCtx solo para que dir_size tool pueda resolver cwd cuando ctx es null
	pi.on("session_start", (_e, ctx) => {
		liveCtx = ctx;
	});
	pi.on("session_shutdown", () => {
		liveCtx = null;
	});

	const duHandler = async (args: string, ctx: ExtensionContext) => {
		const { target, unit } = parseDuArgs(args ?? "", ctx.cwd);
		ctx.ui.notify(`Calculando tamaño de ${target}…`, "info");
		try {
			const bytes = await getDirSize(target);
			const formatted = formatBytes(bytes, unit ? { unit } : undefined);
			const auto = formatBytes(bytes);
			const msg =
				unit && unit !== "auto"
					? `${formatted} — ${target} (${bytes} bytes, auto: ${auto})`
					: `${auto} — ${target} (${bytes} bytes)`;
			ctx.ui.notify(msg, "info");
		} catch (e) {
			ctx.ui.notify(`No se pudo calcular tamaño de ${target}: ${String(e)}`, "error");
		}
	};

	pi.registerCommand("du", {
		description: "Tamaño del directorio (cwd por defecto) — /du [ruta] [--gb|--mb|--kb|--bytes|-h]  ej: /du --gigas, /du ./dist --mb",
		handler: duHandler,
	});
	pi.registerCommand("dir-size", {
		description: "Alias de /du — tamaño del directorio en GB/MB/KB",
		handler: duHandler,
	});
	pi.registerCommand("tamaño", {
		description: "Alias de /du — tamaño del directorio",
		handler: duHandler,
	});

	pi.registerTool({
		name: "dir_size",
		label: "Dir Size",
		description:
			"Obtiene el tamaño del directorio donde se abrió pi (o la ruta indicada) en bytes y formateado GB/MB/KB. Úsalo cuando el usuario pregunte cuánto pesa/ocupa el proyecto o el directorio.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Ruta del directorio (relativa al cwd o absoluta). Vacío = cwd donde se abrió pi." },
				unit: { type: "string", description: "Unidad: bytes|kb|mb|gb|auto (auto elige gigas/megas/kilos según tamaño)", enum: ["bytes", "kb", "mb", "gb", "auto"] },
			},
			additionalProperties: false,
		} as never,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const c = (ctx as unknown as ExtensionContext) ?? liveCtx;
			const cwd = (c as ExtensionContext | null)?.cwd ?? liveCtx?.cwd ?? process.cwd();
			const target = params.path ? resolve(cwd, params.path) : cwd;
			const rawUnit = (params.unit ?? "").toLowerCase();
			const unit =
				rawUnit === "bytes" || rawUnit === "b"
					? "bytes"
					: rawUnit === "kb" || rawUnit === "kilo" || rawUnit === "kilos"
						? "kb"
						: rawUnit === "mb" || rawUnit === "mega" || rawUnit === "megas"
							? "mb"
							: rawUnit === "gb" || rawUnit === "giga" || rawUnit === "gigas"
								? "gb"
								: undefined;
			const bytes = await getDirSize(target);
			const formatted = formatBytes(bytes, unit ? { unit } : undefined);
			const auto = formatBytes(bytes);
			return {
				content: [{ type: "text", text: `${formatted} — ${target} (${bytes} bytes, auto: ${auto})` }],
				details: { bytes, formatted, auto, target },
			};
		},
	});
}
