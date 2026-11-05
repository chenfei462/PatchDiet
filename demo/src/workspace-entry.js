import { initWorkspace } from "../app.js";
import { applyMotionPreference } from "./motion/preference.js";

if (typeof document !== "undefined") {
  applyMotionPreference();
  const workspace = initWorkspace();
  window.addEventListener("pagehide", () => workspace.destroy(), { once: true });
}
