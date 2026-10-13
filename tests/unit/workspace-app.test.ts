import { describe, expect, it, vi } from "vitest";

import { initWorkspace } from "../../demo/app.js";

type Listener = (event: FakeEvent) => unknown;

interface FakeEvent {
  currentTarget: FakeElement;
  key?: string;
  preventDefault: () => void;
  target: FakeElement;
  type: string;
}

class FakeElement {
  activeElement?: FakeElement;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  id = "";
  listeners = new Map<string, Set<Listener>>();
  ownerDocument: FakeElement;
  parentElement?: FakeElement;
  tabIndex = 0;
  textContent = "";
  value = "";

  constructor(public tagName = "DIV", ownerDocument?: FakeElement) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument ?? this;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this.ownerDocument);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
    if (name === "tabindex") this.tabIndex = Number(value);
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this.dataset[toDatasetKey(name)] = value;
  }

  getAttribute(name: string): string | null {
    if (name === "id" && this.id) return this.id;
    if (name === "class" && this.className) return this.className;
    if (name === "tabindex") return String(this.tabIndex);
    if (name === "hidden") return this.hidden ? "" : null;
    if (name.startsWith("data-") && toDatasetKey(name) in this.dataset) {
      return this.dataset[toDatasetKey(name)];
    }
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
    if (name.startsWith("data-")) delete this.dataset[toDatasetKey(name)];
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  async dispatch(type: string, event: Partial<FakeEvent> = {}): Promise<void> {
    const dispatched = {
      currentTarget: this,
      preventDefault: () => {},
      target: this,
      type,
      ...event
    } as FakeEvent;
    await Promise.all([...this.listeners.get(type) ?? []].map((listener) => listener(dispatched)));
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  matches(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attributeMatch) {
      const value = this.getAttribute(attributeMatch[1]);
      return attributeMatch[2] === undefined ? value !== null : value === attributeMatch[2];
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | undefined = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  totalListeners(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0)
      + this.children.reduce((total, child) => total + child.totalListeners(), 0);
  }
}

function toDatasetKey(name: string): string {
  return name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function createFixture() {
  const root = new FakeElement("document");
  root.ownerDocument = root;
  const add = (tag: string, id?: string, attributes: Record<string, string> = {}) => {
    const element = root.createElement(tag);
    if (id) element.setAttribute("id", id);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    root.append(element);
    return element;
  };

  const diffInput = add("textarea", "diff-input");
  const projectInput = add("input", "project-name");
  projectInput.value = "sample-cart-pr";
  const prUrlInput = add("input", "pr-url");
  const loadSampleButton = add("button", "load-sample");
  loadSampleButton.textContent = "Reload sample diff";
  const analyzeButton = add("button", "analyze");
  analyzeButton.textContent = "Analyze diff preview";
  const fetchPrButton = add("button", "fetch-pr");
  fetchPrButton.textContent = "Fetch public PR";
  const status = add("p", "workspace-status");
  const suggestions = add("ul", "suggestions");
  const candidateStrip = add("ul", "candidate-strip");
  const scanStage = add("div", undefined, { "data-demo-scan-stage": "", "data-scan-state": "complete" });
  const copyButton = add("button", undefined, { "data-copy-command": "" });
  copyButton.textContent = "Copy verified CLI command";
  const copyStatus = add("span", undefined, { "data-proof-copy-status": "" });

  const modes = (["sample", "paste", "pr"] as const).map((mode, index) =>
    add("button", `mode-${mode}`, {
      "data-input-mode": mode,
      "aria-selected": String(index === 0),
      tabindex: String(index === 0 ? 0 : -1)
    })
  );
  const panels = (["sample", "paste", "pr"] as const).map((mode, index) => {
    const panel = add("div", `panel-${mode}`, {
      "data-input-panel": mode,
      "aria-hidden": String(index !== 0)
    });
    panel.hidden = index !== 0;
    return panel;
  });

  for (const name of [
    "judge-headline",
    "judge-hook",
    "judge-noise",
    "judge-noise-inline",
    "judge-minutes",
    "judge-minutes-inline",
    "reduction-before",
    "reduction-after",
    "judge-command",
    "judge-receipt"
  ]) add("span", undefined, { [`data-${name}`]: "" });
  for (const name of [
    "files-before",
    "files-after",
    "lines-before",
    "lines-after",
    "hunks-before",
    "hunks-after",
    "saved-time",
    "deletion-hunks",
    "review-before",
    "review-after"
  ]) add("span", undefined, { "data-metric": name });

  const card = add("div", "diet-card");
  for (const name of ["card-project", "card-saved", "card-before", "card-after"]) {
    const target = root.createElement("span");
    target.setAttribute(`data-${name}`, "");
    card.append(target);
  }

  return {
    root,
    diffInput,
    projectInput,
    prUrlInput,
    loadSampleButton,
    analyzeButton,
    fetchPrButton,
    status,
    suggestions,
    candidateStrip,
    scanStage,
    copyButton,
    copyStatus,
    modes,
    panels
  };
}

const sampleDiff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -0,0 +1,2 @@
+# Generated notes
+Temporary review noise
`;

function textResponse(body: string) {
  return {
    ok: true,
    headers: { get: () => "text/plain" },
    text: async () => body,
    json: async () => undefined
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

const reducedMotion = () => ({ matches: true });

describe("workspace initializer", () => {
  it("imports without a global document and exposes the public initializer", async () => {
    await expect(import("../../demo/app.js")).resolves.toMatchObject({
      initWorkspace: expect.any(Function)
    });
  });

  it("selects input modes and removes every registered listener on destroy", async () => {
    const fixture = createFixture();
    let resolveSample!: (response: ReturnType<typeof textResponse>) => void;
    const sampleRequest = new Promise<ReturnType<typeof textResponse>>((resolve) => {
      resolveSample = resolve;
    });
    const states: Array<{ type: string }> = [];
    const api = initWorkspace({
      root: fixture.root,
      fetchImpl: () => sampleRequest,
      matchMedia: reducedMotion,
      onStateChange: (state: { type: string }) => states.push(state)
    });

    expect(Object.keys(api).sort()).toEqual(["analyzeCurrentDiff", "destroy", "selectInputMode"]);
    expect(fixture.root.totalListeners()).toBeGreaterThan(0);
    expect(api.selectInputMode("paste")).toBe("paste");
    expect(fixture.modes.map((button) => button.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false"
    ]);
    expect(fixture.modes.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    expect(fixture.panels.map((panel) => panel.hidden)).toEqual([true, false, true]);
    expect(fixture.panels.map((panel) => panel.getAttribute("aria-hidden"))).toEqual([
      "true",
      "false",
      "true"
    ]);
    expect(() => api.selectInputMode("unknown" as never)).toThrow(/input mode/i);

    api.destroy();
    api.destroy();
    expect(fixture.root.totalListeners()).toBe(0);
    expect(fixture.loadSampleButton.disabled).toBe(false);
    resolveSample(textResponse(sampleDiff));
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.diffInput.value).toBe("");
    expect(states.map((state) => state.type)).toEqual(["loading-sample"]);
  });

  it("emits exact sample, paste, and PR lifecycles while disabling only the active command", async () => {
    const fixture = createFixture();
    const requests: string[] = [];
    const snapshots: Array<{ type: string; disabled: boolean[] }> = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requests.push(url);
      if (url.startsWith("/api/pr?")) {
        return jsonResponse({ diff: sampleDiff, projectName: "octo-pr-42" });
      }
      return textResponse(sampleDiff);
    });
    const api = initWorkspace({
      root: fixture.root,
      fetchImpl,
      matchMedia: reducedMotion,
      onStateChange: (state: { type: string }) => snapshots.push({
        type: state.type,
        disabled: [
          fixture.loadSampleButton.disabled,
          fixture.analyzeButton.disabled,
          fixture.fetchPrButton.disabled
        ]
      })
    });

    await vi.waitFor(() => expect(snapshots.map((state) => state.type)).toEqual([
      "loading-sample",
      "verified"
    ]));
    expect(snapshots[0].disabled).toEqual([true, false, false]);
    expect([fixture.loadSampleButton, fixture.analyzeButton, fixture.fetchPrButton].map((button) => button.disabled)).toEqual([false, false, false]);

    snapshots.length = 0;
    api.selectInputMode("paste");
    fixture.diffInput.value = sampleDiff;
    fixture.projectInput.value = "pasted-project";
    await fixture.analyzeButton.dispatch("click");
    expect(snapshots.map((state) => state.type)).toEqual(["analyzing", "verified"]);
    expect(snapshots[0].disabled).toEqual([false, true, false]);
    expect(fixture.analyzeButton.disabled).toBe(false);

    snapshots.length = 0;
    api.selectInputMode("pr");
    fixture.prUrlInput.value = "https://github.com/octo/demo/pull/42?view=files";
    await fixture.fetchPrButton.dispatch("click");
    expect(requests.at(-1)).toBe(
      "/api/pr?url=https%3A%2F%2Fgithub.com%2Focto%2Fdemo%2Fpull%2F42%3Fview%3Dfiles"
    );
    expect(snapshots.map((state) => state.type)).toEqual([
      "fetching-pr",
      "analyzing",
      "verified"
    ]);
    expect(snapshots.slice(0, 2).map((snapshot) => snapshot.disabled)).toEqual([
      [false, false, true],
      [false, false, true]
    ]);
    expect(fixture.fetchPrButton.disabled).toBe(false);
    expect(fixture.projectInput.value).toBe("octo-pr-42");
    expect(new Set(snapshots.map((state) => state.type))).toEqual(
      new Set(["fetching-pr", "analyzing", "verified"])
    );

    api.destroy();
  });

  it("emits errors, delegates dynamic candidates, and keeps copy feedback width-stable", async () => {
    const fixture = createFixture();
    const states: Array<{ type: string; message?: string }> = [];
    const clipboard = { writeText: vi.fn(async () => {}) };
    const api = initWorkspace({
      root: fixture.root,
      fetchImpl: async () => textResponse(sampleDiff),
      clipboard,
      matchMedia: reducedMotion,
      onStateChange: (state: { type: string; message?: string }) => states.push(state)
    });
    await vi.waitFor(() => expect(states.at(-1)?.type).toBe("verified"));

    expect(fixture.suggestions.children.length).toBeGreaterThan(0);
    expect(fixture.suggestions.children.every((candidate) => candidate.totalListeners() === 0)).toBe(true);
    expect(fixture.suggestions.totalListeners()).toBeGreaterThan(0);

    const label = fixture.copyButton.textContent;
    await fixture.copyButton.dispatch("click");
    expect(clipboard.writeText).toHaveBeenCalledWith('patchdiet shrink --test "npm test"');
    expect(fixture.copyStatus.textContent).toBe("CLI proof command copied.");
    expect(fixture.copyButton.textContent).toBe(label);

    states.length = 0;
    api.selectInputMode("paste");
    fixture.diffInput.value = "";
    await fixture.analyzeButton.dispatch("click");
    expect(states.map((state) => state.type)).toEqual(["analyzing", "error"]);
    expect(states[1].message).toMatch(/unified diff/i);
    expect(fixture.analyzeButton.disabled).toBe(false);
    api.destroy();
  });

  it("cancels every pending metric frame and scan timer at destroy", async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      let frameId = 0;
      const frames = new Map<number, (now: number) => void>();
      const cancelled: number[] = [];
      const api = initWorkspace({
        root: fixture.root,
        fetchImpl: async () => textResponse(sampleDiff),
        matchMedia: () => ({ matches: false }),
        requestFrame: (callback: (now: number) => void) => {
          const id = ++frameId;
          frames.set(id, callback);
          return id;
        },
        cancelFrame: (id: number) => {
          cancelled.push(id);
          frames.delete(id);
        },
        now: () => 0
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(frames.size).toBeGreaterThan(0);
      expect(fixture.scanStage.dataset.scanState).toBe("scanning");

      const pendingFrames = [...frames.keys()];
      api.destroy();
      expect(cancelled.sort((left, right) => left - right)).toEqual(pendingFrames);
      expect(frames.size).toBe(0);
      vi.runAllTimers();
      expect(fixture.scanStage.dataset.scanState).toBe("scanning");
    } finally {
      vi.useRealTimers();
    }
  });
});
