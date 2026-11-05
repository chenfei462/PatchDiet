import "./chunks/chunk-54KOYG5C.js";

// demo/forge/insights.mjs
function parseUnifiedDiff(input) {
  const lines = input.split(/\r?\n/);
  const files = [];
  let currentFile;
  let currentHunk;
  let pendingOldPath;
  let pendingNewPath;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = void 0;
      currentFile = void 0;
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      pendingOldPath = match?.[1];
      pendingNewPath = match?.[2];
      continue;
    }
    if (line.startsWith("--- a/")) {
      pendingOldPath = line.slice("--- a/".length);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      pendingNewPath = line.slice("+++ b/".length);
      currentFile = { path: pendingNewPath, hunks: [] };
      files.push(currentFile);
      currentHunk = void 0;
      continue;
    }
    if (line.startsWith("Binary files ") && line.includes(" and ") && line.endsWith(" differ")) {
      const path = parseBinaryPath(line);
      if (path) {
        files.push({ path, hunks: [{ header: "Binary files differ", lines: [], binary: true }] });
      }
      currentFile = void 0;
      currentHunk = void 0;
      continue;
    }
    if (line.startsWith("GIT binary patch")) {
      const path = pendingNewPath ?? pendingOldPath;
      if (path) {
        files.push({ path, hunks: [{ header: "GIT binary patch", lines: [], binary: true }] });
      }
      currentFile = void 0;
      currentHunk = void 0;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!currentFile) {
        continue;
      }
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
    } else {
      currentHunk.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return { files };
}
function summarizeDiff(parsed) {
  const allLines = parsed.files.flatMap((file) => file.hunks).flatMap((hunk) => hunk.lines);
  const addedLineCount = allLines.filter((line) => line.kind === "add").length;
  const removedLineCount = allLines.filter((line) => line.kind === "remove").length;
  return {
    fileCount: parsed.files.length,
    hunkCount: parsed.files.reduce((sum, file) => sum + file.hunks.length, 0),
    addedLineCount,
    removedLineCount,
    changedLineCount: addedLineCount + removedLineCount
  };
}
function analyzeDiffPreview(diff, options = {}) {
  const parsed = parseUnifiedDiff(diff);
  const suggestions = parsed.files.flatMap((file) => getPreviewSuggestions(file));
  const suggestedPaths = new Set(suggestions.map((item) => item.filePath));
  const keptFiles = parsed.files.filter((file) => !suggestedPaths.has(file.path));
  const input = summarizeDiff(parsed);
  const output = summarizeDiff({ files: keptFiles });
  const metrics = buildReviewMetrics(input, output, suggestions.length);
  return {
    projectName: options.projectName ?? "pasted-diff",
    mode: "preview",
    verificationStatus: "preview-only",
    input,
    output,
    metrics,
    suggestions,
    disclaimer: "Web demo preview uses local diff heuristics only. Run patchdiet shrink for test-verified cleanup decisions.",
    judgeMode: buildJudgeModeSummary(metrics)
  };
}
function buildJudgeModeSummary(metrics) {
  return {
    headline: "Live PR Liposuction",
    hook: "AI wrote more. Humans review less.",
    verificationStatus: "preview-only",
    verificationReceipt: previewVerificationReceipt(),
    reviewNoiseRemovedPercent: metrics.changedLineReductionPercent,
    humanAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
    cliProofCommand: 'patchdiet shrink --test "npm test"'
  };
}
function buildReviewMetrics(input, output, suggestedDeletionHunks) {
  const reviewMinutesBefore = estimateReviewMinutes(input);
  const reviewMinutesAfter = estimateReviewMinutes(output);
  return {
    before: {
      fileCount: input.fileCount,
      hunkCount: input.hunkCount,
      changedLineCount: input.changedLineCount
    },
    after: {
      fileCount: output.fileCount,
      hunkCount: output.hunkCount,
      changedLineCount: output.changedLineCount
    },
    changedLineReductionPercent: percentReduced(input.changedLineCount, output.changedLineCount),
    fileReductionPercent: percentReduced(input.fileCount, output.fileCount),
    hunkReductionPercent: percentReduced(input.hunkCount, output.hunkCount),
    savedReviewTimePercent: percentReduced(reviewMinutesBefore, reviewMinutesAfter),
    suggestedDeletionHunks,
    reviewMinutesBefore,
    reviewMinutesAfter
  };
}
function getPreviewSuggestions(file) {
  const category = classifyPreviewFile(file.path);
  if (!category) {
    return [];
  }
  return file.hunks.map((hunk) => ({
    filePath: file.path,
    hunkHeader: hunk.header,
    category,
    reason: previewReason(category),
    verificationReceipt: previewVerificationReceipt()
  }));
}
function previewReason(category) {
  switch (category) {
    case "docs-only":
      return "preview candidate: docs-only change that may be outside the PR intent";
    case "generated-like":
      return "preview candidate: generated-like artifact that reviewers may not need to inspect";
    default:
      return "preview candidate: run patchdiet shrink to verify with tests";
  }
}
function previewVerificationReceipt() {
  return 'Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test "npm test"; only removals that still pass checks should be treated as verified.';
}
function classifyPreviewFile(filePath) {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (normalized === "readme.md" || normalized.startsWith("docs/") || normalized.endsWith(".md") || normalized.endsWith(".mdx") || normalized.endsWith(".txt")) {
    return "docs-only";
  }
  if (normalized.startsWith("dist/") || normalized.includes("/dist/") || normalized.startsWith("build/") || normalized.includes("/build/") || normalized.endsWith(".generated.ts") || normalized.endsWith(".generated.js") || normalized.endsWith(".min.js") || normalized.endsWith(".snap")) {
    return "generated-like";
  }
  return void 0;
}
function parseBinaryPath(line) {
  const match = /^Binary files (.+) and (.+) differ$/.exec(line);
  const newPath = normalizeBinaryEndpoint(match?.[2]);
  const oldPath = normalizeBinaryEndpoint(match?.[1]);
  return newPath ?? oldPath;
}
function normalizeBinaryEndpoint(value) {
  if (!value || value === "/dev/null") {
    return void 0;
  }
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}
function estimateReviewMinutes(summary) {
  return Math.max(1, Math.ceil(summary.changedLineCount / 20 + summary.fileCount * 0.75 + summary.hunkCount * 0.5));
}
function percentReduced(before, after) {
  if (before <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((before - after) / before * 100)));
}

