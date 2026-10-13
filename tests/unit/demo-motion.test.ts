import { describe, expect, it, vi } from "vitest";

import { createForgeScene } from "../../demo/src/forge/create-forge-scene.js";
import { createHomepageController } from "../../demo/src/forge/homepage-controller.js";
import { bootstrapHomepage } from "../../demo/src/homepage-entry.js";
import { getHomepageFrame } from "../../demo/src/motion/homepage-timeline.js";
import { resolveMotionPolicy } from "../../demo/src/motion/policy.js";
import { getWorkspaceMotion } from "../../demo/src/motion/workspace-states.js";

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

  describe("getHomepageFrame", () => {
    it("maps scroll progress across all five scenes", () => {
      expect(getHomepageFrame(0).scene).toBe(0);
      expect(getHomepageFrame(0.25).scene).toBe(1);
      expect(getHomepageFrame(0.5).scene).toBe(2);
      expect(getHomepageFrame(0.75).scene).toBe(3);
      expect(getHomepageFrame(1).scene).toBe(4);
    });

    it("clamps progress and maps each local animation range", () => {
      expect(getHomepageFrame(-0.5)).toMatchObject({ progress: 0, intake: 0, pointerWeight: 1 });
      expect(getHomepageFrame(1.5)).toMatchObject({ progress: 1, scene: 4, handoff: 1 });

      expect(getHomepageFrame(0.09).intake).toBeCloseTo(0.5);
      expect(getHomepageFrame(0.29).gateScan).toBeCloseTo(0.5);
      expect(getHomepageFrame(0.49).fragmentEjection).toBeCloseTo(0.5);
      expect(getHomepageFrame(0.68).receiptAssembly).toBeCloseTo(0.5);
      expect(getHomepageFrame(0.89).handoff).toBeCloseTo(0.5);

      expect(getHomepageFrame(0.18)).toMatchObject({ intake: 1, gateScan: 0, pointerWeight: 1 });
      expect(getHomepageFrame(0.3).pointerWeight).toBe(0);
      expect(getHomepageFrame(0.4)).toMatchObject({ gateScan: 1, fragmentEjection: 0 });
      expect(getHomepageFrame(0.58)).toMatchObject({ fragmentEjection: 1, receiptAssembly: 0 });
      expect(getHomepageFrame(0.78)).toMatchObject({ receiptAssembly: 1, handoff: 0 });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined])(
      "returns a finite initial frame for invalid progress %s",
      (progress) => {
        // @ts-expect-error Runtime callers can still supply invalid JavaScript values.
        const frame = getHomepageFrame(progress);
        expect(frame.progress).toBe(0);
        expect(Object.values(frame).every((value) => typeof value !== "number" || Number.isFinite(value))).toBe(true);
      }
    );
  });

  describe("getWorkspaceMotion", () => {
    it.each([
      ["idle", { scan: 0, queue: 0, receiptStamp: 0, gateTone: "ready" }],
      ["loading", { scan: 0.45, queue: 0, receiptStamp: 0, gateTone: "evidence" }],
      ["analyzing", { scan: 1, queue: 0.35, receiptStamp: 0, gateTone: "evidence" }],
      ["verified", { scan: 0, queue: 1, receiptStamp: 1, gateTone: "verified" }],
      ["error", { scan: 0, queue: 0, receiptStamp: 0, gateTone: "caution" }]
    ] as const)("maps %s to its visible motion state", (state, expected) => {
      expect(getWorkspaceMotion(state)).toEqual(expected);
    });

    it("throws a clear error for an unknown state", () => {
      // @ts-expect-error Exercise the runtime guard for untyped JavaScript callers.
      expect(() => getWorkspaceMotion("complete")).toThrowError("Unknown workspace motion state: complete");
    });

    it("returns copy-safe values", () => {
      const first = getWorkspaceMotion("verified");
      first.scan = 99;
      // @ts-expect-error Exercise copy safety with an invalid runtime value.
      first.gateTone = "corrupted";

      expect(getWorkspaceMotion("verified")).toEqual({
        scan: 0,
        queue: 1,
        receiptStamp: 1,
        gateTone: "verified"
      });
    });
  });
});

