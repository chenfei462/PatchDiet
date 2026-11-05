import { applyMotionPreference } from "./motion/preference.js";

if (typeof document !== "undefined") {
  bootstrapHomepage();
}

/**
 * Homepage bootstrap: video playback policy, active-scene tracking, scroll
 * reveal, and the hero menu. Returns a handle whose `destroy()` removes every
 * listener and observer. All browser globals are injectable for unit tests.
 */
export function bootstrapHomepage({
  documentRef = globalThis.document,
  windowRef = globalThis.window ?? globalThis,
  IntersectionObserverImpl = globalThis.IntersectionObserver
} = {}) {
  if (!documentRef) return null;

  const cleanups = [];
  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };

  const policy = applyMotionPreference({ documentRef, windowRef });
  const video = documentRef.querySelector?.("#hero-video") ?? null;
  controlVideo({ video, policy, documentRef, listen });
  trackScenes({ documentRef, IntersectionObserverImpl, cleanups });
  bindMenu({ documentRef, listen });

  const handle = {
    policy,
    destroy() {
      while (cleanups.length > 0) cleanups.pop()();
    }
  };
  listen(windowRef, "pagehide", () => handle.destroy(), { once: true });
  return handle;
}

function controlVideo({ video, policy, documentRef, listen }) {
  if (!video) return;

  if (policy.tier === "static") {
    video.removeAttribute?.("autoplay");
    video.pause?.();
    return;
  }

  // Autoplay can be refused (data saver, power mode); the poster stays visible.
  const play = () => {
    const attempt = video.play?.();
    attempt?.catch?.(() => {});
  };

  listen(documentRef, "visibilitychange", () => {
    if (documentRef.hidden) {
      video.pause?.();
    } else {
      play();
    }
  });
  play();
}

function trackScenes({ documentRef, IntersectionObserverImpl, cleanups }) {
  const body = documentRef.body;
  const scenes = [...(documentRef.querySelectorAll?.("[data-scene]") ?? [])];
  const reveals = [...(documentRef.querySelectorAll?.("[data-reveal]") ?? [])];

  if (typeof IntersectionObserverImpl !== "function") {
    for (const element of reveals) element.dataset.visible = "true";
    if (body?.dataset && scenes[0]) body.dataset.activeScene = scenes[0].dataset.scene;
    return;
  }

  // A scene is active while it crosses the middle band of the viewport.
  const sceneObserver = new IntersectionObserverImpl((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && body?.dataset) {
        body.dataset.activeScene = entry.target.dataset.scene;
      }
    }
  }, { rootMargin: "-45% 0px -45% 0px" });

  const revealObserver = new IntersectionObserverImpl((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.dataset.visible = "true";
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  for (const scene of scenes) sceneObserver.observe(scene);
  for (const element of reveals) revealObserver.observe(element);
  cleanups.push(() => sceneObserver.disconnect(), () => revealObserver.disconnect());
}

function bindMenu({ documentRef, listen }) {
  const menu = documentRef.querySelector?.("[data-menu]");
  if (!menu) return;

  const close = () => {
    menu.open = false;
  };

  listen(menu, "click", (event) => {
    if (event.target?.closest?.("a")) close();
  });
  listen(documentRef, "keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      close();
      menu.querySelector?.("summary")?.focus?.();
    }
  });
  listen(documentRef, "click", (event) => {
    if (menu.open && !menu.contains?.(event.target)) close();
  });
}
