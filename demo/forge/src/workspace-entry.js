import { initWorkspace } from "../app.js";

if (typeof document !== "undefined") {
  const workspace = initWorkspace();
  window.addEventListener("pagehide", () => workspace.destroy(), { once: true });
}
