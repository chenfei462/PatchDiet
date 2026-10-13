/**
 * Hand-written types for `demo/app.js`, the workspace initializer shared by the
 * demo pages and `tests/unit/workspace-app.test.ts`.
 *
 * The initializer takes injectable dependencies so the workspace can be driven
 * from a fake document in unit tests and from the real page in the browser.
 */

export type WorkspaceInputMode = "sample" | "paste" | "pr";

export type WorkspaceStateType =
  | "loading-sample"
  | "fetching-pr"
  | "analyzing"
  | "verified"
  | "error";

export interface WorkspaceState {
  type: WorkspaceStateType;
  message?: string;
  result?: unknown;
}

/** The subset of `fetch` responses the workspace reads. */
export interface WorkspaceFetchResponse {
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/**
 * Structural subset of the document the workspace queries and wires up.
 *
 * Return types are `unknown` and events are untyped on purpose: the real page
 * passes `document`, while unit tests pass a minimal fake document, and only
 * the workspace implementation knows which elements it looks up.
 */
export interface WorkspaceRootLike {
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): unknown;
  addEventListener(type: string, listener: (event: unknown) => unknown): void;
  removeEventListener(type: string, listener: (event: unknown) => unknown): void;
}

export interface InitWorkspaceOptions {
  root?: WorkspaceRootLike;
  fetchImpl?: (url: string) => Promise<WorkspaceFetchResponse>;
  matchMedia?: (query: string) => { matches: boolean };
  clipboard?: { writeText(text: string): Promise<void> };
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  onStateChange?: (state: WorkspaceState) => void;
}

export interface WorkspaceApi {
  analyzeCurrentDiff(): Promise<void>;
  destroy(): void;
  selectInputMode(mode: WorkspaceInputMode): WorkspaceInputMode;
}

export function initWorkspace(options?: InitWorkspaceOptions): WorkspaceApi;
