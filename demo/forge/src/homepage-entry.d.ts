import type {
  CreateHomepageControllerOptions,
  HomepageController,
  HomepageScene
} from "./forge/homepage-controller.js";
import type { MotionPolicy } from "./motion/policy.js";

export interface HomepageBootstrapDependencies {
  documentRef?: Document;
  windowRef?: Window;
  createScene?(options: {
    canvas: HTMLCanvasElement;
    policy: MotionPolicy;
  }): HomepageScene;
  createController?(options: CreateHomepageControllerOptions): HomepageController;
}

export function bootstrapHomepage(
  dependencies?: HomepageBootstrapDependencies
): HomepageController | null;
