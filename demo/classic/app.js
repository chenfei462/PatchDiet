import { analyzeDiffPreview } from "./insights.mjs";

const samplePath = "../examples/sample-pr.diff";
const diffInput = document.querySelector("#diff-input");
const prUrlInput = document.querySelector("#pr-url");
const projectInput = document.querySelector("#project-name");
const loadSampleButton = document.querySelector("#load-sample");
const analyzeButton = document.querySelector("#analyze");
const fetchPrButton = document.querySelector("#fetch-pr");
const copyCommandButton = document.querySelector("[data-copy-command]");
const proofCopyStatus = document.querySelector("[data-proof-copy-status]");
const resultPanel = document.querySelector("#result");
const suggestionList = document.querySelector("#suggestions");
const candidateStrip = document.querySelector("#candidate-strip");
const card = document.querySelector("#diet-card");
const scanStage = document.querySelector(".scan-stage");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const copyCommandLabel = "Copy verified CLI command";
const proofHandoffCopy = "Browser previews likely noise; CLI verifies removals by rerunning tests.";
const verifiedPathCopy = "Verified path: run patchdiet shrink to keep only removals where tests still pass.";
let currentPreview;
let scanTimer;

loadSampleButton.addEventListener("click", loadSample);
analyzeButton.addEventListener("click", render);
fetchPrButton.addEventListener("click", async () => {
  const fetched = await fetchPrUrl();
  if (fetched) {
    render();
  }
});
copyCommandButton.textContent = copyCommandLabel;
copyCommandButton.addEventListener("click", copyCliProofCommand);

async function loadSample() {
  try {
    const response = await fetch(samplePath);
    if (!response.ok) {
      throw new Error("sample diff not found");
    }
    diffInput.value = await response.text();
    projectInput.value = "sample-cart-pr";
    prUrlInput.value = "";
    render();
  } catch {
    resultPanel.querySelector("[data-status]").textContent =
      "Could not load the sample diff. Paste a unified diff instead.";
  }
}

diffInput.addEventListener("input", debounce(render, 300));
projectInput.addEventListener("input", debounce(render, 300));
prUrlInput.addEventListener("input", () => {
  const url = prUrlInput.value.trim();
  if (url) {
    resultPanel.querySelector("[data-status]").textContent =
      "Click Fetch public PR to load this public diff through the local demo backend.";
  }
});

await loadSample();

function render() {
  const diff = diffInput.value.trim();
  const projectName = projectInput.value.trim() || "pasted-diff";
  if (!diff) {
    currentPreview = undefined;
    resultPanel.querySelector("[data-status]").textContent = "Paste a unified diff or reset the sample.";
    return;
  }

  const preview = analyzeDiffPreview(diff, { projectName });
  currentPreview = preview;
  resultPanel.querySelector("[data-status]").textContent = preview.disclaimer;
  setText("[data-judge-headline]", preview.judgeMode.headline);
  setText("[data-judge-hook]", preview.judgeMode.hook);
  animateMetric("[data-judge-noise]", preview.judgeMode.reviewNoiseRemovedPercent);
  animateMetric("[data-judge-noise-inline]", preview.judgeMode.reviewNoiseRemovedPercent);
  animateMetric("[data-judge-minutes]", preview.judgeMode.humanAttentionSavedMinutes);
  animateMetric("[data-judge-minutes-inline]", preview.judgeMode.humanAttentionSavedMinutes);
  animateMetric("[data-reduction-before]", preview.input.changedLineCount);
  animateMetric("[data-reduction-after]", preview.output.changedLineCount);
  setText("[data-judge-command]", preview.judgeMode.cliProofCommand);
  setText("[data-judge-receipt]", `${proofHandoffCopy} Proof handoff: ${preview.judgeMode.cliProofCommand}.`);
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

  suggestionList.replaceChildren(...preview.suggestions.map((item, index) => renderSuggestion(item, preview.judgeMode, index)));
  candidateStrip.replaceChildren(...preview.suggestions.slice(0, 3).map((item, index) => renderCandidateChip(item, index)));
  if (preview.suggestions.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No obvious docs/generated preview candidates. Run the CLI for test-verified hunk analysis.";
    suggestionList.append(empty);
    const emptyChip = document.createElement("li");
    emptyChip.textContent = "No obvious preview candidates";
    candidateStrip.append(emptyChip);
  } else {
    selectCandidate(0);
  }

  card.querySelector("[data-card-project]").textContent = preview.projectName;
  card.querySelector("[data-card-saved]").textContent = `${preview.judgeMode.reviewNoiseRemovedPercent}%`;
  card.querySelector("[data-card-before]").textContent = `${preview.input.fileCount} files / ${preview.input.changedLineCount} lines`;
  card.querySelector("[data-card-after]").textContent = `${preview.output.fileCount} files / ${preview.output.changedLineCount} lines`;
  runScanSequence();
}

