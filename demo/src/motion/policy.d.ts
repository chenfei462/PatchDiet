export type MotionTier = "static" | "mobile" | "full";

export interface MotionPolicyInput {
  reducedMotion: boolean;
  width: number;
  dpr: number;
}

export interface MotionPolicy {
  tier: MotionTier;
  pixelRatio: number;
}

export function resolveMotionPolicy(input: MotionPolicyInput): MotionPolicy;
