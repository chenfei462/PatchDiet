import { analyzeDiffPreview } from "./insights.mjs";

const SAMPLE_DIFF_PATH = "/examples/sample-pr.diff";
const SAMPLE_PROJECT_NAME = "sample-cart-pr";
const PR_API_PATH = "/api/pr";
const INPUT_MODES = ["sample", "paste", "pr"];
const SCAN_SEQUENCE_MS = 1120;
const METRIC_ANIMATION_MS = 520;
const COPY_COMMAND_LABEL = "Copy verified CLI command";
const DEFAULT_CLI_PROOF_COMMAND = "patchdiet shrink --test \"npm test\"";
const PROOF_HANDOFF_COPY = "Browser previews likely noise; CLI verifies removals by rerunning tests.";
const VERIFIED_PATH_COPY = "Verified path: run patchdiet shrink to keep only removals where tests still pass.";
const STATUS_COPY = {
  "loading-sample": "Loading the bundled sample diff...",
  "fetching-pr": "Fetching public PR diff...",
  analyzing: "Analyzing the diff preview...",
  verified: "Preview updated. Run the CLI to verify removals with your configured checks."
};

/**
 * Workspace initializer for `/demo/workspace.html`.
 *
 * Every browser dependency is injectable so unit tests can drive the same
 * initializer from a fake document (`tests/unit/workspace-app.test.ts`) while
 * the real page passes `document`.
 */
export function initWorkspace(options = {}) {
  const root = options.root ?? document;
  const fetchImpl = options.fetchImpl ?? ((url) => fetch(url));
  const matchMedia = options.matchMedia ?? ((query) => window.matchMedia(query));
  const clipboard = options.clipboard
    ?? { writeText: (text) => navigator.clipboard.writeText(text) };
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());
  const onStateChange = options.onStateChange ?? (() => {});
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
  const frameHandles = new Set();
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

    if (scanTimer !== undefined) {
      clearTimeout(scanTimer);
      scanTimer = undefined;
    }
    if (reducedMotion.matches) {
      scanStage.dataset.scanState = "complete";
      return;
    }

    scanStage.dataset.scanState = "scanning";
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
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
      if (renderTimer !== undefined) {
        clearTimeout(renderTimer);
      }
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
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
      const payload = contentType.includes("application/json") ? await response.json() : undefined;
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
    if (scanTimer !== undefined) {
      clearTimeout(scanTimer);
      scanTimer = undefined;
    }
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
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
