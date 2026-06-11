/* Local RTL Desktop Runtime — pure text classification. No DOM access in this file. */
/* Evaluated before rtl-runtime.js in every injection path; also consumed by tests via require. */
(() => {
  "use strict";

  const RTL_RANGES = [
    [0x0590, 0x05ff],
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
    [0x08a0, 0x08ff],
    [0x0700, 0x074f],
    [0x0780, 0x07bf],
  ];

  function isRtlChar(char) {
    const code = char.charCodeAt(0);
    return RTL_RANGES.some(([start, end]) => code >= start && code <= end);
  }

  function isLetter(char) {
    return /\p{L}/u.test(char);
  }

  function analyzeText(text) {
    const trimmed = String(text || "").trim();
    let firstStrong = "none";
    let rtl = 0;
    let ltr = 0;

    for (const char of trimmed) {
      if (isRtlChar(char)) {
        rtl += 1;
        if (firstStrong === "none") firstStrong = "rtl";
      } else if (isLetter(char)) {
        ltr += 1;
        if (firstStrong === "none") firstStrong = "ltr";
      }
    }

    const total = rtl + ltr;
    const rtlRatio = total > 0 ? rtl / total : 0;
    const mixed = rtl > 0 && ltr > 0;
    return { firstStrong, rtl, ltr, total, rtlRatio, mixed };
  }

  function detectFirstStrongDirection(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return "auto";
    const analysis = analyzeText(trimmed);
    if (analysis.firstStrong === "rtl") return "rtl";
    if (analysis.firstStrong === "ltr") return "ltr";
    return "auto";
  }

  function isUrlOnly(text) {
    return /^(?:https?:\/\/|www\.)\S+$/i.test(text.trim());
  }

  function isFilePathOnly(text) {
    return /^(?:(?:~?\/|\.{1,2}\/|[A-Za-z0-9_-]+\/)[^\s`'"]+|[A-Za-z0-9_$@#-]+)\.[A-Za-z0-9]{1,12}$/.test(text.trim());
  }

  function isPathLikeFragment(text) {
    return /(?:^|[\s([{])(?:(?:~?\/|\.{1,2}\/|[A-Za-z0-9_-]+\/)[^\s`'"]+|[A-Za-z0-9_$@#-]+)\.[A-Za-z0-9]{1,12}(?=$|[\s\]),.;:!?])/.test(text);
  }

  function isJsonLikeBlock(text) {
    const trimmed = text.trim();
    if (trimmed.length < 2) return false;
    if (!/^[\[{]/.test(trimmed) || !/[\]}]$/.test(trimmed)) return false;
    return /["'][A-Za-z0-9_-]+["']\s*:/.test(trimmed);
  }

  function classifyText(text, options) {
    const opts = options || {};
    const mixedRtlRatioThreshold = Number.isFinite(opts.mixedRtlRatioThreshold) ? opts.mixedRtlRatioThreshold : 0.3;
    const trimmed = String(text || "").trim();
    if (!trimmed || trimmed.length > 6000) return "unknown";

    if (isUrlOnly(trimmed)) return "url";
    if (isFilePathOnly(trimmed)) return "file-path";
    if (isJsonLikeBlock(trimmed)) return "json-like";

    const analysis = analyzeText(trimmed);
    if (analysis.firstStrong === "rtl") return analysis.mixed ? "mixed-rtl-message" : "rtl-message";
    if (analysis.firstStrong === "ltr" && analysis.mixed && opts.inheritsRtlContext === true) {
      return "mixed-rtl-message";
    }
    if (analysis.firstStrong === "ltr" && analysis.mixed && analysis.rtlRatio >= mixedRtlRatioThreshold) {
      return "mixed-rtl-message";
    }
    if (analysis.firstStrong === "ltr") {
      return analysis.mixed ? "mixed-ltr-message" : "ltr-message";
    }
    if (analysis.rtlRatio >= 0.3) return "mixed-rtl-message";
    return "unknown";
  }

  const api = {
    analyzeText,
    detectFirstStrongDirection,
    isRtlChar,
    isLetter,
    isUrlOnly,
    isFilePathOnly,
    isPathLikeFragment,
    isJsonLikeBlock,
    classifyText,
  };

  globalThis.__LOCAL_RTL_CLASSIFIER__ = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
