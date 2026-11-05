import type { HomepageFrame } from "../motion/homepage-timeline.js";
import type { MotionPolicy } from "../motion/policy.js";

export interface HomepageScene {
  setHomepageFrame(frame: HomepageFrame): void;
  setPointer(x: number, y: number): void;
  resize(): boolean | void;
  renderOnce?(): void;
  start(): void;
  destroy(): void;
}

export interface HomepageScrollInstance {
  kill(): void;
}

export interface HomepageScrollTriggerConfig {
  trigger: unknown;
  start: "top top";
  end: "bottom bottom";
  scrub: 0.45;
  onUpdate(self: { progress: number }): void;
}

export interface HomepageScrollAdapter {
  create(config: HomepageScrollTriggerConfig): HomepageScrollInstance;
}

export interface HomepageLoadTimeline {
  fromTo(
    target: unknown,
    fromVars: Record<string, unknown>,
    toVars: Record<string, unknown>,
    position?: number | string
  ): this;
  kill(): void;
}

export interface HomepageGsapAdapter {
  timeline(options?: Record<string, unknown>): HomepageLoadTimeline;
}

export interface HomepageEventTarget {
  addEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
}

export interface HomepageBodyTarget {
  dataset: Record<string, string> | DOMStringMap;
}

export interface HomepageViewport {
  innerWidth: number;
  innerHeight: number;
}

export interface HomepagePointerScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(id: number): void;
}

export interface HomepageLoadTargets {
  forge?: unknown;
  header?: unknown;
  kicker?: unknown;
  headline?: unknown;
  summary?: unknown;
  actions?: unknown;
}

export interface CreateHomepageControllerOptions {
  scene: HomepageScene;
  policy?: MotionPolicy;
  scroll?: HomepageScrollAdapter;
  gsapAdapter?: HomepageGsapAdapter;
  pointerTarget?: HomepageEventTarget | null;
  resizeTarget?: HomepageEventTarget | null;
  body?: HomepageBodyTarget | null;
  story?: unknown;
  viewport?: HomepageViewport | null;
  loadTargets?: HomepageLoadTargets | readonly unknown[];
  pointerScheduler?: HomepagePointerScheduler;
}

export interface HomepageControllerState {
  started: boolean;
  destroyed: boolean;
  progress: number;
  activeScene: "intake" | "gates" | "receipt" | "evidence" | "handoff";
}

export interface HomepageController {
  start(): void;
  destroy(): void;
  getState(): HomepageControllerState;
}

export function createHomepageController(options: CreateHomepageControllerOptions): HomepageController;
