import { createForgeScene } from "./forge/create-forge-scene.js";
import { createHomepageController } from "./forge/homepage-controller.js";
import { resolveMotionPolicy } from "./motion/policy.js";

if (typeof document !== "undefined") {
  bootstrapHomepage();
}

export function bootstrapHomepage({
  documentRef = globalThis.document,
  windowRef = globalThis.window ?? globalThis,
  createScene = createForgeScene,
  createController = createHomepageController
} = {}) {
  const root = documentRef?.documentElement;
  const canvas = documentRef?.querySelector?.("#forge-canvas");
  if (!documentRef || !canvas) {
    root?.classList?.add("no-webgl");
    return null;
  }

  const policy = resolveMotionPolicy({
    reducedMotion: windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    width: windowRef.innerWidth,
    dpr: windowRef.devicePixelRatio
  });

  let scene;
  let controller;
  try {
    scene = createScene({ canvas, policy });
    controller = createController({
      scene,
      policy,
      pointerTarget: windowRef,
      resizeTarget: windowRef,
      body: documentRef.body,
      story: documentRef.querySelector("#homepage-story"),
      viewport: windowRef,
      loadTargets: {
        forge: [canvas, documentRef.querySelector(".forge-fallback")].filter(Boolean),
        header: documentRef.querySelector(".site-header"),
        kicker: documentRef.querySelector("#hero .scene-kicker"),
        headline: documentRef.querySelector("#hero h1"),
        summary: [
          documentRef.querySelector("#hero .hero-thesis"),
          documentRef.querySelector("#hero .hero-summary")
        ].filter(Boolean),
        actions: [
          documentRef.querySelector("#hero .actions"),
          documentRef.querySelector("#hero .hero-metric")
        ].filter(Boolean)
      }
    });
    controller.start();
    windowRef.addEventListener?.("pagehide", () => controller.destroy(), { once: true });
    root?.classList?.remove("no-webgl");
    if (root?.dataset) root.dataset.forgeReady = "true";
    return controller;
  } catch {
    try {
      controller?.destroy?.();
    } catch {
      // Continue to the scene cleanup even if an injected controller fails.
    }
    try {
      scene?.destroy?.();
    } catch {
      // The static DOM fallback remains available even if renderer cleanup fails.
    }
    root?.classList?.add("no-webgl");
    if (root?.dataset) delete root.dataset.forgeReady;
    return null;
  }
}