describe("forge scene runtime", () => {
  it("renders and disposes the renderer exactly once across repeated lifecycle calls", () => {
    const calls: string[] = [];
    const scene = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "static", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => calls.push("pixelRatio"),
        setSize: () => calls.push("size"),
        render: () => calls.push("render"),
        dispose: () => calls.push("dispose")
      }),
      frameScheduler: {
        request: () => 1,
        cancel: () => calls.push("cancel")
      }
    });

    scene.renderOnce();
    scene.stop();
    scene.stop();
    scene.destroy();
    scene.destroy();

    expect(calls).toContain("render");
    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
  });

  it("exposes the stable controller surface and tier-specific object counts", () => {
    const rendererFactory = () => ({
      setPixelRatio: () => {},
      setSize: () => {},
      render: () => {},
      dispose: () => {}
    });
    const mobile = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "mobile", pixelRatio: 1 },
      rendererFactory
    });
    const full = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1.5 },
      rendererFactory
    });

    expect(Object.keys(full).sort()).toEqual([
      "destroy",
      "getStats",
      "renderOnce",
      "resize",
      "setHomepageFrame",
      "setPointer",
      "setWorkspaceState",
      "start",
      "stop"
    ]);
    expect(mobile.getStats()).toMatchObject({
      tier: "mobile",
      counts: { fragments: 12, dataPackets: 28 },
      running: false,
      destroyed: false
    });
    expect(full.getStats()).toMatchObject({
      tier: "full",
      counts: { fragments: 32, dataPackets: 72 },
      running: false,
      destroyed: false
    });

    mobile.destroy();
    full.destroy();
  });

  it("constructs the concrete patch forge objects with exact instance counts", () => {
    let renderedScene: any;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (scene: unknown) => {
          renderedScene = scene;
        },
        dispose: () => {}
      })
    });

    runtime.renderOnce();

    const slab = renderedScene.getObjectByName("diff-slab");
    expect(slab.geometry.parameters).toMatchObject({ width: 4.8, height: 2.7, depth: 0.16 });
    expect(renderedScene.getObjectByName("code-bars").children).toHaveLength(12);
    const gateFrames = renderedScene.getObjectByName("scan-gates").children;
    expect(gateFrames).toHaveLength(2);
    expect(gateFrames.map((gate: any) => gate.children.length)).toEqual([4, 4]);
    expect(renderedScene.getObjectByName("fragment-instances").count).toBe(32);
    expect(renderedScene.getObjectByName("data-packets").count).toBe(72);
    expect(renderedScene.getObjectByName("evidence-plates").children).toHaveLength(3);
    expect(renderedScene.getObjectByName("floor-rails").children).toHaveLength(4);
    expect(renderedScene.getObjectByName("forge-grid")).toBeTruthy();

    const geometryTypes = new Set<string>();
    renderedScene.traverse((object: any) => {
      if (object.geometry) geometryTypes.add(object.geometry.type);
    });
    expect(geometryTypes.has("TorusGeometry")).toBe(false);
    expect(geometryTypes.has("SphereGeometry")).toBe(false);

    runtime.destroy();
  });

  it("resizes only for changed CSS dimensions and returns copy-safe stats", () => {
    const canvas = { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement;
    const pixelRatios: number[] = [];
    const sizes: Array<[number, number, boolean | undefined]> = [];
    const runtime = createForgeScene({
      canvas,
      policy: { tier: "full", pixelRatio: 1.5 },
      rendererFactory: () => ({
        setPixelRatio: (ratio: number) => pixelRatios.push(ratio),
        setSize: (width: number, height: number, updateStyle?: boolean) =>
          sizes.push([width, height, updateStyle]),
        render: () => {},
        dispose: () => {}
      })
    });

    expect(pixelRatios).toEqual([1.5]);
    expect(sizes).toEqual([[800, 450, false]]);
    runtime.resize();
    expect(sizes).toHaveLength(1);

    Object.assign(canvas, { clientWidth: 640, clientHeight: 360 });
    runtime.resize();
    expect(sizes.at(-1)).toEqual([640, 360, false]);

    const stats = runtime.getStats();
    expect(stats.lastSize).toEqual({ width: 640, height: 360 });
    stats.counts.fragments = 999;
    if (stats.lastSize) stats.lastSize.width = 999;
    expect(runtime.getStats()).toMatchObject({
      counts: { fragments: 32, dataPackets: 72 },
      lastSize: { width: 640, height: 360 }
    });

    runtime.destroy();
  });

  it("drives every homepage forge group and camera through the rendered scene", () => {
    let renderedScene: any;
    let renderedCamera: any;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (scene: unknown, camera: unknown) => {
          renderedScene = scene;
          renderedCamera = camera;
        },
        dispose: () => {}
      })
    });

    runtime.setHomepageFrame(getHomepageFrame(0));
    runtime.renderOnce();
    const initial = {
      camera: renderedCamera.position.toArray(),
      slab: renderedScene.getObjectByName("forge-slab").position.toArray(),
      gates: renderedScene.getObjectByName("scan-gates").position.toArray(),
      fragments: renderedScene.getObjectByName("forge-fragments").position.toArray(),
      evidence: renderedScene.getObjectByName("evidence-plates").position.toArray()
    };

    runtime.setHomepageFrame(getHomepageFrame(1));
    runtime.renderOnce();
    expect(renderedCamera.position.toArray()).not.toEqual(initial.camera);
    expect(renderedScene.getObjectByName("forge-slab").position.toArray()).not.toEqual(initial.slab);
    expect(renderedScene.getObjectByName("scan-gates").position.toArray()).not.toEqual(initial.gates);
    expect(renderedScene.getObjectByName("forge-fragments").position.toArray()).not.toEqual(
      initial.fragments
    );
    expect(renderedScene.getObjectByName("evidence-plates").position.toArray()).not.toEqual(
      initial.evidence
    );
    expect(renderedScene.fog).toBeTruthy();
    expect(renderedScene.children.filter((child: any) => child.isLight)).toHaveLength(3);

    runtime.destroy();
  });

  it("applies bounded pointer parallax and ignores unsafe coordinates", () => {
    let renderedCamera: any;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (_scene: unknown, camera: unknown) => {
          renderedCamera = camera;
        },
        dispose: () => {}
      })
    });

    runtime.setHomepageFrame(getHomepageFrame(0));
    runtime.renderOnce();
    const base = renderedCamera.position.toArray();
    runtime.setPointer(1, -1);
    runtime.renderOnce();
    const moved = renderedCamera.position.toArray();
    expect(moved).not.toEqual(base);
    expect(Math.abs(moved[0] - base[0])).toBeLessThanOrEqual(0.3);
    expect(Math.abs(moved[1] - base[1])).toBeLessThanOrEqual(0.2);

    runtime.setPointer(999, Number.NaN);
    runtime.renderOnce();
    expect(renderedCamera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(Math.abs(renderedCamera.position.x - base[0])).toBeLessThanOrEqual(0.3);

    runtime.destroy();
  });

  it("caps homepage pointer parallax to about six projected CSS pixels", () => {
    const canvas = { clientWidth: 1000, clientHeight: 500 } as HTMLCanvasElement;
    let renderedCamera: any;
    const runtime = createForgeScene({
      canvas,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (_scene: unknown, camera: unknown) => {
          renderedCamera = camera;
        },
        dispose: () => {}
      })
    });

    runtime.setHomepageFrame(getHomepageFrame(0));
    runtime.renderOnce();
    const base = renderedCamera.position.clone();
    runtime.setPointer(1, 1);
    runtime.renderOnce();

    const worldUnitsPerPixel =
      (2 * Math.tan((renderedCamera.fov * Math.PI) / 360) * base.z) / canvas.clientHeight;
    const projectedX = Math.abs(renderedCamera.position.x - base.x) / worldUnitsPerPixel;
    const projectedY = Math.abs(renderedCamera.position.y - base.y) / worldUnitsPerPixel;
    expect(projectedX).toBeGreaterThan(5.8);
    expect(projectedY).toBeGreaterThan(5.8);
    expect(projectedX).toBeLessThanOrEqual(6.1);
    expect(projectedY).toBeLessThanOrEqual(6.1);

    runtime.destroy();
  });

  it("maps workspace states to gate, scan, queue, and receipt motion with a fixed camera", () => {
    let renderedScene: any;
    let renderedCamera: any;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (scene: unknown, camera: unknown) => {
          renderedScene = scene;
          renderedCamera = camera;
        },
        dispose: () => {}
      })
    });

    runtime.setWorkspaceState("idle");
    runtime.renderOnce();
    const idle = {
      camera: renderedCamera.position.toArray(),
      gateColor: renderedScene.getObjectByName("scan-gate-0").children[0].material.color.getHex(),
      scanPosition: renderedScene.getObjectByName("workspace-scan-plane").position.toArray(),
      scanVisible: renderedScene.getObjectByName("workspace-scan-plane").visible,
      packetScale: renderedScene.getObjectByName("data-packets").scale.toArray(),
      receiptScale: renderedScene.getObjectByName("evidence-plate-1").scale.toArray()
    };

    runtime.setWorkspaceState("analyzing");
    runtime.renderOnce();
    expect(renderedCamera.position.toArray().map((value: number, index: number) =>
      Math.abs(value - idle.camera[index])
    ).every((delta: number) => delta <= 0.15)).toBe(true);
    expect(renderedScene.getObjectByName("scan-gate-0").children[0].material.color.getHex()).not.toBe(
      idle.gateColor
    );
    expect(renderedScene.getObjectByName("workspace-scan-plane").visible).toBe(true);
    expect(renderedScene.getObjectByName("workspace-scan-plane").position.toArray()).not.toEqual(
      idle.scanPosition
    );
    expect(renderedScene.getObjectByName("data-packets").scale.toArray()).not.toEqual(idle.packetScale);

    runtime.setWorkspaceState("verified");
    runtime.renderOnce();
    expect(renderedScene.getObjectByName("workspace-scan-plane").visible).toBe(false);
    expect(renderedScene.getObjectByName("evidence-plate-1").scale.toArray()).not.toEqual(
      idle.receiptScale
    );
    expect(runtime.getStats()).toMatchObject({ mode: "workspace", workspaceState: "verified" });
    expect(() => runtime.setWorkspaceState("complete" as never)).toThrowError(
      "Unknown workspace motion state: complete"
    );

    runtime.destroy();
  });

  it("reapplies a copy-safe workspace motion object when pointer parallax changes", () => {
    let renderedScene: any;
    let renderedCamera: any;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (scene: unknown, camera: unknown) => {
          renderedScene = scene;
          renderedCamera = camera;
        },
        dispose: () => {}
      })
    });
    const motion = {
      scan: 0.45,
      queue: 0.35,
      receiptStamp: 0.5,
      gateTone: "evidence" as const
    };

    runtime.setWorkspaceState(motion);
    runtime.renderOnce();
    const before = {
      camera: renderedCamera.position.toArray(),
      gateColor: renderedScene.getObjectByName("scan-gate-0").children[0].material.color.getHex(),
      scanPosition: renderedScene.getObjectByName("workspace-scan-plane").position.toArray(),
      packetScale: renderedScene.getObjectByName("data-packets").scale.toArray(),
      receiptScale: renderedScene.getObjectByName("evidence-plate-1").scale.toArray()
    };

    motion.scan = 0;
    motion.queue = 1;
    motion.receiptStamp = 0;
    runtime.setPointer(0.5, -0.5);
    runtime.renderOnce();

    expect(renderedCamera.position.toArray()).not.toEqual(before.camera);
    expect(renderedScene.getObjectByName("scan-gate-0").children[0].material.color.getHex()).toBe(
      before.gateColor
    );
    expect(renderedScene.getObjectByName("workspace-scan-plane").position.toArray()).toEqual(
      before.scanPosition
    );
    expect(renderedScene.getObjectByName("data-packets").scale.toArray()).toEqual(before.packetScale);
    expect(renderedScene.getObjectByName("evidence-plate-1").scale.toArray()).toEqual(
      before.receiptScale
    );

    runtime.destroy();
  });

  it("advances ambient packets from frame deltas but keeps the static tier frozen", () => {
    let renderedScene: any;
    let nextId = 1;
    const callbacks = new Map<number, (timestamp: number) => void>();
    const cancelled: number[] = [];
    const scheduler = {
      request: (callback: (timestamp: number) => void) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      cancel: (id: number) => {
        cancelled.push(id);
        callbacks.delete(id);
      }
    };
    const rendererFactory = () => ({
      setPixelRatio: () => {},
      setSize: () => {},
      render: (scene: unknown) => {
        renderedScene = scene;
      },
      dispose: () => {}
    });
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory,
      frameScheduler: scheduler
    });
    runtime.renderOnce();
    const before = Array.from(renderedScene.getObjectByName("data-packets").instanceMatrix.array);

    runtime.start();
    const runNext = (timestamp: number) => {
      const [id, callback] = callbacks.entries().next().value as [number, (time: number) => void];
      callbacks.delete(id);
      callback(timestamp);
    };
    runNext(1000);
    runNext(1016);

    expect(runtime.getStats()).toMatchObject({ running: true, ambientTime: 0.016 });
    expect(Array.from(renderedScene.getObjectByName("data-packets").instanceMatrix.array)).not.toEqual(
      before
    );
    runtime.stop();
    expect(cancelled).toHaveLength(1);
    expect(runtime.getStats().running).toBe(false);
    runtime.destroy();

    let staticRenders = 0;
    let staticRequests = 0;
    const staticRuntime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "static", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: () => {
          staticRenders += 1;
        },
        dispose: () => {}
      }),
      frameScheduler: {
        request: () => {
          staticRequests += 1;
          return 1;
        },
        cancel: () => {}
      }
    });
    staticRuntime.start();
    expect(staticRenders).toBe(1);
    expect(staticRequests).toBe(0);
    expect(staticRuntime.getStats()).toMatchObject({ running: false, ambientTime: 0 });
    staticRuntime.destroy();
  });

  it("pauses for document visibility and resumes only when previously running", () => {
    let hidden = false;
    let visibilityListener: (() => void) | undefined;
    const listenerCalls: string[] = [];
    vi.stubGlobal("document", {
      get hidden() {
        return hidden;
      },
      get visibilityState() {
        return hidden ? "hidden" : "visible";
      },
      addEventListener: (type: string, listener: () => void) => {
        listenerCalls.push(`add:${type}`);
        visibilityListener = listener;
      },
      removeEventListener: (type: string, listener: () => void) => {
        listenerCalls.push(`remove:${type}`);
        if (visibilityListener === listener) visibilityListener = undefined;
      }
    });

    try {
      let nextId = 1;
      const requested: number[] = [];
      const cancelled: number[] = [];
      const runtime = createForgeScene({
        canvas: {} as HTMLCanvasElement,
        policy: { tier: "full", pixelRatio: 1 },
        rendererFactory: () => ({
          setPixelRatio: () => {},
          setSize: () => {},
          render: () => {},
          dispose: () => {}
        }),
        frameScheduler: {
          request: () => {
            const id = nextId++;
            requested.push(id);
            return id;
          },
          cancel: (id: number) => cancelled.push(id)
        }
      });

      runtime.start();
      hidden = true;
      visibilityListener?.();
      expect(runtime.getStats().running).toBe(false);
      expect(cancelled).toEqual([1]);

      hidden = false;
      visibilityListener?.();
      expect(runtime.getStats().running).toBe(true);
      expect(requested).toEqual([1, 2]);

      runtime.stop();
      hidden = true;
      visibilityListener?.();
      hidden = false;
      visibilityListener?.();
      expect(requested).toEqual([1, 2]);

      runtime.destroy();
      runtime.destroy();
      expect(listenerCalls).toEqual(["add:visibilitychange", "remove:visibilitychange"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not resume after start is requested while the document is already hidden", () => {
    let hidden = true;
    let visibilityListener: (() => void) | undefined;
    vi.stubGlobal("document", {
      get hidden() {
        return hidden;
      },
      get visibilityState() {
        return hidden ? "hidden" : "visible";
      },
      addEventListener: (_type: string, listener: () => void) => {
        visibilityListener = listener;
      },
      removeEventListener: () => {}
    });

    try {
      let requests = 0;
      const runtime = createForgeScene({
        canvas: {} as HTMLCanvasElement,
        policy: { tier: "full", pixelRatio: 1 },
        rendererFactory: () => ({
          setPixelRatio: () => {},
          setSize: () => {},
          render: () => {},
          dispose: () => {}
        }),
        frameScheduler: {
          request: () => {
            requests += 1;
            return requests;
          },
          cancel: () => {}
        }
      });

      runtime.start();
      expect(requests).toBe(0);
      expect(runtime.getStats().running).toBe(false);

      hidden = false;
      visibilityListener?.();
      expect(requests).toBe(0);
      expect(runtime.getStats().running).toBe(false);

      runtime.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("disposes every unique scene resource exactly once", () => {
    let renderedScene: any;
    let rendererDisposals = 0;
    const runtime = createForgeScene({
      canvas: {} as HTMLCanvasElement,
      policy: { tier: "full", pixelRatio: 1 },
      rendererFactory: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        render: (scene: unknown) => {
          renderedScene = scene;
        },
        dispose: () => {
          rendererDisposals += 1;
        }
      })
    });
    runtime.renderOnce();

    const geometryDisposals = new Map<any, number>();
    const materialDisposals = new Map<any, number>();
    const instancedMeshDisposals = new Map<any, number>();
    renderedScene.traverse((object: any) => {
      if (object.isInstancedMesh) {
        instancedMeshDisposals.set(object, 0);
        object.dispose = () =>
          instancedMeshDisposals.set(object, (instancedMeshDisposals.get(object) ?? 0) + 1);
      }
      if (object.geometry && !geometryDisposals.has(object.geometry)) {
        geometryDisposals.set(object.geometry, 0);
        object.geometry.dispose = () =>
          geometryDisposals.set(object.geometry, (geometryDisposals.get(object.geometry) ?? 0) + 1);
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) {
        if (materialDisposals.has(material)) continue;
        materialDisposals.set(material, 0);
        material.dispose = () =>
          materialDisposals.set(material, (materialDisposals.get(material) ?? 0) + 1);
      }
    });

    expect(geometryDisposals.size).toBeGreaterThan(0);
    expect(materialDisposals.size).toBeGreaterThan(0);
    expect(instancedMeshDisposals.size).toBe(2);
    runtime.destroy();
    runtime.destroy();

    expect([...geometryDisposals.values()].every((count) => count === 1)).toBe(true);
    expect([...materialDisposals.values()].every((count) => count === 1)).toBe(true);
    expect([...instancedMeshDisposals.values()].every((count) => count === 1)).toBe(true);
    expect(rendererDisposals).toBe(1);
    expect(runtime.getStats().destroyed).toBe(true);
  });
});

describe("homepage controller", () => {
  function createEventTarget() {
    const listeners = new Map<string, Set<(event: any) => void>>();
    return {
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        const typeListeners = listeners.get(type) ?? new Set();
        typeListeners.add(listener);
        listeners.set(type, typeListeners);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        listeners.get(type)?.delete(listener);
      }),
      dispatch(type: string, event: Record<string, unknown> = {}) {
        for (const listener of listeners.get(type) ?? []) listener(event);
      }
    };
  }

  function createScene() {
    return {
      setHomepageFrame: vi.fn(),
      setPointer: vi.fn(),
      resize: vi.fn(),
      renderOnce: vi.fn(),
      start: vi.fn(),
      destroy: vi.fn()
    };
  }

  function createPointerScheduler() {
    let nextId = 1;
    const callbacks = new Map<number, (timestamp: number) => void>();
    const cancelled: number[] = [];
    return {
      request: vi.fn((callback: (timestamp: number) => void) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      }),
      cancel: vi.fn((id: number) => {
        cancelled.push(id);
        callbacks.delete(id);
      }),
      runNext(timestamp = 16) {
        const next = callbacks.entries().next().value as
          | [number, (time: number) => void]
          | undefined;
        if (!next) return false;
        callbacks.delete(next[0]);
        next[1](timestamp);
        return true;
      },
      get pending() {
        return callbacks.size;
      },
      cancelled
    };
  }

  it("rolls back listeners and scene when scroll creation fails", () => {
    const scene = createScene();
    const pointerTarget = createEventTarget();
    const resizeTarget = createEventTarget();
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1 },
      scroll: { create: vi.fn(() => { throw new Error("scroll failed"); }) },
      gsapAdapter: { timeline: vi.fn() },
      pointerTarget,
      resizeTarget,
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: []
    });

    expect(() => controller.start()).toThrowError("scroll failed");
    expect(controller.getState()).toMatchObject({ started: false, destroyed: true });
    expect(pointerTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(resizeTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(scene.destroy).toHaveBeenCalledTimes(1);

    const pointerCalls = scene.setPointer.mock.calls.length;
    const resizeCalls = scene.resize.mock.calls.length;
    pointerTarget.dispatch("pointermove", { clientX: 900, clientY: 400 });
    resizeTarget.dispatch("resize");
    expect(scene.setPointer).toHaveBeenCalledTimes(pointerCalls);
    expect(scene.resize).toHaveBeenCalledTimes(resizeCalls);
  });

  it("rolls back trigger and timeline when ambient scene startup fails", () => {
    const scene = createScene();
    scene.start.mockImplementation(() => { throw new Error("ambient failed"); });
    const trigger = { kill: vi.fn() };
    const timeline = { fromTo: vi.fn().mockReturnThis(), kill: vi.fn() };
    const pointerTarget = createEventTarget();
    const resizeTarget = createEventTarget();
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1 },
      scroll: { create: vi.fn((_config: any) => trigger) },
      gsapAdapter: { timeline: vi.fn(() => timeline) },
      pointerTarget,
      resizeTarget,
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: [{}]
    });

    expect(() => controller.start()).toThrowError("ambient failed");
    expect(trigger.kill).toHaveBeenCalledTimes(1);
    expect(timeline.kill).toHaveBeenCalledTimes(1);
    expect(pointerTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(resizeTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(scene.destroy).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ started: false, destroyed: true });
  });

  it("renders the initialized intake frame before starting ambient rendering", () => {
    const order: string[] = [];
    const scene = createScene();
    scene.setHomepageFrame.mockImplementation(() => order.push("frame"));
    scene.renderOnce.mockImplementation(() => order.push("render"));
    scene.start.mockImplementation(() => order.push("ambient"));
    const controller = createHomepageController({
      scene,
      policy: { tier: "static", pixelRatio: 1 },
      scroll: { create: vi.fn() },
      gsapAdapter: { timeline: vi.fn() },
      pointerTarget: createEventTarget(),
      resizeTarget: createEventTarget(),
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: []
    });

    controller.start();
    order.push("returned");

    expect(order).toEqual(["frame", "render", "ambient", "returned"]);
    expect(controller.getState()).toMatchObject({ started: true, destroyed: false });
  });

  it("uses the bounded six-step load order within 1.6 seconds", () => {
    const names = ["forge", "header", "kicker", "headline", "summary", "actions"] as const;
    const targets = Object.fromEntries(names.map((name) => [name, { name, style: {} }])) as Record<
      (typeof names)[number],
      { name: string; style: Record<string, string> }
    >;
    const timeline = { fromTo: vi.fn().mockReturnThis(), kill: vi.fn() };
    const controller = createHomepageController({
      scene: createScene(),
      policy: { tier: "full", pixelRatio: 1 },
      scroll: { create: vi.fn(() => ({ kill: vi.fn() })) },
      gsapAdapter: { timeline: vi.fn(() => timeline) },
      pointerTarget: createEventTarget(),
      resizeTarget: createEventTarget(),
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: targets
    });

    controller.start();

    expect(timeline.fromTo.mock.calls.map((call) => call[0])).toEqual(
      names.map((name) => targets[name])
    );
    const positions = timeline.fromTo.mock.calls.map((call) => call[3]);
    const durations = timeline.fromTo.mock.calls.map((call) => call[2].duration);
    expect(positions).toEqual([0, 0.16, 0.38, 0.52, 0.72, 0.94]);
    expect(durations).toEqual([0.36, 0.32, 0.24, 0.3, 0.28, 0.3]);
    expect(Math.max(...positions.map((position, index) => position + durations[index]))).toBe(1.24);
  });

  it("kills a partial load timeline and restores every target after tween failure", () => {
    const targets = Array.from({ length: 6 }, () => ({
      style: { opacity: "", transform: "" }
    }));
    const timeline = {
      fromTo: vi.fn((target: (typeof targets)[number]) => {
        target.style.opacity = "0";
        target.style.transform = "translateY(8px)";
        if (timeline.fromTo.mock.calls.length === 2) throw new Error("timeline failed");
        return timeline;
      }),
      kill: vi.fn()
    };
    const scene = createScene();
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1 },
      scroll: { create: vi.fn(() => ({ kill: vi.fn() })) },
      gsapAdapter: { timeline: vi.fn(() => timeline) },
      pointerTarget: createEventTarget(),
      resizeTarget: createEventTarget(),
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: targets
    });

    expect(() => controller.start()).not.toThrow();
    expect(timeline.kill).toHaveBeenCalledTimes(1);
    expect(targets.every((target) => target.style.opacity === "")).toBe(true);
    expect(targets.every((target) => target.style.transform === "")).toBe(true);
    expect(scene.start).toHaveBeenCalledTimes(1);
  });

  it("creates one scrub trigger and maps progress to forge and DOM scenes", () => {
    const scene = createScene();
    const body = { dataset: {} as Record<string, string> };
    const trigger = { kill: vi.fn() };
    const scroll = { create: vi.fn((_config: any) => trigger) };
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1.5 },
      scroll,
      gsapAdapter: { timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis(), kill: vi.fn() })) },
      pointerTarget: createEventTarget(),
      resizeTarget: createEventTarget(),
      body,
      story: {},
      viewport: { innerWidth: 1200, innerHeight: 800 },
      loadTargets: []
    });

    controller.start();
    controller.start();

    expect(scroll.create).toHaveBeenCalledTimes(1);
    const config = scroll.create.mock.calls[0][0];
    expect(config).toMatchObject({ start: "top top", end: "bottom bottom", scrub: 0.45 });
    expect(config.trigger).toEqual({});
    expect(scene.start).toHaveBeenCalledTimes(1);

    const sceneNames = ["intake", "gates", "receipt", "evidence", "handoff"];
    [0, 0.25, 0.5, 0.75, 1].forEach((progress, index) => {
      config.onUpdate({ progress });
      expect(scene.setHomepageFrame).toHaveBeenLastCalledWith(getHomepageFrame(progress));
      expect(body.dataset.activeScene).toBe(sceneNames[index]);
    });
  });

  it("destroys trigger, timeline, listeners, and scene exactly once", () => {
    const scene = createScene();
    const pointerTarget = createEventTarget();
    const resizeTarget = createEventTarget();
    const trigger = { kill: vi.fn() };
    const timeline = { fromTo: vi.fn().mockReturnThis(), kill: vi.fn() };
    const scroll = { create: vi.fn((_config: any) => trigger) };
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1 },
      scroll,
      gsapAdapter: { timeline: vi.fn(() => timeline) },
      pointerTarget,
      resizeTarget,
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: [{}]
    });
    controller.start();
    const config = scroll.create.mock.calls[0][0];
    const callsBeforeDestroy = {
      frames: scene.setHomepageFrame.mock.calls.length,
      pointers: scene.setPointer.mock.calls.length,
      resizes: scene.resize.mock.calls.length
    };

    controller.destroy();
    controller.destroy();
    pointerTarget.dispatch("pointermove", { clientX: 900, clientY: 450 });
    resizeTarget.dispatch("resize");
    config.onUpdate({ progress: 0.75 });

    expect(trigger.kill).toHaveBeenCalledTimes(1);
    expect(timeline.kill).toHaveBeenCalledTimes(1);
    expect(pointerTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(resizeTarget.removeEventListener).toHaveBeenCalledTimes(1);
    expect(scene.destroy).toHaveBeenCalledTimes(1);
    expect(scene.setHomepageFrame).toHaveBeenCalledTimes(callsBeforeDestroy.frames);
    expect(scene.setPointer).toHaveBeenCalledTimes(callsBeforeDestroy.pointers);
    expect(scene.resize).toHaveBeenCalledTimes(callsBeforeDestroy.resizes);
  });

  it("coalesces and smooths pointer frames, then cancels them at the gate and destroy", () => {
    const scene = createScene();
    const pointerTarget = createEventTarget();
    const pointerScheduler = createPointerScheduler();
    const scroll = { create: vi.fn((_config: any) => ({ kill: vi.fn() })) };
    const controller = createHomepageController({
      scene,
      policy: { tier: "full", pixelRatio: 1 },
      scroll,
      gsapAdapter: { timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis(), kill: vi.fn() })) },
      pointerTarget,
      pointerScheduler,
      resizeTarget: createEventTarget(),
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: []
    });
    controller.start();
    const config = scroll.create.mock.calls[0][0];

    pointerTarget.dispatch("pointermove", { clientX: 750, clientY: 125 });
    pointerTarget.dispatch("pointermove", { clientX: 1000, clientY: 0 });
    expect(pointerScheduler.request).toHaveBeenCalledTimes(1);
    expect(scene.setPointer).not.toHaveBeenCalled();

    pointerScheduler.runNext();
    const [firstX, firstY] = scene.setPointer.mock.calls.at(-1) ?? [];
    expect(firstX).toBeGreaterThan(0);
    expect(firstX).toBeLessThan(1);
    expect(firstY).toBeLessThan(0);
    expect(firstY).toBeGreaterThan(-1);

    for (let index = 0; index < 100 && pointerScheduler.pending > 0; index += 1) {
      pointerScheduler.runNext(32 + index * 16);
    }
    expect(scene.setPointer).toHaveBeenLastCalledWith(1, -1);
    expect(pointerScheduler.pending).toBe(0);

    pointerTarget.dispatch("pointermove", { clientX: 750, clientY: 125 });
    expect(pointerScheduler.pending).toBe(1);
    config.onUpdate({ progress: 0.31 });
    expect(pointerScheduler.cancel).toHaveBeenCalledTimes(1);
    expect(scene.setPointer).toHaveBeenLastCalledWith(0, 0);
    const neutralCalls = scene.setPointer.mock.calls.filter(([x, y]) => x === 0 && y === 0);
    expect(neutralCalls).toHaveLength(1);

    config.onUpdate({ progress: 0.2 });
    pointerTarget.dispatch("pointermove", { clientX: 750, clientY: 125 });
    expect(pointerScheduler.pending).toBe(1);
    controller.destroy();
    expect(pointerScheduler.cancel).toHaveBeenCalledTimes(2);
    expect(pointerScheduler.pending).toBe(0);
  });

  it("applies bounded pointer input only through the intake range", () => {
    const scene = createScene();
    const pointerTarget = createEventTarget();
    const pointerScheduler = createPointerScheduler();
    const scroll = { create: vi.fn((_config: any) => ({ kill: vi.fn() })) };
    const controller = createHomepageController({
      scene,
      policy: { tier: "mobile", pixelRatio: 1 },
      scroll,
      gsapAdapter: { timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis(), kill: vi.fn() })) },
      pointerTarget,
      pointerScheduler,
      resizeTarget: createEventTarget(),
      body: { dataset: {} },
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: []
    });
    controller.start();
    const config = scroll.create.mock.calls[0][0];

    config.onUpdate({ progress: 0.3 });
    pointerTarget.dispatch("pointermove", { clientX: 750, clientY: 125 });
    while (pointerScheduler.runNext()) {
      // Flush the deterministic interpolation queue.
    }
    const [midpointX, midpointY] = scene.setPointer.mock.calls.at(-1) ?? [];
    expect(midpointX).toBeCloseTo(0.5);
    expect(midpointY).toBeCloseTo(-0.5);
    expect(midpointX * 6).toBeCloseTo(3);
    expect(midpointY * 6).toBeCloseTo(-3);

    pointerTarget.dispatch("pointermove", { clientX: 1000, clientY: 0 });
    while (pointerScheduler.runNext()) {
      // Flush the deterministic interpolation queue.
    }
    const [x, y] = scene.setPointer.mock.calls.at(-1) ?? [];
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect(Math.abs(y)).toBeLessThanOrEqual(1);
    expect(Math.abs(x * 6)).toBeLessThanOrEqual(6);
    expect(Math.abs(y * 6)).toBeLessThanOrEqual(6);

    config.onUpdate({ progress: 0.31 });
    expect(scene.setPointer).toHaveBeenLastCalledWith(0, 0);
    const pointerCalls = scene.setPointer.mock.calls.length;
    pointerTarget.dispatch("pointermove", { clientX: 0, clientY: 500 });
    expect(scene.setPointer).toHaveBeenCalledTimes(pointerCalls);
  });

  it("renders the intake state without creating a scrub trigger for static policy", () => {
    const scene = createScene();
    const body = { dataset: {} as Record<string, string> };
    const scroll = { create: vi.fn((_config: any) => ({ kill: vi.fn() })) };
    const controller = createHomepageController({
      scene,
      policy: { tier: "static", pixelRatio: 1 },
      scroll,
      gsapAdapter: { timeline: vi.fn() },
      pointerTarget: createEventTarget(),
      resizeTarget: createEventTarget(),
      body,
      story: {},
      viewport: { innerWidth: 1000, innerHeight: 500 },
      loadTargets: []
    });

    controller.start();

    expect(scroll.create).not.toHaveBeenCalled();
    expect(scene.setHomepageFrame).toHaveBeenCalledWith(getHomepageFrame(0));
    expect(body.dataset.activeScene).toBe("intake");
    expect(scene.start).toHaveBeenCalledTimes(1);
  });
});

