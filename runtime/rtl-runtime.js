(() => {
  "use strict";

  const GLOBAL_KEY = "__LOCAL_RTL_RUNTIME__";
  const PROFILE_KEY = "__LOCAL_RTL_PROFILE__";
  const APPLIED_ATTR = "data-local-rtl-applied";
  const KIND_ATTR = "data-local-rtl-kind";
  const LAST_CLASS_ATTR = "data-local-rtl-class";
  const EDITABLE_LOCK_ATTR = "data-local-rtl-editable-lock";
  const TEXT_WRAPPER_ATTR = "data-local-rtl-text-wrapper";
  const MATCHED_SELECTOR_ATTR = "data-local-rtl-matched-selector";
  const PREVIOUS_DIR_ATTR = "data-local-rtl-previous-dir";

  if (window[GLOBAL_KEY]?.cleanup) {
    window[GLOBAL_KEY].cleanup();
  }

  const profile = window[PROFILE_KEY] || {};
  const appName = String(profile.name || "unknown").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "unknown";
  const appClass = `local-rtl-app-${appName}`;
  document.documentElement.setAttribute("data-llm", appName);
  document.documentElement.classList.add(appClass);
  const allowSelectors = profile.allowSelectors || [];
  const denySelectors = [
    ...(profile.denySelectors || []),
    ...(profile.authDenySelectors || []),
    ...(profile.codeLikeSelectors || []),
  ];
  const textContainerSelectors = profile.textContainerSelectors || ["p", "li", "blockquote"];
  const inputSelectors = profile.inputSelectors || [];
  const includeAllowRoots = profile.includeAllowRoots === true;
  const wrapTextNodes = profile.wrapTextNodes !== false;
  const editableStrategy = String(profile.editableStrategy || "direction-auto-plaintext");

  const stats = {
    scanned: 0,
    rtlApplied: 0,
    ltrApplied: 0,
    skippedCodeEditor: 0,
    skippedPathUrlJson: 0,
    skippedDeny: 0,
    mutationBatches: 0,
    lastRuntimeError: null,
  };

  let observer = null;
  let scheduled = false;
  const touched = new Set();
  const wrappedTextNodes = new Set();
  const insertedRlmTextNodes = new Set();
  const candidateSelectors = new WeakMap();
  const cleanupCallbacks = [];
  const RLM = "\u200f";

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

  function safeMatches(element, selector) {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  function safeClosest(element, selector) {
    try {
      return element.closest(selector);
    } catch {
      return null;
    }
  }

  function matchesAny(element, selectors) {
    return selectors.some((selector) => safeMatches(element, selector));
  }

  function closestAny(element, selectors) {
    return selectors.some((selector) => safeClosest(element, selector));
  }

  function isInsideAllow(element) {
    return allowSelectors.length === 0 || matchesAny(element, allowSelectors) || closestAny(element, allowSelectors);
  }

  function isInsideDeny(element) {
    if (isBlockTextCandidate(element)) {
      return element.parentElement ? closestAny(element.parentElement, denySelectors) : false;
    }
    return closestAny(element, denySelectors) || matchesAny(element, denySelectors);
  }

  function isEditable(element) {
    return matchesAny(element, inputSelectors) || element.isContentEditable;
  }

  function getEditableText(element) {
    if (element instanceof HTMLTextAreaElement) return element.value || "";
    if (element instanceof HTMLInputElement) return element.value || "";
    return element.innerText || element.textContent || "";
  }

  function detectFirstStrongDirection(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return "auto";
    const analysis = analyzeText(trimmed);
    if (analysis.firstStrong === "rtl") return "rtl";
    if (analysis.firstStrong === "ltr") return "ltr";
    return "auto";
  }

  function applyEditableDirection(element, nextDir) {
    if (!(element instanceof Element)) return;
    if (!element.hasAttribute(PREVIOUS_DIR_ATTR)) {
      element.setAttribute(PREVIOUS_DIR_ATTR, element.getAttribute("dir") || "");
    }

    element.classList.remove("local-rtl-editable-rtl", "local-rtl-editable-ltr");
    if (nextDir === "rtl") {
      element.setAttribute("dir", "rtl");
      element.classList.add("local-rtl-editable-rtl");
    } else if (nextDir === "ltr") {
      element.setAttribute("dir", "ltr");
      element.classList.add("local-rtl-editable-ltr");
    } else {
      element.setAttribute("dir", "auto");
    }
    syncEditableMirror(element, nextDir);
    touched.add(element);
  }

  function syncEditableMirror(element, nextDir) {
    const parent = element.parentElement;
    if (!parent) return;
    const mirror = parent.querySelector('[class*="mentionMirror"]');
    if (!(mirror instanceof Element)) return;

    mirror.classList.remove("local-rtl-editable-rtl", "local-rtl-editable-ltr");
    if (nextDir === "rtl") {
      mirror.setAttribute("dir", "rtl");
      mirror.classList.add("local-rtl-editable-rtl");
    } else if (nextDir === "ltr") {
      mirror.setAttribute("dir", "ltr");
      mirror.classList.add("local-rtl-editable-ltr");
    } else {
      mirror.setAttribute("dir", "auto");
    }
    touched.add(mirror);
  }

  function findEditableRoot(target) {
    if (!(target instanceof Element)) return null;
    for (const selector of inputSelectors) {
      const match = safeClosest(target, selector);
      if (match) return match;
    }
    return target.isContentEditable ? target : null;
  }

  function updateEditableDirection(target) {
    const editable = findEditableRoot(target);
    if (!editable) return;
    if (editableStrategy !== "dynamic-first-strong") return;
    const text = getEditableText(editable);
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      editable.removeAttribute(EDITABLE_LOCK_ATTR);
      applyEditableDirection(editable, "auto");
      return;
    }

    const lockedDir = editable.getAttribute(EDITABLE_LOCK_ATTR);
    const nextDir = lockedDir || detectFirstStrongDirection(text);
    if (nextDir === "rtl" || nextDir === "ltr") {
      editable.setAttribute(EDITABLE_LOCK_ATTR, nextDir);
    }
    applyEditableDirection(editable, nextDir);
  }

  function setupEditableDirectionHandling() {
    if (editableStrategy !== "dynamic-first-strong") return;

    const onEditableEvent = (event) => {
      updateEditableDirection(event.target);
    };

    const onSelectionChange = () => {
      const active = document.activeElement;
      if (active) updateEditableDirection(active);
    };

    document.addEventListener("focusin", onEditableEvent, true);
    document.addEventListener("input", onEditableEvent, true);
    document.addEventListener("keyup", onEditableEvent, true);
    document.addEventListener("selectionchange", onSelectionChange, true);

    const intervalId = window.setInterval(() => {
      const active = document.activeElement;
      if (active) updateEditableDirection(active);
      document.querySelectorAll(inputSelectors.join(", ")).forEach((element) => updateEditableDirection(element));
    }, 200);

    cleanupCallbacks.push(() => {
      document.removeEventListener("focusin", onEditableEvent, true);
      document.removeEventListener("input", onEditableEvent, true);
      document.removeEventListener("keyup", onEditableEvent, true);
      document.removeEventListener("selectionchange", onSelectionChange, true);
      window.clearInterval(intervalId);
    });
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function classifyElement(element) {
    if (isInsideDeny(element)) {
      stats.skippedDeny += 1;
      stats.skippedCodeEditor += 1;
      return "code-block";
    }

    const text = (element.innerText || element.textContent || "").trim();
    if (!text || text.length > 6000) return "unknown";

    if (isUrlOnly(text)) return "url";
    if (isFilePathOnly(text)) return "file-path";
    if (isJsonLikeBlock(text)) return "json-like";

    const analysis = analyzeText(text);
    if (analysis.firstStrong === "rtl") return analysis.mixed ? "mixed-rtl-message" : "rtl-message";
    if (analysis.firstStrong === "ltr" && analysis.mixed && shouldInheritRtlContext(element)) {
      return "mixed-rtl-message";
    }
    if (appName === "claude" && analysis.firstStrong === "ltr" && analysis.mixed && analysis.rtlRatio >= 0.08) {
      return "mixed-rtl-message";
    }
    if (analysis.firstStrong === "ltr" && analysis.mixed && analysis.rtlRatio >= 0.3) {
      return "mixed-rtl-message";
    }
    if (analysis.firstStrong === "ltr") {
      return analysis.mixed ? "mixed-ltr-message" : "ltr-message";
    }
    if (analysis.rtlRatio >= 0.3) return "mixed-rtl-message";
    return "unknown";
  }

  function isListElement(element) {
    return element.tagName === "UL" || element.tagName === "OL";
  }

  function isInlineProtectedCandidate(element) {
    if (isBlockTextCandidate(element)) return false;
    return safeMatches(element, "code, kbd, samp, a, [class*='inlineCode'], [class*='InlineCode']");
  }

  function isBlockTextCandidate(element) {
    return safeMatches(element, "p, li, blockquote, h1, h2, h3, h4, h5, h6, ul, ol, table, th, td");
  }

  function shouldInheritRtlContext(element) {
    if (!isBlockTextCandidate(element)) return false;
    const parent = element.parentElement;
    if (!parent) return false;
    return Boolean(safeClosest(parent, ".local-rtl-message, .local-mixed-rtl-message, [dir='rtl']"));
  }

  function classForKind(kind) {
    if (kind === "rtl-message") return "local-rtl-message";
    if (kind === "mixed-rtl-message") return "local-mixed-rtl-message";
    if (kind === "ltr-message") return "local-ltr-message";
    if (kind === "mixed-ltr-message") return "local-mixed-ltr-message";
    if (["code-block", "inline-code", "terminal-output", "diff-output", "file-path", "url", "json-like"].includes(kind)) {
      return "local-rtl-protected-ltr";
    }
    return "";
  }

  function dirForKind(kind) {
    if (kind === "rtl-message" || kind === "mixed-rtl-message") return "rtl";
    if (kind === "ltr-message" || kind === "mixed-ltr-message") return "ltr";
    if (["code-block", "inline-code", "terminal-output", "diff-output", "file-path", "url", "json-like"].includes(kind)) return "ltr";
    return "";
  }

  function applyKind(element, kind) {
    const nextClass = classForKind(kind);
    if (!nextClass) return;

    const previousClass = element.getAttribute(LAST_CLASS_ATTR);
    if (previousClass === nextClass && element.getAttribute(KIND_ATTR) === kind) return;

    if (previousClass) element.classList.remove(previousClass);
    element.classList.add(nextClass);
    const nextDir = dirForKind(kind);
    if (nextDir) {
      if (!element.hasAttribute(PREVIOUS_DIR_ATTR)) {
        element.setAttribute(PREVIOUS_DIR_ATTR, element.getAttribute("dir") || "");
      }
      element.setAttribute("dir", nextDir);
    }
    element.setAttribute(APPLIED_ATTR, "true");
    element.setAttribute(KIND_ATTR, kind);
    element.setAttribute(LAST_CLASS_ATTR, nextClass);
    element.setAttribute(MATCHED_SELECTOR_ATTR, candidateSelectors.get(element) || "");
    touched.add(element);
    prepareRenderedText(element, kind);

    if (kind === "rtl-message" || kind === "mixed-rtl-message") stats.rtlApplied += 1;
    else stats.ltrApplied += 1;
  }

  function isRenderedMessageKind(kind) {
    return ["rtl-message", "mixed-rtl-message", "ltr-message", "mixed-ltr-message"].includes(kind);
  }

  function prepareRenderedText(element, kind) {
    if (!isRenderedMessageKind(kind)) return;
    anchorCodexRtlBlock(element, kind);
    isolateInlineFragments(element);
    ensurePlaintextTextWrappers(element, kind);
  }

  function anchorCodexRtlBlock(element, kind) {
    if (appName !== "codex") return;
    if (kind !== "rtl-message" && kind !== "mixed-rtl-message") return;

    const blockSelector = "p, li, blockquote, h1, h2, h3, h4, h5, h6";
    const blocks = safeMatches(element, blockSelector) ? [element] : Array.from(element.querySelectorAll(blockSelector));

    for (const block of blocks) {
      if (!(block instanceof Element)) continue;
      if (safeClosest(block, "pre, code, kbd, samp")) continue;
      const blockKind = block === element ? kind : classifyElement(block);
      if (blockKind !== "rtl-message" && blockKind !== "mixed-rtl-message") continue;
      const first = block.firstChild;
      if (first?.nodeType === Node.TEXT_NODE && first.textContent?.startsWith(RLM)) continue;

      const anchor = document.createTextNode(RLM);
      block.insertBefore(anchor, first || null);
      insertedRlmTextNodes.add(anchor);
    }
  }

  function isolateInlineFragments(element) {
    const selectors = [
      "code",
      "kbd",
      "samp",
      "a",
      ".inline-code",
      ".inline-markdown",
      "[class*='inlineCode']",
      "[class*='inlineMarkdown']",
      "[data-local-rtl-kind='file-path']",
      "[data-local-rtl-kind='url']",
      "[data-local-rtl-kind='json-like']",
    ];
    try {
      element.querySelectorAll(selectors.join(", ")).forEach((node) => {
        node.classList.add("local-rtl-inline-ltr");
        if (!node.hasAttribute(PREVIOUS_DIR_ATTR)) {
          node.setAttribute(PREVIOUS_DIR_ATTR, node.getAttribute("dir") || "");
        }
        node.setAttribute("dir", "ltr");
        touched.add(node);
      });
    } catch {
      // Ignore selector issues in app-specific DOM.
    }
  }

  function ensurePlaintextTextWrappers(element, kind) {
    if (!wrapTextNodes) return;
    if (element.closest(`[${TEXT_WRAPPER_ATTR}="true"]`)) return;
    const baseDir = dirForKind(kind) || "auto";

    const directTextNodes = Array.from(element.childNodes).filter((node) => {
      return node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.trim().length > 0;
    });

    for (const textNode of directTextNodes) {
      if (textNode.parentElement?.closest("code, kbd, samp, pre, a")) continue;
      wrapTextNodeWithBidiRuns(textNode, baseDir);
    }
  }

  function wrapTextNodeWithBidiRuns(textNode, baseDir) {
    const text = textNode.nodeValue || "";
    const pathPattern = /((?:(?:~?\/|\.{1,2}\/|[A-Za-z0-9_-]+\/)[^\s`'",()]+|[A-Za-z0-9_$@#-]+)\.[A-Za-z0-9]{1,12})/g;
    const fragment = document.createDocumentFragment();
    let index = 0;
    let match = null;

    function appendText(value) {
      if (!value) return;
      fragment.appendChild(document.createTextNode(value));
    }

    function appendPathSpan(value) {
      if (!value) return;
      const span = document.createElement("span");
      span.className = "local-rtl-inline-ltr local-rtl-path-fragment";
      span.setAttribute("dir", "ltr");
      span.setAttribute(TEXT_WRAPPER_ATTR, "true");
      span.textContent = value;
      fragment.appendChild(span);
      wrappedTextNodes.add(span);
      touched.add(span);
    }

    while ((match = pathPattern.exec(text))) {
      appendText(text.slice(index, match.index));
      appendPathSpan(match[1]);
      index = match.index + match[1].length;
    }
    appendText(text.slice(index));

    if (!fragment.childNodes.length) return;
    textNode.parentNode.insertBefore(fragment, textNode);
    textNode.remove();
  }

  function detectMessageRole(element) {
    const unit = element.closest?.("[data-content-search-unit-key]");
    const key = unit?.getAttribute?.("data-content-search-unit-key") || "";
    if (key.endsWith(":user") || key.includes(":user:")) return "user";
    if (key.endsWith(":assistant") || key.includes(":assistant:")) return "assistant";
    const roleNode = element.closest?.("[data-message-author-role]");
    const role = roleNode?.getAttribute?.("data-message-author-role") || "";
    return role || "unknown";
  }

  function collectMatchedMessageDiagnostics() {
    const rows = [];
    const nodes = Array.from(document.querySelectorAll(`[${APPLIED_ATTR}="true"]`));
    for (const element of nodes) {
      if (!(element instanceof Element)) continue;
      const role = detectMessageRole(element);
      if (role !== "user" && role !== "assistant") continue;
      const computed = getComputedStyle(element);
      rows.push({
        role,
        tag: element.tagName.toLowerCase(),
        kind: element.getAttribute(KIND_ATTR) || "",
        className: element.getAttribute(LAST_CLASS_ATTR) || "",
        matchedSelector: element.getAttribute(MATCHED_SELECTOR_ATTR) || "",
        computedDirection: computed.direction,
        computedUnicodeBidi: computed.unicodeBidi,
        computedTextAlign: computed.textAlign,
        text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180),
      });
      if (rows.length >= 24) break;
    }
    return rows;
  }

  function collectCandidates() {
    const candidates = new Set();
    const selector = textContainerSelectors.join(", ");

    function addCandidate(node, matchedSelector) {
      if (!(node instanceof Element)) return;
      candidates.add(node);
      if (!candidateSelectors.has(node)) candidateSelectors.set(node, matchedSelector);
    }

    for (const allowSelector of allowSelectors) {
      let roots = [];
      try {
        roots = Array.from(document.querySelectorAll(allowSelector));
      } catch {
        continue;
      }

      for (const root of roots) {
        if (includeAllowRoots) addCandidate(root, allowSelector);
        if (!selector) continue;
        try {
          root.querySelectorAll(selector).forEach((node) => addCandidate(node, selector));
        } catch {
          // Ignore selector issues in local profile experiments.
        }
      }
    }

    return Array.from(candidates).filter((candidate) => {
      for (const other of candidates) {
        if (other === candidate || !candidate.contains(other)) continue;
        if (isInlineProtectedCandidate(other) || isInsideDeny(other)) continue;
        if (isListElement(candidate) && safeMatches(other, "li")) continue;
        if (isBlockTextCandidate(candidate) && isBlockTextCandidate(other)) return false;
      }
      return true;
    });
  }

  function scan() {
    try {
      const candidates = collectCandidates();
      for (const element of candidates) {
        if (!(element instanceof Element)) continue;
        if (!isVisible(element)) continue;
        if (!isInsideAllow(element)) continue;
        if (isEditable(element)) continue;

        stats.scanned += 1;
        const kind = classifyElement(element);
        if (kind === "unknown") continue;
        if (isPathLikeFragment((element.innerText || element.textContent || "").trim())) {
          element.classList.add("local-rtl-has-path-fragment");
        }
        if (["file-path", "url", "json-like"].includes(kind)) stats.skippedPathUrlJson += 1;
        applyKind(element, kind);
      }
    } catch (error) {
      stats.lastRuntimeError = String(error?.stack || error);
    }
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      stats.mutationBatches += 1;
      scan();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 120);
  }

  function cleanup() {
    observer?.disconnect();
    observer = null;
    cleanupCallbacks.splice(0).forEach((callback) => {
      try {
        callback();
      } catch {
        // Ignore cleanup errors for local runtime helpers.
      }
    });
    document.documentElement.removeAttribute("data-llm");
    document.documentElement.classList.remove(appClass);
    for (const element of touched) {
      const previousClass = element.getAttribute?.(LAST_CLASS_ATTR);
      if (previousClass) element.classList.remove(previousClass);
      element.classList.remove?.("local-rtl-text", "local-rtl-inline-ltr", "local-rtl-has-path-fragment", "local-rtl-editable-rtl", "local-rtl-editable-ltr");
      element.removeAttribute?.(EDITABLE_LOCK_ATTR);
      element.removeAttribute?.(APPLIED_ATTR);
      element.removeAttribute?.(KIND_ATTR);
      element.removeAttribute?.(LAST_CLASS_ATTR);
      element.removeAttribute?.(TEXT_WRAPPER_ATTR);
      element.removeAttribute?.(MATCHED_SELECTOR_ATTR);
      const previousDir = element.getAttribute?.(PREVIOUS_DIR_ATTR);
      if (previousDir !== null && previousDir !== undefined) {
        if (previousDir) element.setAttribute("dir", previousDir);
        else element.removeAttribute("dir");
        element.removeAttribute(PREVIOUS_DIR_ATTR);
      }
    }
    for (const span of wrappedTextNodes) {
      if (!span.parentNode) continue;
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    }
    for (const textNode of insertedRlmTextNodes) {
      textNode.remove();
    }
    insertedRlmTextNodes.clear();
    wrappedTextNodes.clear();
    touched.clear();
  }

  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setupEditableDirectionHandling();
  scan();

  window[GLOBAL_KEY] = {
    cleanup,
    scanNow: scan,
    getStats: () => ({ ...stats, matchedMessageStyles: collectMatchedMessageDiagnostics() }),
    profileName: profile.name || "unknown",
  };
})();
