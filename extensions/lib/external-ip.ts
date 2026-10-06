/**
 * IP pública del equipo — helpers puros y fetch stdlib (Node >= 22), sin deps.
 * El render vive en el footer de tok-per-second (🌐 1.2.3.4) y el comando /ip
 * en extensions/external-ip.ts.
 */

import { isIP } from "node:net";

export const IP_POLL_MS = 300_000; // 5 min — la IP pública cambia poco
export const IP_TIMEOUT_MS = 5000;
// ponytail: dos proveedores de texto plano con fallback; sobra para un footer.
export const IP_PROVIDERS = ["https://api.ipify.org", "https://icanhazip.com"];

export type FetchLike = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// ponytail: solo acepta una IP literal (isIP), así una página HTML de error no pasa.
export function parseIp(body: string): string | null {
	const t = body.trim();
	return isIP(t) ? t : null;
}

export async function fetchExternalIp(
	f: FetchLike = fetch as unknown as FetchLike,
	providers: string[] = IP_PROVIDERS,
	timeoutMs: number = IP_TIMEOUT_MS,
): Promise<string> {
	let lastErr: unknown;
	for (const url of providers) {
		try {
			const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const ip = parseIp(await res.text());
			if (ip) return ip;
			throw new Error("respuesta no es una IP");
		} catch (e) {
			lastErr = e;
		}
	}
	throw new Error(
		`sin IP pública: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
	);
}
