// demo/src/motion/policy.js
function resolveMotionPolicy({ reducedMotion, width, dpr }) {
  if (reducedMotion) {
    return { tier: "static", pixelRatio: 1 };
  }
  if (!Number.isFinite(width) || width <= 700) {
    return { tier: "mobile", pixelRatio: 1 };
  }
  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 1.5) : 1;
  return { tier: "full", pixelRatio };
}

// demo/src/motion/preference.js
function applyMotionPreference({
  documentRef = globalThis.document,
  windowRef = globalThis.window ?? globalThis
} = {}) {
  const policy = resolveMotionPolicy({
    reducedMotion: windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    width: windowRef.innerWidth,
    dpr: windowRef.devicePixelRatio
  });
  const root = documentRef?.documentElement;
  if (root?.dataset) root.dataset.motion = policy.tier;
  if (policy.tier === "static") {
    root?.classList?.remove("motion-ok");
  } else {
    root?.classList?.add("motion-ok");
  }
  return policy;
}

export {
  applyMotionPreference
};
//# sourceMappingURL=chunk-CQFBGQEX.js.map
