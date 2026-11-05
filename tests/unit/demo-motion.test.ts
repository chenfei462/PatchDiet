import { describe, expect, it, vi } from "vitest";

import { bootstrapHomepage } from "../../demo/src/homepage-entry.js";
import { resolveMotionPolicy } from "../../demo/src/motion/policy.js";

describe("demo motion models", () => {
  describe("resolveMotionPolicy", () => {
    it("selects static, mobile, and full rendering tiers", () => {
      expect(resolveMotionPolicy({ reducedMotion: true, width: 1440, dpr: 2 })).toEqual({
        tier: "static",
        pixelRatio: 1
      });
      expect(resolveMotionPolicy({ reducedMotion: false, width: 700, dpr: 3 })).toEqual({
        tier: "mobile",
        pixelRatio: 1
      });
      expect(resolveMotionPolicy({ reducedMotion: false, width: 1440, dpr: 2 })).toEqual({
        tier: "full",
        pixelRatio: 1.5
      });
      expect(resolveMotionPolicy({ reducedMotion: false, width: 1440, dpr: 1.25 })).toEqual({
        tier: "full",
        pixelRatio: 1.25
      });
    });

    it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])(
      "uses a safe full-tier pixel ratio for invalid dpr %s",
      (dpr) => {
        expect(resolveMotionPolicy({ reducedMotion: false, width: 1440, dpr })).toEqual({
          tier: "full",
          pixelRatio: 1
        });
      }
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "uses the conservative mobile tier for non-finite width %s",
      (width) => {
        expect(resolveMotionPolicy({ reducedMotion: false, width, dpr: 1.5 })).toEqual({
          tier: "mobile",
          pixelRatio: 1
        });
      }
    );
  });
});

