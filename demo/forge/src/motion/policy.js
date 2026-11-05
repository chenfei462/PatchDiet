export function resolveMotionPolicy({ reducedMotion, width, dpr }) {
  if (reducedMotion) {
    return { tier: "static", pixelRatio: 1 };
  }

  if (!Number.isFinite(width) || width <= 700) {
    return { tier: "mobile", pixelRatio: 1 };
  }

  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 1.5) : 1;
  return { tier: "full", pixelRatio };
}
