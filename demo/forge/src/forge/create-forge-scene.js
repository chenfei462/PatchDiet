import * as THREE from "three";
import { createForgeObjects } from "./objects.js";
import { getWorkspaceMotion } from "../motion/workspace-states.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clampPointer = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

export function createForgeScene({ canvas, policy, rendererFactory, frameScheduler }) {
  const renderer = rendererFactory
    ? rendererFactory()
    : new THREE.WebGLRenderer({
        canvas,
        antialias: policy.tier === "full",
        alpha: false,
        powerPreference: "high-performance"
      });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080c09);
  scene.fog = new THREE.Fog(0x080c09, 7, 23);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  const forge = createForgeObjects(THREE, policy);
  const documentRef = typeof document === "undefined" ? null : document;
  const scheduler = frameScheduler ?? {
    request: (callback) =>
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame(callback)
        : 0,
    cancel: (id) => {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(id);
      }
    }
  };
  let destroyed = false;
  let running = false;
  let frameId = null;
  let lastSize = null;
  let homepageFrame = null;
  let mode = null;
  let workspaceState = null;
  let workspaceMotion = null;
  let ambientTime = 0;
  let lastTimestamp = null;
  let packetSpeed = 1;
  let resumeAfterVisibility = false;
  const pointer = { x: 0, y: 0 };
  const packetTransform = new THREE.Object3D();

  renderer.setPixelRatio(policy.pixelRatio);
  scene.add(forge.root);

  const ambientLight = new THREE.AmbientLight(0xf1f4e9, 0.72);
  const keyLight = new THREE.DirectionalLight(0xb9ff66, 2.1);
  keyLight.position.set(4, 6, 8);
  const evidenceLight = new THREE.PointLight(0x8cdef0, 28, 18, 2);
  evidenceLight.position.set(-4, 1.5, 5);
  scene.add(ambientLight, keyLight, evidenceLight);

  function setHomepageFrame(frame) {
    if (destroyed || !frame) return;
    mode = "homepage";
    workspaceState = null;
    homepageFrame = {
      progress: clamp01(frame.progress),
      intake: clamp01(frame.intake),
      gateScan: clamp01(frame.gateScan),
      fragmentEjection: clamp01(frame.fragmentEjection),
      receiptAssembly: clamp01(frame.receiptAssembly),
      handoff: clamp01(frame.handoff),
      pointerWeight: clamp01(frame.pointerWeight)
    };

    const {
      progress,
      intake,
      gateScan,
      fragmentEjection,
      receiptAssembly,
      handoff,
      pointerWeight
    } = homepageFrame;

    const cameraZ = 8.8 - intake * 0.7 + handoff * 1.15;
    const viewportHeight = lastSize?.height > 1 ? lastSize.height : 900;
    const worldUnitsPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.abs(cameraZ)) /
      viewportHeight;
    const pointerLimit = 6 * worldUnitsPerPixel * pointerWeight;
    camera.position.set(
      (progress - 0.5) * 0.9 + pointer.x * pointerLimit,
      0.35 + gateScan * 0.18 - handoff * 0.3 + pointer.y * pointerLimit,
      cameraZ
    );
    camera.lookAt(0, -0.15, 0);

    forge.slab.position.set(-4.8 * (1 - intake) + handoff * 1.7, 0.2 - handoff * 0.35, 0);
    forge.slab.rotation.set(-0.05 + gateScan * 0.04, -0.38 * (1 - intake), handoff * -0.08);
    forge.slab.scale.set(1 - handoff * 0.22, 1, 1);

    forge.gates.position.set(gateScan * 0.55 - handoff * 0.25, gateScan * 0.12, gateScan * 0.35);
    forge.gates.rotation.y = -0.1 + gateScan * 0.2;

    forge.fragments.position.set(
      fragmentEjection * 4.2 - handoff * 0.6,
      fragmentEjection * 1.15,
      fragmentEjection * 0.8
    );
    forge.fragments.rotation.z = fragmentEjection * 0.34;
    forge.fragments.scale.setScalar(0.72 + fragmentEjection * 0.28);

    forge.evidence.position.set(
      handoff * -1.25,
      -1.5 + receiptAssembly * 1.45 + handoff * 0.3,
      -0.8 + receiptAssembly * 0.7
    );
    forge.evidence.rotation.z = (1 - receiptAssembly) * -0.12 + handoff * 0.06;
    forge.evidence.scale.setScalar(0.68 + receiptAssembly * 0.32);
    const scanPlane = forge.slab.getObjectByName("workspace-scan-plane");
    const receipt = forge.evidence.getObjectByName("evidence-plate-1");
    if (scanPlane) scanPlane.visible = false;
    if (receipt) receipt.scale.setScalar(1);
  }

  function setWorkspaceState(state) {
    if (destroyed) return;
    const resolvedMotion = typeof state === "string" ? getWorkspaceMotion(state) : state;
    if (!resolvedMotion || typeof resolvedMotion !== "object") {
      throw new TypeError("Workspace state must be a state name or motion object");
    }
    mode = "workspace";
    workspaceState = typeof state === "string" ? state : null;
    workspaceMotion = {
      scan: resolvedMotion.scan,
      queue: resolvedMotion.queue,
      receiptStamp: resolvedMotion.receiptStamp,
      gateTone: resolvedMotion.gateTone
    };
    applyWorkspaceMotion(workspaceMotion);
  }

  function applyWorkspaceMotion(motion) {
    const scan = clamp01(motion.scan);
    const queue = clamp01(motion.queue);
    const receiptStamp = clamp01(motion.receiptStamp);
    packetSpeed = motion.gateTone === "evidence" ? 1.8 : motion.gateTone === "caution" ? 0 : 1;
    const toneColors = {
      ready: 0xb9ff66,
      evidence: 0x8cdef0,
      verified: 0xb9ff66,
      caution: 0xf7c76c
    };
    const gateColor = toneColors[motion.gateTone] ?? toneColors.caution;

    camera.position.set(pointer.x * 0.12, 0.25 + pointer.y * 0.08, 8.55);
    camera.lookAt(0, -0.15, 0);
    forge.slab.position.set(0, 0.1, 0);
    forge.slab.rotation.set(-0.035, 0, 0);
    forge.slab.scale.set(1 - receiptStamp * 0.16, 1, 1);
    forge.gates.position.set(0, 0, scan * 0.22);
    forge.gates.rotation.set(0, 0, 0);
    forge.fragments.position.set(receiptStamp * 3.2, receiptStamp * 0.8, receiptStamp * 0.55);
    forge.fragments.rotation.z = receiptStamp * 0.24;
    forge.fragments.scale.setScalar(1);
    forge.evidence.position.set(0, 0, -0.15);
    forge.evidence.rotation.set(0, 0, 0);
    forge.evidence.scale.setScalar(1);

    forge.gates.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.color?.setHex(gateColor);
        material.emissive?.setHex(gateColor);
        if ("emissiveIntensity" in material) {
          material.emissiveIntensity = motion.gateTone === "verified" ? 0.42 : 0.2;
        }
      }
    });

    const scanPlane = forge.slab.getObjectByName("workspace-scan-plane");
    if (scanPlane) {
      scanPlane.visible = scan > 0;
      scanPlane.position.y = -1.25 + scan * 2.5;
    }
    const packets = forge.rails.getObjectByName("data-packets");
    if (packets) {
      packets.position.z = queue * 1.4;
      packets.scale.set(0.78 + queue * 0.22, 0.78 + queue * 0.22, 0.5 + queue * 0.75);
    }
    const receipt = forge.evidence.getObjectByName("evidence-plate-1");
    if (receipt) receipt.scale.setScalar(1 + receiptStamp * 0.18);
  }

  function setPointer(x, y) {
    if (destroyed) return;
    const nextX = typeof x === "object" && x !== null ? x.x : x;
    const nextY = typeof x === "object" && x !== null ? x.y : y;
    pointer.x = clampPointer(nextX);
    pointer.y = clampPointer(nextY);
    if (mode === "homepage" && homepageFrame) {
      setHomepageFrame(homepageFrame);
    } else if (mode === "workspace" && workspaceMotion) {
      applyWorkspaceMotion(workspaceMotion);
    }
  }

  function resize() {
    if (destroyed) return false;
    const cssWidth = Number.isFinite(canvas?.clientWidth) && canvas.clientWidth > 0
      ? canvas.clientWidth
      : canvas?.width;
    const cssHeight = Number.isFinite(canvas?.clientHeight) && canvas.clientHeight > 0
      ? canvas.clientHeight
      : canvas?.height;
    const width = Number.isFinite(cssWidth) && cssWidth > 0 ? Math.max(1, Math.round(cssWidth)) : 1;
    const height = Number.isFinite(cssHeight) && cssHeight > 0 ? Math.max(1, Math.round(cssHeight)) : 1;

    if (lastSize?.width === width && lastSize.height === height) return false;
    lastSize = { width, height };
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    return true;
  }

  function updateAmbientPackets(deltaSeconds) {
    if (policy.tier === "static" || deltaSeconds <= 0) return;
    ambientTime += deltaSeconds * packetSpeed;
    const packets = forge.rails.getObjectByName("data-packets");
    if (!packets) return;

    for (let index = 0; index < forge.counts.dataPackets; index += 1) {
      const railIndex = index % 4;
      const offset = (index / forge.counts.dataPackets) * 17;
      const z = 5 - ((offset + ambientTime * 4) % 17);
      packetTransform.position.set(-3.3 + railIndex * 2.2, -2.04, z);
      packetTransform.updateMatrix();
      packets.setMatrixAt(index, packetTransform.matrix);
    }
    packets.instanceMatrix.needsUpdate = true;
  }

  function tick(timestamp) {
    if (!running || destroyed) return;
    frameId = null;
    const currentTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    const deltaSeconds = lastTimestamp === null
      ? 0
      : Math.max(0, Math.min(0.1, (currentTimestamp - lastTimestamp) / 1000));
    lastTimestamp = currentTimestamp;
    updateAmbientPackets(deltaSeconds);
    resize();
    renderOnce();
    if (running) frameId = scheduler.request(tick);
  }

  function start() {
    if (running || destroyed) return;
    if (documentRef?.hidden || documentRef?.visibilityState === "hidden") {
      return;
    }
    if (policy.tier === "static") {
      renderOnce();
      return;
    }
    running = true;
    lastTimestamp = null;
    frameId = scheduler.request(tick);
  }

  function renderOnce() {
    if (!destroyed) {
      renderer.render(scene, camera);
    }
  }

  function stop(preserveVisibilityResume = false) {
    if (!preserveVisibilityResume) resumeAfterVisibility = false;
    if (!running) return;
    running = false;
    if (frameId !== null) scheduler.cancel(frameId);
    frameId = null;
    lastTimestamp = null;
  }

  function handleVisibilityChange() {
    if (!documentRef || destroyed) return;
    const hidden = documentRef.hidden || documentRef.visibilityState === "hidden";
    if (hidden) {
      resumeAfterVisibility = running;
      if (running) stop(true);
      return;
    }
    if (resumeAfterVisibility) {
      resumeAfterVisibility = false;
      start();
    }
  }

  function disposeSceneResources() {
    const geometries = new Set();
    const materials = new Set();
    const instancedMeshes = new Set();
    scene.traverse((object) => {
      if (object.isInstancedMesh && typeof object.dispose === "function") {
        instancedMeshes.add(object);
      }
      if (object.geometry) geometries.add(object.geometry);
      if (!object.material) return;
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
    for (const instancedMesh of instancedMeshes) instancedMesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    documentRef?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    disposeSceneResources();
    renderer.dispose();
  }

  function getStats() {
    return {
      tier: policy.tier,
      counts: { ...forge.counts },
      running,
      destroyed,
      mode,
      workspaceState,
      ambientTime,
      lastSize: lastSize ? { ...lastSize } : null
    };
  }

  resize();
  documentRef?.addEventListener?.("visibilitychange", handleVisibilityChange);

  return {
    setHomepageFrame,
    setWorkspaceState,
    setPointer,
    resize,
    start,
    stop,
    renderOnce,
    destroy,
    getStats
  };
}
