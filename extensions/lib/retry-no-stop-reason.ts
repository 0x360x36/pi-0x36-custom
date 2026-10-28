/** Razones de término que pi considera terminales y completas. `length` queda fuera: es una respuesta truncada. */
const TERMINAL_STOP_REASONS = new Set(["stop", "toolUse", "error", "aborted", "deferred"]);

/** true si el proveedor cerró el turno sin una razón de término utilizable o truncó la respuesta (`length`). */
export function isMissingStopReason(reason: unknown): boolean {
	return typeof reason !== "string" || !TERMINAL_STOP_REASONS.has(reason);
}

/** Reintentos por corrida antes de rendirse (evita un bucle infinito). */
export const MAX_RETRIES = 3;
