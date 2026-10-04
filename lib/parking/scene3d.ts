import * as THREE from "three";
import { buildCarRig, type CarRig } from "./model3d";
import { CAR_LENGTH, CAR_WIDTH, type Lot, type Slot } from "./lot";

/** Procedural asphalt texture so the lot does not look like flat plastic. */
function asphaltTexture(size = 512): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#2b2f36";
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // a few oil patches
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.anisotropy = 4;
  return tex;
}

function slotLines(slot: Slot, color: string, y = 0.02): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const t = 0.12;
  const parts: [number, number, number, number][] = [
    // x offset, z offset, width, depth (local to slot)
    [0, -slot.d / 2, slot.w, t],
    [0, slot.d / 2, slot.w, t],
    [-slot.w / 2, 0, t, slot.d],
    [slot.w / 2, 0, t, slot.d],
  ];
  for (const [ox, oz, w, d] of parts) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(ox, 0, oz);
    g.add(m);
  }
  g.position.set(slot.cx, y, slot.cz);
  g.rotation.y = -slot.angle;
  return g;
}

export interface LotScene {
  root: THREE.Group;
  targetHalo: THREE.Mesh;
  dispose(): void;
}

export function buildLotScene(lot: Lot): LotScene {
  const root = new THREE.Group();
  const rigs: CarRig[] = [];
  const junk: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // ground
  const groundTex = asphaltTexture();
  junk.push(groundTex);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(lot.halfW * 2 + 12, lot.halfD * 2 + 12),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // surrounding grass apron
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(lot.halfW * 2 + 40, lot.halfD * 2 + 40),
    new THREE.MeshStandardMaterial({ color: "#1d2b24", roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  root.add(apron);

  // bay markings
  for (const slot of lot.slots) {
    root.add(slotLines(slot, slot.index === lot.target.index ? "#4ade80" : "#e2e8f0"));
  }

  // target halo (pulses in the render loop)
  const targetHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(lot.target.w, lot.target.d),
    new THREE.MeshBasicMaterial({
      color: "#22c55e",
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  targetHalo.rotation.x = -Math.PI / 2;
  targetHalo.position.set(lot.target.cx, 0.015, lot.target.cz);
  targetHalo.rotation.z = -lot.target.angle;
  root.add(targetHalo);

  // obstacles
  for (const o of lot.obstacles) {
    if (o.kind === "car") {
      const rig = buildCarRig(o.color);
      rig.group.position.set(o.rect.cx, 0, o.rect.cz);
      // parked cars are modelled length-along-X; rotate to the bay angle.
      const alongZ = o.rect.d > o.rect.w;
      rig.group.rotation.y = -(o.rect.angle + (alongZ ? Math.PI / 2 : 0));
      rig.setLights({ brake: false, reverse: false, head: false });
      rigs.push(rig);
      root.add(rig.group);
      continue;
    }

    const geo = new THREE.BoxGeometry(o.rect.w, o.height, o.rect.d);
    const mat = new THREE.MeshStandardMaterial({
      color: o.color,
      roughness: o.kind === "kerb" ? 0.9 : 0.75,
      metalness: 0.05,
    });
    junk.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.rect.cx, o.height / 2, o.rect.cz);
    mesh.rotation.y = -o.rect.angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // light poles for depth
  const poleMat = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.8 });
  junk.push(poleMat);
  for (const [px, pz] of [
    [-lot.halfW + 2, -lot.halfD + 2],
    [lot.halfW - 2, -lot.halfD + 2],
    [-lot.halfW + 2, lot.halfD - 2],
    [lot.halfW - 2, lot.halfD - 2],
  ]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 10), poleMat);
    pole.position.set(px, 3.5, pz);
    root.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.2, 0.5),
      new THREE.MeshStandardMaterial({
        color: "#e2e8f0",
        emissive: new THREE.Color("#fde68a"),
        emissiveIntensity: 0.7,
      }),
    );
    head.position.set(px, 7, pz);
    root.add(head);
  }

  return {
    root,
    targetHalo,
    dispose() {
      for (const r of rigs) r.dispose();
      for (const j of junk) j.dispose();
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose?.();
      });
    },
  };
}

export function buildLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight("#9fc5e8", "#1f2937", 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#fff3d6", 1.5);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 34;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  const fill = new THREE.DirectionalLight("#7dd3fc", 0.35);
  fill.position.set(-14, 12, -16);
  scene.add(fill);

  return { hemi, sun, fill };
}

export const CAR_DIMS = { length: CAR_LENGTH, width: CAR_WIDTH };
