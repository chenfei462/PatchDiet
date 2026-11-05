import type { MotionPolicy } from "./policy.js";

export interface MotionPreferenceDependencies {
  documentRef?: Document;
  windowRef?: Window;
}

export function applyMotionPreference(dependencies?: MotionPreferenceDependencies): MotionPolicy;