async function fetchPrUrl() {
  const url = prUrlInput.value.trim();
  if (!url) {
    resultPanel.querySelector("[data-status]").textContent = "Paste a public GitHub PR URL first.";
    return false;
  }

  fetchPrButton.disabled = true;
  fetchPrButton.setAttribute("aria-busy", "true");
  fetchPrButton.textContent = "Fetching...";
  resultPanel.querySelector("[data-status]").textContent = "Fetching public PR diff...";
  try {
    const response = await fetch(`/api/pr?url=${encodeURIComponent(url)}`);
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : undefined;
    if (!response.ok) {
      resultPanel.querySelector("[data-status]").textContent = payload?.error ?? "Could not fetch PR diff.";
      return false;
    }

    diffInput.value = payload.diff;
    projectInput.value = payload.projectName;
    return true;
  } catch {
    resultPanel.querySelector("[data-status]").textContent =
      "Could not fetch PR diff. Start the local demo server and try again.";
    return false;
  } finally {
    fetchPrButton.disabled = false;
    fetchPrButton.removeAttribute("aria-busy");
    fetchPrButton.textContent = "Fetch public PR";
  }
}

async function copyCliProofCommand() {
  const command = currentPreview?.judgeMode.cliProofCommand;
  if (!command) {
    proofCopyStatus.textContent = "Analyze a diff first.";
    return;
  }

  try {
    await navigator.clipboard.writeText(command);
    proofCopyStatus.textContent = "CLI proof command copied.";
  } catch {
    proofCopyStatus.textContent = command;
  }
}

function renderSuggestion(item, judgeMode, index) {
  const li = document.createElement("li");
  li.className = "candidate-card";
  li.tabIndex = 0;
  li.dataset.candidateIndex = String(index);
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", "false");
  const badge = document.createElement("em");
  badge.textContent = "CUT";
  const title = document.createElement("strong");
  title.textContent = item.filePath;
  title.className = "candidate-path";
  const meta = document.createElement("span");
  meta.textContent = `${item.category} - ${item.hunkHeader}`;
  const reason = document.createElement("p");
  reason.textContent = item.reason;
  const receipt = document.createElement("small");
  receipt.setAttribute("data-candidate-receipt", "");
  receipt.className = "candidate-receipt";
  const verificationReceipt = item.verificationReceipt
    ?? proofHandoffCopy;
  receipt.textContent = `${verificationReceipt} ${verifiedPathCopy} Verified CLI command: ${judgeMode.cliProofCommand}`;
  li.append(badge, title, meta, reason, receipt);
  li.addEventListener("mouseenter", () => selectCandidate(index));
  li.addEventListener("focus", () => selectCandidate(index));
  li.addEventListener("click", () => selectCandidate(index));
  return li;
}

function renderCandidateChip(item, index) {
  const li = document.createElement("li");
  li.tabIndex = 0;
  li.dataset.candidateIndex = String(index);
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", "false");
  const path = document.createElement("strong");
  path.textContent = item.filePath;
  const category = document.createElement("span");
  category.textContent = item.category;
  li.append(path, category);
  li.addEventListener("mouseenter", () => selectCandidate(index));
  li.addEventListener("focus", () => selectCandidate(index));
  li.addEventListener("click", () => {
    selectCandidate(index);
    suggestionList.querySelector(`[data-candidate-index="${index}"]`)?.focus();
  });
  return li;
}

function selectCandidate(index) {
  document.querySelectorAll("[data-candidate-index]").forEach((item) => {
    item.setAttribute("aria-selected", String(item.dataset.candidateIndex === String(index)));
  });
}

function runScanSequence() {
  if (!scanStage) {
    return;
  }

  clearTimeout(scanTimer);
  scanStage.dataset.scanState = reducedMotion.matches ? "complete" : "scanning";
  if (!reducedMotion.matches) {
    scanTimer = setTimeout(() => {
      scanStage.dataset.scanState = "complete";
    }, 1120);
  }
}

function animateMetric(selector, value) {
  const targetValue = Number(value);
  document.querySelectorAll(selector).forEach((target) => {
    const startValue = Number.parseInt(target.textContent ?? "0", 10) || 0;
    if (reducedMotion.matches || startValue === targetValue) {
      target.textContent = String(targetValue);
      return;
    }

    const startTime = performance.now();
    const duration = 520;
    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      target.textContent = String(Math.round(startValue + (targetValue - startValue) * eased));
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

function setMetric(name, value) {
  const target = document.querySelector(`[data-metric="${name}"]`);
  if (target) {
    target.textContent = String(value);
  }
}

function setText(selector, value) {
  const target = document.querySelector(selector);
  if (target) {
    target.textContent = String(value);
  }
}

function debounce(fn, ms) {
  let timeout;
  return () => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, ms);
  };
}
