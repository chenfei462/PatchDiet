const copyInstallButton = document.querySelector("[data-copy-install-command]");
const installCopyStatus = document.querySelector("[data-install-copy-status]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const installCommand = 'npm ci && npm run build\nnode dist/packages/cli/src/index.js shrink --test "npm test"';
let sceneProgressFrame;
let narrativeScenes = [];

copyInstallButton?.addEventListener("click", copyInstallCommand);
initVerificationMachine();
initNarrativeScenes();

async function copyInstallCommand() {
  try {
    await navigator.clipboard.writeText(installCommand);
    installCopyStatus.textContent = "Build and shrink command copied.";
  } catch {
    installCopyStatus.textContent = installCommand.replace("\n", " / ");
  }
}

function initVerificationMachine() {
  const machine = document.querySelector("[data-verification-machine]");
  if (!machine) {
    return;
  }

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    machine.dataset.sceneState = "active";
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return;
    }
    machine.dataset.sceneState = "active";
    observer.disconnect();
  }, { threshold: 0.2 });
  observer.observe(machine);
}

function initNarrativeScenes() {
  narrativeScenes = [...document.querySelectorAll("[data-narrative-scene]")];
  if (narrativeScenes.length === 0) {
    return;
  }

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    narrativeScenes.forEach((scene) => {
      scene.dataset.sceneState = "active";
      scene.style.setProperty("--scene-progress", "1");
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.dataset.sceneState = "active";
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -12%", threshold: 0.12 });

  narrativeScenes.forEach((scene) => observer.observe(scene));
  window.addEventListener("scroll", requestSceneProgressUpdate, { passive: true });
  window.addEventListener("resize", requestSceneProgressUpdate, { passive: true });
  updateSceneProgress();
}

function requestSceneProgressUpdate() {
  if (sceneProgressFrame) {
    return;
  }
  sceneProgressFrame = requestAnimationFrame(updateSceneProgress);
}

function updateSceneProgress() {
  const viewportHeight = window.innerHeight;
  narrativeScenes.forEach((scene) => {
    const bounds = scene.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (viewportHeight - bounds.top) / (viewportHeight + bounds.height)));
    scene.style.setProperty("--scene-progress", progress.toFixed(3));
  });
  sceneProgressFrame = undefined;
}
