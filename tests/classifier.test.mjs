import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  analyzeText,
  detectFirstStrongDirection,
  isUrlOnly,
  isFilePathOnly,
  isPathLikeFragment,
  isJsonLikeBlock,
  classifyText,
} = require("../runtime/rtl-classifier.js");

const CLAUDE_THRESHOLD = 0.08;
const DEFAULT_THRESHOLD = 0.3;

test("analyzeText counts Hebrew and Latin letters separately", () => {
  const analysis = analyzeText("שלום world");
  assert.equal(analysis.firstStrong, "rtl");
  assert.equal(analysis.rtl, 4);
  assert.equal(analysis.ltr, 5);
  assert.equal(analysis.mixed, true);
});

test("analyzeText on digits-only text finds no strong direction", () => {
  const analysis = analyzeText("12345 + 678");
  assert.equal(analysis.firstStrong, "none");
  assert.equal(analysis.total, 0);
  assert.equal(analysis.rtlRatio, 0);
});

test("pure Hebrew message classifies as rtl-message", () => {
  assert.equal(classifyText("זאת הודעה רגילה בעברית בלי מילים באנגלית"), "rtl-message");
});

test("pure English message classifies as ltr-message", () => {
  assert.equal(classifyText("This is a plain English sentence."), "ltr-message");
});

test("mixed message starting with Hebrew classifies as mixed-rtl-message", () => {
  assert.equal(classifyText("תריץ את הפקודה git status ותראה מה קורה"), "mixed-rtl-message");
});

test("English-first message with high Hebrew ratio is RTL even at default threshold", () => {
  // Hebrew letters far outnumber the Latin ones here.
  assert.equal(
    classifyText("inject-runtime.mjs הוא הקובץ המרכזי שמטפל בכל ההזרקה לתוך האפליקציה"),
    "mixed-rtl-message",
  );
});

test("English-first message with low Hebrew ratio flips only at the Claude threshold", () => {
  // Latin letters: 18, Hebrew letters: 5 → ratio ≈ 0.217 (between 0.08 and 0.3).
  const text = "Update all call sites בהתאם";
  assert.equal(classifyText(text, { mixedRtlRatioThreshold: DEFAULT_THRESHOLD }), "mixed-ltr-message");
  assert.equal(classifyText(text, { mixedRtlRatioThreshold: CLAUDE_THRESHOLD }), "mixed-rtl-message");
});

test("English-first message below the Claude threshold stays LTR", () => {
  // A long English sentence with a tiny Hebrew tail → ratio under 0.08.
  const text = "The deployment pipeline finished successfully on the staging environment yesterday evening כן";
  assert.equal(classifyText(text, { mixedRtlRatioThreshold: CLAUDE_THRESHOLD }), "mixed-ltr-message");
});

test("inheritsRtlContext promotes an English-first block to RTL regardless of ratio", () => {
  const text = "Update all call sites בהתאם";
  assert.equal(
    classifyText(text, { mixedRtlRatioThreshold: DEFAULT_THRESHOLD, inheritsRtlContext: true }),
    "mixed-rtl-message",
  );
});

test("URL-only text classifies as url", () => {
  assert.equal(classifyText("https://github.com/nivdam/desktop-rtl-llm"), "url");
  assert.equal(isUrlOnly("see https://github.com please"), false);
});

test("Hebrew sentence containing a URL stays an RTL message", () => {
  assert.equal(classifyText("תסתכל על https://github.com זה בדיוק מה שחיפשנו"), "mixed-rtl-message");
});

test("file-path-only text classifies as file-path", () => {
  assert.equal(classifyText("runtime/rtl-runtime.js"), "file-path");
  assert.equal(classifyText("claude-installer.mjs"), "file-path");
  assert.equal(classifyText("~/Applications/app.txt"), "file-path");
});

test("isPathLikeFragment detects a path inside Hebrew prose", () => {
  assert.equal(isPathLikeFragment("ראה את הקובץ src/utils/foo.ts בבקשה"), true);
  assert.equal(isPathLikeFragment("אין כאן שום נתיב בכלל"), false);
});

test("JSON-like block classifies as json-like", () => {
  assert.equal(classifyText('{"wrapTextNodes": false}'), "json-like");
  assert.equal(isJsonLikeBlock("שלום {לא json}"), false);
});

test("empty and oversized text classify as unknown", () => {
  assert.equal(classifyText(""), "unknown");
  assert.equal(classifyText("   "), "unknown");
  assert.equal(classifyText(null), "unknown");
  assert.equal(classifyText("א".repeat(6001)), "unknown");
});

test("detectFirstStrongDirection maps text to editable direction", () => {
  assert.equal(detectFirstStrongDirection("שלום"), "rtl");
  assert.equal(detectFirstStrongDirection("hello"), "ltr");
  assert.equal(detectFirstStrongDirection("123"), "auto");
  assert.equal(detectFirstStrongDirection(""), "auto");
});

test("isFilePathOnly rejects regular sentences", () => {
  assert.equal(isFilePathOnly("This is not a path."), false);
  assert.equal(isFilePathOnly("שלום.עולם"), false);
});
