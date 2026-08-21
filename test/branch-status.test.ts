import { branchSegment } from "../extensions/lib/git.ts";
import assert from "node:assert";

// limpio y sincronizado → solo la rama
assert.equal(branchSegment("main", {}), " [±main]");
// primer sondeo pendiente → solo la rama
assert.equal(branchSegment("main", { dirty: null }), " [±main]");
assert.equal(branchSegment("main", { ahead: undefined }), " [±main]");
// ● amarillo = dirty
assert.equal(branchSegment("main", { dirty: true }), " [±main ●]");
// ● rojo = sin push
assert.equal(branchSegment("main", { ahead: true }), " [±main ●]");
// ambas banderas → dos puntos en orden posicional (amarillo, rojo)
assert.equal(
	branchSegment("main", { dirty: true, ahead: true }),
	" [±main ●●]",
);
// fuera de un repo → sin segmento
assert.equal(branchSegment(null, {}), "");
assert.equal(branchSegment(undefined, { dirty: true }), "");
// detached HEAD → sin ± ni banderas
assert.equal(branchSegment("detached", { dirty: true }), " [detached]");
// limpio → [ ] blancos, ± verde (success), rama blanca
const cleanPainted: Array<[string, string]> = [];
branchSegment(
	"main",
	{},
	(text, color) => (cleanPainted.push([text, color]), text),
);
assert.deepEqual(cleanPainted, [
	["[", "white"],
	["±", "success"],
	["main", "white"],
	["]", "white"],
]);
// con fg: [ ] blancos, ± verde, dirty warning (amarillo), ahead error (rojo)
const painted: Array<[string, string]> = [];
branchSegment(
	"main",
	{ dirty: true, ahead: true },
	(text, color) => (painted.push([text, color]), text),
);
assert.deepEqual(painted, [
	["[", "white"],
	["±", "success"],
	["main", "white"],
	["●", "warning"],
	["●", "error"],
	["]", "white"],
]);

console.log("branch-status: all checks passed");
