import { estimateTokPerSec, sessionAverage, tokensFromChars } from "../extensions/tok-per-second.ts";
import assert from "node:assert";

// 1s window, 400 chars ≈ 100 tokens
assert.equal(estimateTokPerSec(400, 1000), 100);
// 2s window, 800 chars ≈ 200 tokens
assert.equal(estimateTokPerSec(800, 2000), 100);
// no elapsed time yet → 0, never NaN/Infinity
assert.equal(estimateTokPerSec(0, 0), 0);
assert.equal(estimateTokPerSec(100, 0), 0);

assert.equal(tokensFromChars(400), 100);
assert.equal(tokensFromChars(0), 0);

// session average: 50 tokens + 100 streaming tokens, over 2s + 1s
assert.equal(sessionAverage(50, 2000, 100, 1000), 50);
assert.equal(sessionAverage(100, 2000, 100, 0), 200 / 2);
// nothing streamed yet → 0
assert.equal(sessionAverage(0, 0, 0, 0), 0);

console.log("tokps: all checks passed");