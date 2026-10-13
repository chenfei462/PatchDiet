export function createForgeObjects(THREE, { tier }) {
  const colors = {
    forge: 0x080c09,
    surface: 0x111712,
    bone: 0xf1f4e9,
    lime: 0xb9ff66,
    coral: 0xff765f,
    cyan: 0x8cdef0
  };
  const counts = {
    fragments: tier === "mobile" ? 12 : 32,
    dataPackets: tier === "mobile" ? 28 : 72
  };
  const root = new THREE.Group();
  const slab = new THREE.Group();
  const gates = new THREE.Group();
  const fragments = new THREE.Group();
  const evidence = new THREE.Group();
  const rails = new THREE.Group();

  root.name = "patch-forge";
  slab.name = "forge-slab";
  gates.name = "scan-gates";
  fragments.name = "forge-fragments";
  evidence.name = "evidence-plates";
  rails.name = "forge-rails";

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: colors.surface,
    metalness: 0.45,
    roughness: 0.5
  });
  const limeMaterial = new THREE.MeshStandardMaterial({
    color: colors.lime,
    emissive: colors.lime,
    emissiveIntensity: 0.14,
    metalness: 0.15,
    roughness: 0.42
  });
  const boneMaterial = new THREE.MeshStandardMaterial({
    color: colors.bone,
    metalness: 0.1,
    roughness: 0.55
  });
  const coralMaterial = new THREE.MeshStandardMaterial({
    color: colors.coral,
    emissive: colors.coral,
    emissiveIntensity: 0.08,
    roughness: 0.48
  });
  const cyanMaterial = new THREE.MeshStandardMaterial({
    color: colors.cyan,
    emissive: colors.cyan,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.78,
    roughness: 0.35
  });
  const gateMaterial = new THREE.MeshStandardMaterial({
    color: colors.lime,
    emissive: colors.lime,
    emissiveIntensity: 0.2,
    metalness: 0.25,
    roughness: 0.32
  });

  const slabGeometry = new THREE.BoxGeometry(4.8, 2.7, 0.16);
  const slabMesh = new THREE.Mesh(slabGeometry, darkMaterial);
  slabMesh.name = "diff-slab";
  slab.add(slabMesh);

  const slabEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slabGeometry),
    new THREE.LineBasicMaterial({ color: colors.lime })
  );
  slabEdges.name = "diff-slab-edges";
  slab.add(slabEdges);

  const codeBars = new THREE.Group();
  codeBars.name = "code-bars";
  const barGeometry = new THREE.BoxGeometry(1, 1, 0.035);
  const removalRows = new Set([2, 6, 9]);
  for (let index = 0; index < 12; index += 1) {
    const removal = removalRows.has(index);
    const width = removal ? 1.15 + (index % 2) * 0.35 : 2.1 + (index % 3) * 0.42;
    const material = removal ? coralMaterial : index % 4 === 0 ? limeMaterial : boneMaterial;
    const bar = new THREE.Mesh(barGeometry, material);
    bar.name = removal ? `removal-bar-${index}` : `kept-bar-${index}`;
    bar.scale.set(width, 0.075, 1);
    bar.position.set(-1.85 + width / 2, 1.02 - index * 0.185, 0.101);
    codeBars.add(bar);
  }
  slab.add(codeBars);

  const scanPlane = new THREE.Mesh(
    new THREE.BoxGeometry(4.55, 0.035, 0.025),
    new THREE.MeshBasicMaterial({
      color: colors.cyan,
      transparent: true,
      opacity: 0.9
    })
  );
  scanPlane.name = "workspace-scan-plane";
  scanPlane.position.set(0, -1.25, 0.135);
  scanPlane.visible = false;
  slab.add(scanPlane);

  const gateHorizontalGeometry = new THREE.BoxGeometry(5.65, 0.075, 0.1);
  const gateVerticalGeometry = new THREE.BoxGeometry(0.075, 3.45, 0.1);
  for (let gateIndex = 0; gateIndex < 2; gateIndex += 1) {
    const gate = new THREE.Group();
    gate.name = `scan-gate-${gateIndex}`;
    gate.position.z = 0.45 + gateIndex * 0.55;

    for (const y of [-1.7, 1.7]) {
      const rail = new THREE.Mesh(gateHorizontalGeometry, gateMaterial);
      rail.position.y = y;
      gate.add(rail);
    }
    for (const x of [-2.8, 2.8]) {
      const rail = new THREE.Mesh(gateVerticalGeometry, gateMaterial);
      rail.position.x = x;
      gate.add(rail);
    }
    gates.add(gate);
  }

  const fragmentGeometry = new THREE.BoxGeometry(0.18, 0.075, 0.09);
  const fragmentInstances = new THREE.InstancedMesh(
    fragmentGeometry,
    coralMaterial,
    counts.fragments
  );
  fragmentInstances.name = "fragment-instances";
  const fragmentTransform = new THREE.Object3D();
  for (let index = 0; index < counts.fragments; index += 1) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    fragmentTransform.position.set(-2 + column * 0.56, 0.82 - row * 0.25, 0.18);
    fragmentTransform.rotation.set(0, 0, (index % 3 - 1) * 0.04);
    fragmentTransform.updateMatrix();
    fragmentInstances.setMatrixAt(index, fragmentTransform.matrix);
  }
  fragmentInstances.instanceMatrix.needsUpdate = true;
  fragments.add(fragmentInstances);

  const plateGeometry = new THREE.BoxGeometry(3.65, 1.9, 0.035);
  const plateMaterials = [cyanMaterial, limeMaterial, boneMaterial];
  for (let index = 0; index < 3; index += 1) {
    const plate = new THREE.Mesh(plateGeometry, plateMaterials[index]);
    plate.name = `evidence-plate-${index}`;
    plate.position.set((index - 1) * 0.25, (index - 1) * 0.18, -0.45 - index * 0.16);
    plate.rotation.z = (index - 1) * 0.035;
    evidence.add(plate);
  }

  const floorRails = new THREE.Group();
  floorRails.name = "floor-rails";
  const floorRailGeometry = new THREE.BoxGeometry(0.035, 0.035, 18);
  const floorRailMaterial = new THREE.MeshStandardMaterial({
    color: colors.lime,
    emissive: colors.lime,
    emissiveIntensity: 0.18,
    roughness: 0.5
  });
  for (const x of [-3.3, -1.1, 1.1, 3.3]) {
    const rail = new THREE.Mesh(floorRailGeometry, floorRailMaterial);
    rail.position.set(x, -2.1, -3.5);
    floorRails.add(rail);
  }
  rails.add(floorRails);

  const grid = new THREE.GridHelper(20, 20, colors.cyan, 0x29332e);
  grid.name = "forge-grid";
  grid.position.set(0, -2.12, -3.5);
  rails.add(grid);

  const packetGeometry = new THREE.BoxGeometry(0.09, 0.045, 0.22);
  const dataPackets = new THREE.InstancedMesh(packetGeometry, cyanMaterial, counts.dataPackets);
  dataPackets.name = "data-packets";
  const packetTransform = new THREE.Object3D();
  for (let index = 0; index < counts.dataPackets; index += 1) {
    const railIndex = index % 4;
    packetTransform.position.set(-3.3 + railIndex * 2.2, -2.04, 5 - (index / counts.dataPackets) * 17);
    packetTransform.updateMatrix();
    dataPackets.setMatrixAt(index, packetTransform.matrix);
  }
  dataPackets.instanceMatrix.needsUpdate = true;
  rails.add(dataPackets);

  root.add(rails, gates, slab, fragments, evidence);

  return {
    root,
    slab,
    gates,
    fragments,
    evidence,
    rails,
    counts
  };
}
