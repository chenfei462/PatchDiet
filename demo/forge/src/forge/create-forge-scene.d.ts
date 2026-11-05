import type { HomepageFrame } from "../motion/homepage-timeline.js";
import type { MotionPolicy, MotionTier } from "../motion/policy.js";
import type {
  WorkspaceMotion,
  WorkspaceMotionState
} from "../motion/workspace-states.js";

export interface ForgeRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: unknown, camera: unknown): void;
  dispose(): void;
}

export interface ForgeFrameScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(id: number): void;
}

export interface ForgeSceneStats {
  tier: MotionTier;
  counts: {
    fragments: number;
    dataPackets: number;
  };
  running: boolean;
  destroyed: boolean;
  mode: "homepage" | "workspace" | null;
  workspaceState: WorkspaceMotionState | null;
  ambientTime: number;
  lastSize: { width: number; height: number } | null;
}

export interface ForgeSceneController {
  setHomepageFrame(frame: HomepageFrame): void;
  setWorkspaceState(state: WorkspaceMotionState | WorkspaceMotion): void;
  setPointer(x: number, y: number): void;
  setPointer(pointer: { x: number; y: number }): void;
  resize(): boolean;
  start(): void;
  stop(): void;
  renderOnce(): void;
  destroy(): void;
  getStats(): ForgeSceneStats;
}

export interface CreateForgeSceneOptions {
  canvas: HTMLCanvasElement;
  policy: MotionPolicy;
  rendererFactory?: () => ForgeRenderer;
  frameScheduler?: ForgeFrameScheduler;
}

export function createForgeScene(options: CreateForgeSceneOptions): ForgeSceneController;
