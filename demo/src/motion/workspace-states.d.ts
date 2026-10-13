export type WorkspaceMotionState = "idle" | "loading" | "analyzing" | "verified" | "error";
export type GateTone = "ready" | "evidence" | "verified" | "caution";

export interface WorkspaceMotion {
  scan: number;
  queue: number;
  receiptStamp: number;
  gateTone: GateTone;
}

export function getWorkspaceMotion(state: WorkspaceMotionState): WorkspaceMotion;