describe("homepage entry", () => {
  function createEntryEnvironment({ reducedMotion = false, width = 1440 } = {}) {
    const classes = new Set<string>();
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const track = (target: string) => ({
      addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
        const key = `${target}:${type}`;
        listeners.set(key, [...(listeners.get(key) ?? []), listener]);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
        const key = `${target}:${type}`;
        listeners.set(key, (listeners.get(key) ?? []).filter((candidate) => candidate !== listener));
      })
    });
    const video = {
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      removeAttribute: vi.fn()
    };
    const scenes = ["intake", "gates", "receipt"].map((scene) => ({ dataset: { scene } }));
    const reveals = [{ dataset: {} as Record<string, string> }, { dataset: {} as Record<string, string> }];
    const menu = { open: true, contains: vi.fn(() => false), querySelector: vi.fn(() => null), ...track("menu") };
    const documentRef = {
      hidden: false,
      documentElement: {
        dataset: {} as Record<string, string>,
        classList: {
          add: vi.fn((name: string) => classes.add(name)),
          remove: vi.fn((name: string) => classes.delete(name))
        }
      },
      body: { dataset: {} as Record<string, string> },
      querySelector: vi.fn((selector: string) => {
        if (selector === "#hero-video") return video;
        if (selector === "[data-menu]") return menu;
        return null;
      }),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === "[data-scene]") return scenes;
        if (selector === "[data-reveal]") return reveals;
        return [];
      }),
      ...track("document")
    };
    const windowRef = {
      innerWidth: width,
      devicePixelRatio: 1,
      matchMedia: vi.fn(() => ({ matches: reducedMotion })),
      ...track("window")
    };
    const emit = (key: string, event: unknown = {}) => {
      for (const listener of listeners.get(key) ?? []) listener(event);
    };
    return { classes, documentRef, emit, listeners, menu, reveals, scenes, video, windowRef };
  }

  function createObserverStub() {
    const instances: Array<{
      callback: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void;
      observe: ReturnType<typeof vi.fn>;
      unobserve: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const Observer = vi.fn(function (this: unknown, callback: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void) {
      const instance = { callback, observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      instances.push(instance);
      return instance;
    });
    return { Observer, instances };
  }

  it("plays the hero loop and publishes the motion tier when motion is allowed", () => {
    const environment = createEntryEnvironment();
    const { Observer } = createObserverStub();

    const handle = bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: Observer as any
    });

    expect(handle?.policy.tier).toBe("full");
    expect(environment.documentRef.documentElement.dataset.motion).toBe("full");
    expect(environment.classes.has("motion-ok")).toBe(true);
    expect(environment.video.play).toHaveBeenCalledTimes(1);
    expect(environment.video.pause).not.toHaveBeenCalled();
  });

  it("keeps the poster frame and skips animation under reduced motion", () => {
    const environment = createEntryEnvironment({ reducedMotion: true });

    const handle = bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: createObserverStub().Observer as any
    });

    expect(handle?.policy.tier).toBe("static");
    expect(environment.documentRef.documentElement.dataset.motion).toBe("static");
    expect(environment.classes.has("motion-ok")).toBe(false);
    expect(environment.video.removeAttribute).toHaveBeenCalledWith("autoplay");
    expect(environment.video.pause).toHaveBeenCalledTimes(1);
    expect(environment.video.play).not.toHaveBeenCalled();
  });

  it("pauses the loop while the tab is hidden and tolerates refused autoplay", async () => {
    const environment = createEntryEnvironment();
    environment.video.play.mockImplementation(() => Promise.reject(new Error("autoplay blocked")));

    bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: createObserverStub().Observer as any
    });

    environment.documentRef.hidden = true;
    environment.emit("document:visibilitychange");
    expect(environment.video.pause).toHaveBeenCalledTimes(1);

    environment.documentRef.hidden = false;
    environment.emit("document:visibilitychange");
    expect(environment.video.play).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });

  it("tracks the active scene and reveals panels once", () => {
    const environment = createEntryEnvironment();
    const { Observer, instances } = createObserverStub();

    bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: Observer as any
    });

    const [sceneObserver, revealObserver] = instances;
    expect(sceneObserver.observe).toHaveBeenCalledTimes(3);
    expect(revealObserver.observe).toHaveBeenCalledTimes(2);

    sceneObserver.callback([{ isIntersecting: true, target: environment.scenes[1] }]);
    expect(environment.documentRef.body.dataset.activeScene).toBe("gates");
    sceneObserver.callback([{ isIntersecting: false, target: environment.scenes[2] }]);
    expect(environment.documentRef.body.dataset.activeScene).toBe("gates");

    revealObserver.callback([{ isIntersecting: true, target: environment.reveals[0] }]);
    expect(environment.reveals[0].dataset.visible).toBe("true");
    expect(environment.reveals[1].dataset.visible).toBeUndefined();
    expect(revealObserver.unobserve).toHaveBeenCalledWith(environment.reveals[0]);
  });

  it("shows every panel immediately when IntersectionObserver is unavailable", () => {
    const environment = createEntryEnvironment();

    bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: undefined as any
    });

    expect(environment.reveals.every((element) => element.dataset.visible === "true")).toBe(true);
    expect(environment.documentRef.body.dataset.activeScene).toBe("intake");
  });

  it("closes the menu on link click, Escape, and outside click", () => {
    const environment = createEntryEnvironment();
    bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: createObserverStub().Observer as any
    });

    environment.emit("menu:click", { target: { closest: () => ({}) } });
    expect(environment.menu.open).toBe(false);

    environment.menu.open = true;
    environment.emit("document:keydown", { key: "Escape" });
    expect(environment.menu.open).toBe(false);

    environment.menu.open = true;
    environment.emit("document:click", { target: {} });
    expect(environment.menu.open).toBe(false);
  });

  it("removes every listener and observer on destroy", () => {
    const environment = createEntryEnvironment();
    const { Observer, instances } = createObserverStub();

    const handle = bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      IntersectionObserverImpl: Observer as any
    });
    expect(environment.windowRef.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), { once: true });

    handle?.destroy();

    for (const instance of instances) expect(instance.disconnect).toHaveBeenCalledTimes(1);
    for (const [key, registered] of environment.listeners) expect(registered, key).toHaveLength(0);
  });

  it("returns null without a document", () => {
    expect(bootstrapHomepage({ documentRef: null as any })).toBeNull();
  });
});
