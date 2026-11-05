import { resolveMotionPolicy } from "./policy.js";

/**
 * Resolves the motion tier for the current viewport and publishes it on the
 * root element (`data-motion`, plus `motion-ok` when animation is allowed).
 * Shared by the homepage and workspace entries.
 */
export function applyMotionPreference({
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