describe("homepage entry", () => {
  function createEntryEnvironment() {
    const classes = new Set<string>();
    const root = {
      dataset: {} as Record<string, string>,
      classList: {
        add: vi.fn((name: string) => classes.add(name)),
        remove: vi.fn((name: string) => classes.delete(name))
      }
    };
    const canvas = {} as HTMLCanvasElement;
    const documentRef = {
      documentElement: root,
      body: { dataset: {} },
      querySelector: vi.fn((selector: string) => selector === "#forge-canvas" ? canvas : null)
    };
    const windowRef = {
      innerWidth: 1000,
      innerHeight: 500,
      devicePixelRatio: 1,
      matchMedia: vi.fn(() => ({ matches: false })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    return { canvas, classes, documentRef, root, windowRef };
  }

  it("cleans partial scene and controller startup without publishing readiness", () => {
    const environment = createEntryEnvironment();
    const scene = { renderOnce: vi.fn(() => { throw new Error("render failed"); }), destroy: vi.fn() };
    const controller = {
      start: vi.fn(() => {
        expect(environment.root.dataset.forgeReady).toBeUndefined();
        scene.renderOnce();
      }),
      destroy: vi.fn()
    };

    const result = bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      createScene: vi.fn(() => scene as any),
      createController: vi.fn(() => controller as any)
    });

    expect(result).toBeNull();
    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(scene.destroy).toHaveBeenCalledTimes(1);
    expect(environment.root.dataset.forgeReady).toBeUndefined();
    expect(environment.classes.has("no-webgl")).toBe(true);
    expect(environment.windowRef.addEventListener).not.toHaveBeenCalled();
  });

  it("publishes readiness only after controller startup returns", () => {
    const environment = createEntryEnvironment();
    const scene = { destroy: vi.fn() };
    const order: string[] = [];
    const controller = {
      start: vi.fn(() => {
        order.push("start");
        expect(environment.root.dataset.forgeReady).toBeUndefined();
      }),
      destroy: vi.fn()
    };

    const result = bootstrapHomepage({
      documentRef: environment.documentRef as any,
      windowRef: environment.windowRef as any,
      createScene: vi.fn(() => scene as any),
      createController: vi.fn(() => controller as any)
    });
    order.push("returned");

    expect(result).toBe(controller);
    expect(order).toEqual(["start", "returned"]);
    expect(environment.root.dataset.forgeReady).toBe("true");
    expect(environment.windowRef.addEventListener).toHaveBeenCalledWith(
      "pagehide",
      expect.any(Function),
      { once: true }
    );
  });
});