// demo/forge/app.js
var SAMPLE_DIFF_PATH = "/examples/sample-pr.diff";
var SAMPLE_PROJECT_NAME = "sample-cart-pr";
var PR_API_PATH = "/api/pr";
var INPUT_MODES = ["sample", "paste", "pr"];
var SCAN_SEQUENCE_MS = 1120;
var METRIC_ANIMATION_MS = 520;
var COPY_COMMAND_LABEL = "Copy verified CLI command";
var DEFAULT_CLI_PROOF_COMMAND = 'patchdiet shrink --test "npm test"';
var PROOF_HANDOFF_COPY = "Browser previews likely noise; CLI verifies removals by rerunning tests.";
var VERIFIED_PATH_COPY = "Verified path: run patchdiet shrink to keep only removals where tests still pass.";
var STATUS_COPY = {
  "loading-sample": "Loading the bundled sample diff...",
  "fetching-pr": "Fetching public PR diff...",
  analyzing: "Analyzing the diff preview...",
  verified: "Preview updated. Run the CLI to verify removals with your configured checks."
};
function initWorkspace(options = {}) {
  const root = options.root ?? document;
  const fetchImpl = options.fetchImpl ?? ((url) => fetch(url));
  const matchMedia = options.matchMedia ?? ((query) => window.matchMedia(query));
  const clipboard = options.clipboard ?? { writeText: (text) => navigator.clipboard.writeText(text) };
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());
  const onStateChange = options.onStateChange ?? (() => {
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const diffInput = root.querySelector("#diff-input");
  const projectInput = root.querySelector("#project-name");
  const prUrlInput = root.querySelector("#pr-url");
  const loadSampleButton = root.querySelector("#load-sample");
  const analyzeButton = root.querySelector("#analyze");
  const fetchPrButton = root.querySelector("#fetch-pr");
  const statusElement = root.querySelector("#workspace-status");
  const suggestionList = root.querySelector("#suggestions");
  const candidateStrip = root.querySelector("#candidate-strip");
  const scanStage = root.querySelector("[data-demo-scan-stage]");
  const copyCommandButton = root.querySelector("[data-copy-command]");
  const proofCopyStatus = root.querySelector("[data-proof-copy-status]");
  const card = root.querySelector("#diet-card");
  const modeButtons = [...root.querySelectorAll("[data-input-mode]")];
  const inputPanels = [...root.querySelectorAll("[data-input-panel]")];
  const listeners = [];
  const frameHandles = /* @__PURE__ */ new Set();
  let currentPreview;
  let scanTimer;
  let renderTimer;
  let destroyed = false;
  function listen(target, type, listener) {
    if (!target) return;
    target.addEventListener(type, listener);
    listeners.push({ target, type, listener });
  }
  function emitState(state) {
    if (destroyed) return;
    if (statusElement) {
      statusElement.textContent = state.message ?? STATUS_COPY[state.type] ?? statusElement.textContent;
    }
    onStateChange(state);
  }
  function setText(selector, value) {
    const target = root.querySelector(selector);
    if (target) {
      target.textContent = String(value);
    }
  }
  function setMetric(name, value) {
    setText(`[data-metric="${name}"]`, value);
  }
  function scheduleFrame(callback) {
    const handle = requestFrame(callback);
    frameHandles.add(handle);
  }
  function animateMetric(selector, value) {
    const targetValue = Number(value);
    root.querySelectorAll(selector).forEach((target) => {
      const startValue = Number.parseInt(target.textContent ?? "0", 10) || 0;
      if (reducedMotion.matches || startValue === targetValue) {
        target.textContent = String(targetValue);
        return;
      }
      const startTime = now();
      const tick = (frameNow) => {
        if (destroyed) return;
        const progress = Math.min((frameNow - startTime) / METRIC_ANIMATION_MS, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        target.textContent = String(Math.round(startValue + (targetValue - startValue) * eased));
        if (progress < 1) {
          scheduleFrame(tick);
        }
      };
      scheduleFrame(tick);
    });
  }
  function runScanSequence() {
    if (!scanStage) {
      return;
    }
    if (scanTimer !== void 0) {
      clearTimeout(scanTimer);
      scanTimer = void 0;
    }
    if (reducedMotion.matches) {
      scanStage.dataset.scanState = "complete";
      return;
    }
    scanStage.dataset.scanState = "scanning";
    scanTimer = setTimeout(() => {
      scanTimer = void 0;
      if (!destroyed) {
        scanStage.dataset.scanState = "complete";
      }
    }, SCAN_SEQUENCE_MS);
  }
  function renderCandidateCard(item, preview, index) {
    const li = root.createElement("li");
    li.className = "candidate-card";
    li.tabIndex = 0;
    li.dataset.candidateIndex = String(index);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const badge = root.createElement("em");
    badge.textContent = "CUT";
    const title = root.createElement("strong");
    title.textContent = item.filePath;
    title.className = "candidate-path";
    const meta = root.createElement("span");
    meta.textContent = `${item.category} - ${item.hunkHeader}`;
    const reason = root.createElement("p");
    reason.textContent = item.reason;
    const receipt = root.createElement("small");
    receipt.setAttribute("data-candidate-receipt", "");
    receipt.className = "candidate-receipt";
    const verificationReceipt = item.verificationReceipt ?? preview.judgeMode.verificationReceipt;
    receipt.textContent = `${verificationReceipt} ${VERIFIED_PATH_COPY} Verified CLI command: ${preview.judgeMode.cliProofCommand}`;
    li.append(badge, title, meta, reason, receipt);
    return li;
  }
  function renderCandidateChip(item, index) {
    const li = root.createElement("li");
    li.tabIndex = 0;
    li.dataset.candidateIndex = String(index);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const path = root.createElement("strong");
    path.textContent = item.filePath;
    const category = root.createElement("span");
    category.textContent = item.category;
    li.append(path, category);
    return li;
  }
  function selectCandidate(index) {
    root.querySelectorAll("[data-candidate-index]").forEach((item) => {
      item.setAttribute("aria-selected", String(item.dataset.candidateIndex === String(index)));
    });
  }
  function renderCandidates(preview) {
    const items = preview.suggestions;
    if (suggestionList) {
      suggestionList.replaceChildren(
        ...items.map((item, index) => renderCandidateCard(item, preview, index))
      );
      if (items.length === 0) {
        const empty = root.createElement("li");
        empty.textContent = "No obvious docs/generated preview candidates. Run the CLI for test-verified hunk analysis.";
        suggestionList.append(empty);
      }
    }
    if (candidateStrip) {
      candidateStrip.replaceChildren(
        ...items.slice(0, 3).map((item, index) => renderCandidateChip(item, index))
      );
      if (items.length === 0) {
        const emptyChip = root.createElement("li");
        emptyChip.textContent = "No obvious preview candidates";
        candidateStrip.append(emptyChip);
      }
    }
    if (items.length > 0) {
      selectCandidate(0);
    }
  }
  function renderDietCard(preview) {
    if (!card) {
      return;
    }
    const setCardText = (selector, value) => {
      const target = card.querySelector(selector);
      if (target) {
        target.textContent = String(value);
      }
    };
    setCardText("[data-card-project]", preview.projectName);
    setCardText("[data-card-saved]", `${preview.judgeMode.reviewNoiseRemovedPercent}%`);
    setCardText("[data-card-before]", `${preview.input.fileCount} files / ${preview.input.changedLineCount} lines`);
    setCardText("[data-card-after]", `${preview.output.fileCount} files / ${preview.output.changedLineCount} lines`);
  }
  function renderPreview(diff, projectName) {
    const preview = analyzeDiffPreview(diff, { projectName });
    currentPreview = preview;
    setText("[data-judge-headline]", preview.judgeMode.headline);
    setText("[data-judge-hook]", preview.judgeMode.hook);
    setText("[data-judge-command]", preview.judgeMode.cliProofCommand);
    setText("[data-judge-receipt]", `${PROOF_HANDOFF_COPY} Proof handoff: ${preview.judgeMode.cliProofCommand}.`);
    animateMetric("[data-judge-noise]", preview.judgeMode.reviewNoiseRemovedPercent);
    animateMetric("[data-judge-noise-inline]", preview.judgeMode.reviewNoiseRemovedPercent);
    animateMetric("[data-judge-minutes]", preview.judgeMode.humanAttentionSavedMinutes);
    animateMetric("[data-judge-minutes-inline]", preview.judgeMode.humanAttentionSavedMinutes);
    animateMetric("[data-reduction-before]", preview.input.changedLineCount);
    animateMetric("[data-reduction-after]", preview.output.changedLineCount);
    setMetric("files-before", preview.input.fileCount);
    setMetric("files-after", preview.output.fileCount);
    setMetric("lines-before", preview.input.changedLineCount);
    setMetric("lines-after", preview.output.changedLineCount);
    setMetric("hunks-before", preview.input.hunkCount);
    setMetric("hunks-after", preview.output.hunkCount);
    setMetric("saved-time", `${preview.metrics.savedReviewTimePercent}%`);
    setMetric("deletion-hunks", preview.metrics.suggestedDeletionHunks);
    setMetric("review-before", `${preview.metrics.reviewMinutesBefore}m`);
    setMetric("review-after", `${preview.metrics.reviewMinutesAfter}m`);
    renderCandidates(preview);
    renderDietCard(preview);
    runScanSequence();
  }
  function selectInputMode(mode) {
    if (!INPUT_MODES.includes(mode)) {
      throw new Error(`Unsupported input mode "${mode}". Expected one of: ${INPUT_MODES.join(", ")}.`);
    }
    modeButtons.forEach((button) => {
      const isActive = button.dataset.inputMode === mode;
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", String(isActive ? 0 : -1));
    });
    inputPanels.forEach((panel) => {
      const isActive = panel.dataset.inputPanel === mode;
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", String(!isActive));
    });
    return mode;
  }
  function debounceRender(callback, ms) {
    return () => {
      if (destroyed) return;
      if (renderTimer !== void 0) {
        clearTimeout(renderTimer);
      }
      renderTimer = setTimeout(() => {
        renderTimer = void 0;
        callback();
      }, ms);
    };
  }
  function livePreview() {
    if (destroyed) return;
    const diff = diffInput?.value.trim() ?? "";
    if (diff) {
      renderPreview(diff, projectInput?.value.trim() || "pasted-diff");
    }
  }
  async function loadSampleDiff() {
    if (destroyed) return;
    loadSampleButton.disabled = true;
    emitState({ type: "loading-sample" });
    try {
      const response = await fetchImpl(SAMPLE_DIFF_PATH);
      if (!response.ok) {
        throw new Error("sample diff not found");
      }
      const diff = await response.text();
      if (destroyed) return;
      if (diffInput) diffInput.value = diff;
      if (projectInput) projectInput.value = SAMPLE_PROJECT_NAME;
      if (prUrlInput) prUrlInput.value = "";
      renderPreview(diff, SAMPLE_PROJECT_NAME);
      emitState({ type: "verified" });
    } catch {
      emitState({
        type: "error",
        message: "Could not load the sample diff. Paste a unified diff instead."
      });
    } finally {
      if (!destroyed) {
        loadSampleButton.disabled = false;
      }
    }
  }
  async function analyzeCurrentDiff() {
    if (destroyed) return;
    analyzeButton.disabled = true;
    emitState({ type: "analyzing" });
    try {
      const diff = diffInput?.value.trim() ?? "";
      if (!diff) {
        emitState({
          type: "error",
          message: "Paste a unified diff to analyze, or reload the bundled sample."
        });
        return;
      }
      renderPreview(diff, projectInput?.value.trim() || "pasted-diff");
      emitState({ type: "verified" });
    } finally {
      if (!destroyed) {
        analyzeButton.disabled = false;
      }
    }
  }
  async function fetchPublicPr() {
    if (destroyed) return;
    const url = prUrlInput?.value.trim() ?? "";
    if (!url) {
      emitState({ type: "error", message: "Paste a public GitHub PR URL first." });
      return;
    }
    fetchPrButton.disabled = true;
    fetchPrButton.setAttribute("aria-busy", "true");
    emitState({ type: "fetching-pr" });
    try {
      const response = await fetchImpl(`${PR_API_PATH}?url=${encodeURIComponent(url)}`);
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json") ? await response.json() : void 0;
      if (destroyed) return;
      if (!response.ok) {
        emitState({ type: "error", message: payload?.error ?? "Could not fetch PR diff." });
        return;
      }
      if (diffInput) diffInput.value = payload.diff;
      if (projectInput && payload.projectName) projectInput.value = payload.projectName;
      emitState({ type: "analyzing" });
      renderPreview(payload.diff, payload.projectName ?? "fetched-pr");
      emitState({ type: "verified" });
    } catch {
      if (!destroyed) {
        emitState({
          type: "error",
          message: "Could not fetch PR diff. Start the local demo server and try again."
        });
      }
    } finally {
      if (!destroyed) {
        fetchPrButton.disabled = false;
        fetchPrButton.removeAttribute("aria-busy");
      }
    }
  }
  async function copyCliProofCommand() {
    const command = currentPreview?.judgeMode.cliProofCommand ?? DEFAULT_CLI_PROOF_COMMAND;
    try {
      await clipboard.writeText(command);
      if (proofCopyStatus) {
        proofCopyStatus.textContent = "CLI proof command copied.";
      }
    } catch {
      if (proofCopyStatus) {
        proofCopyStatus.textContent = command;
      }
    }
  }
  function handleCandidatePointer(event) {
    const target = event.target?.closest?.("[data-candidate-index]");
    if (!target) return;
    selectCandidate(Number(target.dataset.candidateIndex));
  }
  function handleCandidateChipClick(event) {
    const target = event.target?.closest?.("[data-candidate-index]");
    if (!target) return;
    selectCandidate(Number(target.dataset.candidateIndex));
    const candidateCard = suggestionList?.querySelector(`[data-candidate-index="${target.dataset.candidateIndex}"]`);
    candidateCard?.focus?.();
  }
  function handleModeKeydown(event) {
    const current = modeButtons.indexOf(event.currentTarget);
    if (current === -1) return;
    const last = modeButtons.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowDown: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      ArrowUp: current === 0 ? last : current - 1,
      Home: 0,
      End: last
    }[event.key];
    if (next === void 0) return;
    event.preventDefault();
    const target = modeButtons[next];
    selectInputMode(target.dataset.inputMode);
    target.focus?.();
  }
  listen(loadSampleButton, "click", loadSampleDiff);
  listen(analyzeButton, "click", analyzeCurrentDiff);
  listen(fetchPrButton, "click", fetchPublicPr);
  listen(copyCommandButton, "click", copyCliProofCommand);
  if (copyCommandButton) {
    copyCommandButton.textContent = COPY_COMMAND_LABEL;
  }
  listen(diffInput, "input", debounceRender(livePreview, 300));
  listen(projectInput, "input", debounceRender(livePreview, 300));
  for (const button of modeButtons) {
    listen(button, "click", () => {
      selectInputMode(button.dataset.inputMode);
    });
    listen(button, "keydown", handleModeKeydown);
  }
  listen(suggestionList, "click", handleCandidatePointer);
  listen(suggestionList, "mouseover", handleCandidatePointer);
  listen(suggestionList, "focusin", handleCandidatePointer);
  listen(candidateStrip, "click", handleCandidateChipClick);
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const { target, type, listener } of listeners.splice(0)) {
      target.removeEventListener(type, listener);
    }
    for (const handle of [...frameHandles]) {
      cancelFrame(handle);
    }
    frameHandles.clear();
    if (scanTimer !== void 0) {
      clearTimeout(scanTimer);
      scanTimer = void 0;
    }
    if (renderTimer !== void 0) {
      clearTimeout(renderTimer);
      renderTimer = void 0;
    }
    if (loadSampleButton) loadSampleButton.disabled = false;
    if (analyzeButton) analyzeButton.disabled = false;
    if (fetchPrButton) {
      fetchPrButton.disabled = false;
      fetchPrButton.removeAttribute("aria-busy");
    }
  }
  void loadSampleDiff();
  return {
    analyzeCurrentDiff,
    destroy,
    selectInputMode
  };
}

// demo/forge/src/workspace-entry.js
if (typeof document !== "undefined") {
  const workspace = initWorkspace();
  window.addEventListener("pagehide", () => workspace.destroy(), { once: true });
}
//# sourceMappingURL=workspace.js.map
