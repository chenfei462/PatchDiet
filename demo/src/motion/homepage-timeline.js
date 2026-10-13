const clamp = (value) => Math.max(0, Math.min(1, value));
const local = (value, start, end) => clamp((value - start) / (end - start));

export function getHomepageFrame(progress) {
  const p = clamp(Number.isFinite(progress) ? progress : 0);

  return {
    progress: p,
    scene: Math.min(4, Math.floor(p * 5)),
    intake: local(p, 0, 0.18),
    gateScan: local(p, 0.18, 0.4),
    fragmentEjection: local(p, 0.4, 0.58),
    receiptAssembly: local(p, 0.58, 0.78),
    handoff: local(p, 0.78, 1),
    pointerWeight: 1 - local(p, 0.18, 0.3)
  };
}
