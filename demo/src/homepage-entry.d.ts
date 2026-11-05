import type { MotionPolicy } from "./motion/policy.js";

export interface HomepageBootstrapDependencies {
  documentRef?: Document;
  windowRef?: Window;
  IntersectionObserverImpl?: typeof IntersectionObserver;
}

export interface HomepageHandle {
  policy: MotionPolicy;
  destroy(): void;
}

export function bootstrapHomepage(
  dependencies?: HomepageBootstrapDependencies
): HomepageHandle | null;
