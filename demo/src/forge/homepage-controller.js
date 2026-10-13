import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger.js";

import { getHomepageFrame } from "../motion/homepage-timeline.js";

const SCENE_NAMES = ["intake", "gates", "receipt", "evidence", "handoff"];
const LOAD_GROUPS = ["forge", "header", "kicker", "headline", "summary", "actions"];
const LOAD_STEPS = [
  { at: 0, duration: 0.36, y: 8 },
  { at: 0.16, duration: 0.32, y: -8 },
  { at: 0.38, duration: 0.24, y: 8 },
  { at: 0.52, duration: 0.3, y: 12 },
  { at: 0.72, duration: 0.28, y: 10 },
  { at: 0.94, duration: 0.3, y: 8 }
];
let defaultScrollTriggerRegistered = false;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function createHomepageController(options = {}) {
  const {
    scene,
    policy = { tier: "static", pixelRatio: 1 },
    pointerTarget = typeof window === "undefined" ? null : window,
    resizeTarget = typeof window === "undefined" ? null : window,
    body = typeof document === "undefined" ? null : document.body,
    story = typeof document === "undefined" ? null : document.querySelector("#homepage-story"),
    viewport = typeof window === "undefined" ? null : window,
    loadTargets = [],
    pointerScheduler = {
      request: (callback) =>
        typeof globalThis.requestAnimationFrame === "function"
          ? globalThis.requestAnimationFrame(callback)
          : 0,
      cancel: (id) => {
        if (typeof globalThis.cancelAnimationFrame === "function") {
          globalThis.cancelAnimationFrame(id);
        }
      }
    }
  } = options;
  const usesDefaultAdapters = options.gsapAdapter === undefined && options.scroll === undefined;
  const gsapAdapter = options.gsapAdapter ?? gsap;
  const scroll = options.scroll ?? ScrollTrigger;
  let started = false;
  let starting = false;
  let destroyed = false;
  let pointerListenerAttached = false;
  let resizeListenerAttached = false;
  let pointerEnabled = policy.tier !== "static";
  let progress = 0;
  let trigger = null;
  let loadTimeline = null;
  let pointerFrameId = null;
  const currentPointer = { x: 0, y: 0 };
  const targetPointer = { x: 0, y: 0 };

  if (usesDefaultAdapters && !defaultScrollTriggerRegistered) {
    gsap.registerPlugin(ScrollTrigger);
    defaultScrollTriggerRegistered = true;
  }

  function applyProgress(nextProgress) {
    if (destroyed) return;
    const frame = getHomepageFrame(nextProgress);
    progress = frame.progress;
    scene?.setHomepageFrame?.(frame);
    if (body?.dataset) {
      body.dataset.activeScene = SCENE_NAMES[frame.scene];
    }

    const shouldEnablePointer = policy.tier !== "static" && progress <= 0.3;
    if (pointerEnabled && !shouldEnablePointer) {
      cancelPointerFrame();
      currentPointer.x = 0;
      currentPointer.y = 0;
      targetPointer.x = 0;
      targetPointer.y = 0;
      scene?.setPointer?.(0, 0);
    }
    pointerEnabled = shouldEnablePointer;
  }

  function handlePointerMove(event) {
    if (destroyed || !pointerEnabled || policy.tier === "static") return;
    const width = Number.isFinite(viewport?.innerWidth) && viewport.innerWidth >= 1
      ? viewport.innerWidth
      : 1;
    const height = Number.isFinite(viewport?.innerHeight) && viewport.innerHeight >= 1
      ? viewport.innerHeight
      : 1;
    const clientX = Number.isFinite(event?.clientX) ? event.clientX : width / 2;
    const clientY = Number.isFinite(event?.clientY) ? event.clientY : height / 2;
    const offsetX = (clientX / width - 0.5) * 12;
    const offsetY = (clientY / height - 0.5) * 12;
    targetPointer.x = clamp(offsetX, -6, 6) / 6;
    targetPointer.y = clamp(offsetY, -6, 6) / 6;
    schedulePointerFrame();
  }

  function schedulePointerFrame() {
    if (pointerFrameId !== null || destroyed || !pointerEnabled) return;
    pointerFrameId = pointerScheduler.request(updatePointer);
  }

  function updatePointer() {
    pointerFrameId = null;
    if (destroyed || !pointerEnabled) return;
    const nextX = currentPointer.x + (targetPointer.x - currentPointer.x) * 0.22;
    const nextY = currentPointer.y + (targetPointer.y - currentPointer.y) * 0.22;
    const settledX = Math.abs(targetPointer.x - nextX) <= 0.001;
    const settledY = Math.abs(targetPointer.y - nextY) <= 0.001;
    currentPointer.x = settledX ? targetPointer.x : nextX;
    currentPointer.y = settledY ? targetPointer.y : nextY;
    scene?.setPointer?.(currentPointer.x, currentPointer.y);
    if (!settledX || !settledY) schedulePointerFrame();
  }

  function cancelPointerFrame() {
    if (pointerFrameId === null) return;
    pointerScheduler.cancel(pointerFrameId);
    pointerFrameId = null;
  }

  function handleResize() {
    if (!destroyed) scene?.resize?.();
  }

  function createLoadTimeline() {
    if (policy.tier === "static" || typeof gsapAdapter?.timeline !== "function") return null;
    let timeline = null;
    try {
      timeline = gsapAdapter.timeline();
      if (!timeline || typeof timeline.fromTo !== "function") return timeline ?? null;
      const groups = normalizeLoadTargets(loadTargets);
      for (let index = 0; index < LOAD_GROUPS.length; index += 1) {
        const target = groups[LOAD_GROUPS[index]];
        if (!hasTargets(target)) continue;
        const step = LOAD_STEPS[index];
        timeline.fromTo(
          target,
          { opacity: 0, y: step.y },
          { opacity: 1, y: 0, duration: step.duration, ease: "power2.out" },
          step.at
        );
      }
      return timeline;
    } catch {
      safely(() => timeline?.kill?.());
      restoreLoadTargets(loadTargets);
      return null;
    }
  }

  function start() {
    if (started || starting || destroyed) return;
    starting = true;
    try {
      applyProgress(0);

      if (typeof pointerTarget?.addEventListener === "function") {
        pointerTarget.addEventListener("pointermove", handlePointerMove, { passive: true });
        pointerListenerAttached = true;
      }
      if (typeof resizeTarget?.addEventListener === "function") {
        resizeTarget.addEventListener("resize", handleResize, { passive: true });
        resizeListenerAttached = true;
      }

      if (policy.tier !== "static" && story && typeof scroll?.create === "function") {
        trigger = scroll.create({
          trigger: story,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.45,
          onUpdate: (self) => applyProgress(self?.progress)
        });
      }

      loadTimeline = createLoadTimeline();
      scene?.renderOnce?.();
      scene?.start?.();
      started = true;
      starting = false;
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    started = false;
    starting = false;
    cancelPointerFrame();
    safely(() => trigger?.kill?.());
    safely(() => loadTimeline?.kill?.());
    if (pointerListenerAttached) {
      safely(() => pointerTarget?.removeEventListener?.("pointermove", handlePointerMove));
      pointerListenerAttached = false;
    }
    if (resizeListenerAttached) {
      safely(() => resizeTarget?.removeEventListener?.("resize", handleResize));
      resizeListenerAttached = false;
    }
    safely(() => scene?.destroy?.());
  }

  function destroy() {
    cleanup();
  }

  function getState() {
    return { started, destroyed, progress, activeScene: SCENE_NAMES[getHomepageFrame(progress).scene] };
  }

  return { start, destroy, getState };
}

function normalizeLoadTargets(loadTargets) {
  if (!Array.isArray(loadTargets)) return loadTargets ?? {};
  return Object.fromEntries(LOAD_GROUPS.map((name, index) => [name, loadTargets[index]]));
}

function hasTargets(target) {
  return Array.isArray(target) ? target.length > 0 : target != null;
}

function restoreLoadTargets(loadTargets) {
  const groups = normalizeLoadTargets(loadTargets);
  for (const name of LOAD_GROUPS) {
    for (const target of expandTargets(groups[name])) {
      if (!target?.style) continue;
      target.style.opacity = "";
      target.style.transform = "";
    }
  }
}

function expandTargets(target) {
  if (target == null) return [];
  if (Array.isArray(target)) return target.flatMap(expandTargets);
  if (
    typeof target !== "string" &&
    !target.style &&
    Number.isFinite(target.length) &&
    target.length >= 0
  ) {
    return Array.from(target).flatMap(expandTargets);
  }
  return [target];
}

function safely(action) {
  try {
    action();
  } catch {
    // Cleanup is best-effort and must not mask the initiating failure.
  }
}
