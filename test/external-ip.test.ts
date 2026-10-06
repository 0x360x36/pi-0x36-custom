import assert from "node:assert";
import { fetchExternalIp, IP_PROVIDERS, parseIp, type FetchLike } from "../extensions/lib/external-ip.ts";

// parseIp — IPv4/IPv6 con espacios/saltos; rechaza HTML/basura
assert.equal(parseIp("203.0.113.7\n"), "203.0.113.7");
assert.equal(parseIp("  1.1.1.1  "), "1.1.1.1");
assert.equal(parseIp("2001:db8::1"), "2001:db8::1");
assert.equal(parseIp(""), null);
assert.equal(parseIp("999.1.1.1"), null);
assert.equal(parseIp("<html>nginx</html>"), null);

// fetchExternalIp — primer proveedor 503, el fallback responde (fetch falso, sin red)
const calls: string[] = [];
const fake: FetchLike = (url) => {
	calls.push(url);
	if (url === IP_PROVIDERS[0])
		return Promise.resolve({ ok: false, status: 503, text: async () => "" });
	return Promise.resolve({ ok: true, status: 200, text: async () => "198.51.100.9\n" });
};
assert.equal(await fetchExternalIp(fake), "198.51.100.9");
assert.deepEqual(calls, [IP_PROVIDERS[0], IP_PROVIDERS[1]]);

// proveedor que lanza (timeout/red) → también cae al siguiente
const throwing: FetchLike = (url) =>
	url === IP_PROVIDERS[0]
		? Promise.reject(new Error("timeout"))
		: Promise.resolve({ ok: true, status: 200, text: async () => "203.0.113.5" });
assert.equal(await fetchExternalIp(throwing), "203.0.113.5");

// respuesta no-IP en todos → throw
await assert.rejects(() =>
	fetchExternalIp(async () => ({ ok: true, status: 200, text: async () => "<html>" })),
);

// lista de proveedores vacía → throw (no cuelga)
await assert.rejects(() => fetchExternalIp(fake, []));

console.log("external-ip: all checks passed");
