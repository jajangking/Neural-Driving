import * as THREE from "three";
import { CAR_LENGTH, CAR_WIDTH } from "./lot";

/**
 * A hand-built, reasonably detailed sedan: body shell with a tapered bonnet
 * and boot, greenhouse with separate glass, bumpers, grille, lights, mirrors,
 * door handles, exhaust, and four steerable/rolling wheels.
 *
 * Local axes: +X = forward (nose), +Y = up, +Z = left side. Length is along X
 * so it matches the 2D physics convention (forward = cos/sin of heading).
 */

export interface CarRig {
  group: THREE.Group;
  /** front wheels, steered */
  frontWheels: THREE.Object3D[];
  /** all wheels, rolled */
  wheels: THREE.Object3D[];
  brakeLights: THREE.MeshStandardMaterial;
  reverseLights: THREE.MeshStandardMaterial;
  headlights: THREE.MeshStandardMaterial;
  bodyMaterial: THREE.MeshStandardMaterial;
  setColor(hex: string): void;
  setLights(opts: { brake: boolean; reverse: boolean; head: boolean }): void;
  roll(distance: number): void;
  steer(angle: number): void;
  dispose(): void;
}

const L = CAR_LENGTH;
const W = CAR_WIDTH;

function roundedBoxGeometry(
  w: number,
  h: number,
  d: number,
  radius = 0.12,
  seg = 3,
): THREE.BufferGeometry {
  // Cheap rounded box: a box with its corner vertices pulled in.
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const half = new THREE.Vector3(w / 2, h / 2, d / 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const inner = new THREE.Vector3(
      Math.max(Math.min(v.x, half.x - radius), -half.x + radius),
      Math.max(Math.min(v.y, half.y - radius), -half.y + radius),
      Math.max(Math.min(v.z, half.z - radius), -half.z + radius),
    );
    const dir = v.clone().sub(inner);
    if (dir.lengthSq() > 1e-9) {
      dir.normalize().multiplyScalar(radius);
      v.copy(inner).add(dir);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function makeWheel(radius: number, width: number): THREE.Group {
  const wheel = new THREE.Group();

  const tyreGeo = new THREE.CylinderGeometry(radius, radius, width, 22, 1);
  const tyre = new THREE.Mesh(
    tyreGeo,
    new THREE.MeshStandardMaterial({ color: "#14161a", roughness: 0.95, metalness: 0.05 }),
  );
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  wheel.add(tyre);

  // sidewall lettering ring
  const sidewallGeo = new THREE.TorusGeometry(radius * 0.78, 0.035, 8, 24);
  const sidewallMat = new THREE.MeshStandardMaterial({ color: "#2a2d33", roughness: 0.8 });
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(sidewallGeo, sidewallMat);
    ring.position.z = (s * width) / 2.02;
    wheel.add(ring);
  }

  // rim + spokes
  const rimMat = new THREE.MeshStandardMaterial({
    color: "#d4d8de",
    roughness: 0.25,
    metalness: 0.9,
  });
  for (const s of [1, -1]) {
    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.05, 18),
      rimMat,
    );
    dish.rotation.x = Math.PI / 2;
    dish.position.z = (s * width) / 2.1;
    wheel.add(dish);

    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 1.05, 0.07, 0.055),
        rimMat,
      );
      spoke.rotation.z = (i / 5) * Math.PI;
      spoke.position.z = (s * width) / 2.15;
      wheel.add(spoke);
    }

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: "#8b9099", metalness: 0.8, roughness: 0.3 }),
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.z = (s * width) / 1.95;
    wheel.add(cap);
  }

  // brake disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, 0.04, 16),
    new THREE.MeshStandardMaterial({ color: "#6b7280", metalness: 0.7, roughness: 0.5 }),
  );
  disc.rotation.x = Math.PI / 2;
  wheel.add(disc);

  return wheel;
}

export function buildCarRig(color = "#38bdf8"): CarRig {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  const keep = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const bodyMaterial = keep(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.32,
      metalness: 0.55,
    }),
  );
  const darkTrim = keep(
    new THREE.MeshStandardMaterial({ color: "#1b1f27", roughness: 0.7, metalness: 0.3 }),
  );
  const chrome = keep(
    new THREE.MeshStandardMaterial({ color: "#cfd6e0", roughness: 0.18, metalness: 1 }),
  );
  const glass = keep(
    new THREE.MeshPhysicalMaterial({
      color: "#9fc6e8",
      roughness: 0.08,
      metalness: 0,
      transmission: 0.72,
      transparent: true,
      opacity: 0.6,
      thickness: 0.2,
    }),
  );

  const wheelRadius = 0.33;
  const rideHeight = wheelRadius;

  // ---- lower body / sill ------------------------------------------------
  const sill = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.94, 0.3, W * 0.98, 0.09)),
    bodyMaterial,
  );
  sill.position.set(0, rideHeight + 0.18, 0);
  sill.castShadow = true;
  group.add(sill);

  // ---- main body --------------------------------------------------------
  const body = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.99, 0.55, W, 0.22)),
    bodyMaterial,
  );
  body.position.set(0, rideHeight + 0.5, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // bonnet: slightly lower, tapered forward
  const bonnet = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.3, 0.22, W * 0.95, 0.12)),
    bodyMaterial,
  );
  bonnet.position.set(L * 0.33, rideHeight + 0.76, 0);
  bonnet.rotation.z = -0.045;
  bonnet.castShadow = true;
  group.add(bonnet);

  // boot lid
  const boot = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.26, 0.2, W * 0.95, 0.12)),
    bodyMaterial,
  );
  boot.position.set(-L * 0.36, rideHeight + 0.78, 0);
  boot.rotation.z = 0.03;
  boot.castShadow = true;
  group.add(boot);

  // ---- greenhouse (cabin) ----------------------------------------------
  const cabinShell = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.46, 0.46, W * 0.9, 0.18)),
    bodyMaterial,
  );
  cabinShell.position.set(-L * 0.03, rideHeight + 1.05, 0);
  cabinShell.castShadow = true;
  group.add(cabinShell);

  const roof = new THREE.Mesh(
    keep(roundedBoxGeometry(L * 0.42, 0.08, W * 0.86, 0.06)),
    bodyMaterial,
  );
  roof.position.set(-L * 0.04, rideHeight + 1.3, 0);
  roof.castShadow = true;
  group.add(roof);

  // windscreen + rear screen (angled planes)
  const windscreen = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 0.86, 0.62)), glass);
  windscreen.rotation.set(0, Math.PI / 2, 0);
  windscreen.rotateX(-0.62);
  windscreen.position.set(L * 0.21, rideHeight + 1.07, 0);
  group.add(windscreen);

  const rearScreen = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 0.84, 0.5)), glass);
  rearScreen.rotation.set(0, -Math.PI / 2, 0);
  rearScreen.rotateX(-0.72);
  rearScreen.position.set(-L * 0.265, rideHeight + 1.1, 0);
  group.add(rearScreen);

  // side glass
  const sideGlassGeo = keep(new THREE.PlaneGeometry(L * 0.4, 0.34));
  for (const s of [1, -1]) {
    const sideGlass = new THREE.Mesh(sideGlassGeo, glass);
    sideGlass.position.set(-L * 0.04, rideHeight + 1.12, (s * W * 0.9) / 2 + s * 0.005);
    sideGlass.rotation.y = s > 0 ? 0 : Math.PI;
    group.add(sideGlass);

    // B-pillar
    const pillar = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.36, 0.04)), darkTrim);
    pillar.position.set(-L * 0.04, rideHeight + 1.12, (s * W * 0.9) / 2 + s * 0.01);
    group.add(pillar);
  }

  // ---- bumpers, grille, lights -----------------------------------------
  const frontBumper = new THREE.Mesh(
    keep(roundedBoxGeometry(0.22, 0.34, W * 1.01, 0.1)),
    darkTrim,
  );
  frontBumper.position.set(L * 0.49, rideHeight + 0.3, 0);
  group.add(frontBumper);

  const rearBumper = new THREE.Mesh(
    keep(roundedBoxGeometry(0.2, 0.34, W * 1.01, 0.1)),
    darkTrim,
  );
  rearBumper.position.set(-L * 0.49, rideHeight + 0.3, 0);
  group.add(rearBumper);

  const grille = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.2, W * 0.52)), darkTrim);
  grille.position.set(L * 0.5, rideHeight + 0.62, 0);
  group.add(grille);
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(keep(new THREE.BoxGeometry(0.02, 0.025, W * 0.5)), chrome);
    slat.position.set(L * 0.53, rideHeight + 0.55 + i * 0.05, 0);
    group.add(slat);
  }

  const headlights = keep(
    new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      emissive: new THREE.Color("#fff6d8"),
      emissiveIntensity: 0.15,
      roughness: 0.15,
    }),
  );
  const brakeLights = keep(
    new THREE.MeshStandardMaterial({
      color: "#7f1d1d",
      emissive: new THREE.Color("#ef4444"),
      emissiveIntensity: 0.25,
      roughness: 0.3,
    }),
  );
  const reverseLights = keep(
    new THREE.MeshStandardMaterial({
      color: "#e2e8f0",
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0.05,
      roughness: 0.3,
    }),
  );

  const lampGeo = keep(roundedBoxGeometry(0.1, 0.16, 0.42, 0.05));
  for (const s of [1, -1]) {
    const lamp = new THREE.Mesh(lampGeo, headlights);
    lamp.position.set(L * 0.5, rideHeight + 0.68, s * W * 0.3);
    group.add(lamp);

    const tail = new THREE.Mesh(lampGeo, brakeLights);
    tail.position.set(-L * 0.5, rideHeight + 0.72, s * W * 0.3);
    group.add(tail);

    const rev = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.08, 0.14)), reverseLights);
    rev.position.set(-L * 0.51, rideHeight + 0.55, s * W * 0.22);
    group.add(rev);
  }

  // ---- mirrors, handles, exhaust, plates -------------------------------
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 0.05, 0.1)), darkTrim);
    arm.position.set(L * 0.14, rideHeight + 1.0, (s * W) / 2 + s * 0.06);
    group.add(arm);

    const mirror = new THREE.Mesh(keep(roundedBoxGeometry(0.1, 0.12, 0.2, 0.05)), bodyMaterial);
    mirror.position.set(L * 0.13, rideHeight + 1.02, (s * W) / 2 + s * 0.16);
    group.add(mirror);

    for (const dx of [0.22, -0.3]) {
      const handle = new THREE.Mesh(keep(new THREE.BoxGeometry(0.22, 0.05, 0.04)), chrome);
      handle.position.set(dx, rideHeight + 0.72, (s * W) / 2 + s * 0.015);
      group.add(handle);
    }

    // side skirt crease
    const crease = new THREE.Mesh(keep(new THREE.BoxGeometry(L * 0.8, 0.035, 0.03)), darkTrim);
    crease.position.set(0, rideHeight + 0.34, (s * W) / 2 + s * 0.01);
    group.add(crease);
  }

  const exhaust = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.055, 0.065, 0.16, 12)),
    chrome,
  );
  exhaust.rotation.z = Math.PI / 2;
  exhaust.position.set(-L * 0.52, rideHeight + 0.18, -W * 0.28);
  group.add(exhaust);

  const plateGeo = keep(new THREE.BoxGeometry(0.03, 0.12, 0.44));
  const plateMat = keep(new THREE.MeshStandardMaterial({ color: "#f1f5f9", roughness: 0.6 }));
  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(L * 0.53, rideHeight + 0.38, 0);
  group.add(frontPlate);
  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.position.set(-L * 0.53, rideHeight + 0.4, 0);
  group.add(rearPlate);

  // roof antenna
  const antenna = new THREE.Mesh(keep(new THREE.ConeGeometry(0.045, 0.16, 8)), darkTrim);
  antenna.position.set(-L * 0.2, rideHeight + 1.4, 0);
  group.add(antenna);

  // ---- wheels -----------------------------------------------------------
  const wheelBase = 2.65;
  const track = W - 0.3;
  const frontWheels: THREE.Object3D[] = [];
  const wheels: THREE.Object3D[] = [];

  for (const [ix, sx] of [
    ["front", 1],
    ["rear", -1],
  ] as const) {
    for (const sz of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set((sx * wheelBase) / 2, wheelRadius, (sz * track) / 2);
      const wheel = makeWheel(wheelRadius, 0.24);
      pivot.add(wheel);
      group.add(pivot);

      // arch over each wheel
      const arch = new THREE.Mesh(
        keep(new THREE.TorusGeometry(wheelRadius + 0.1, 0.055, 6, 14, Math.PI)),
        darkTrim,
      );
      arch.position.set((sx * wheelBase) / 2, wheelRadius + 0.02, (sz * W) / 2);
      arch.rotation.y = Math.PI / 2;
      group.add(arch);

      wheels.push(wheel);
      if (ix === "front") frontWheels.push(pivot);
    }
  }

  // soft contact shadow blob (works even without shadow maps)
  const blob = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(L * 1.1, W * 1.3)),
    keep(
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    ),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.012;
  group.add(blob);

  return {
    group,
    frontWheels,
    wheels,
    brakeLights,
    reverseLights,
    headlights,
    bodyMaterial,
    setColor(hex: string) {
      bodyMaterial.color.set(hex);
    },
    setLights({ brake, reverse, head }) {
      brakeLights.emissiveIntensity = brake ? 2.4 : 0.25;
      reverseLights.emissiveIntensity = reverse ? 2.2 : 0.05;
      headlights.emissiveIntensity = head ? 1.6 : 0.15;
    },
    roll(distance: number) {
      const d = distance / wheelRadius;
      for (const w of wheels) w.rotation.z -= d;
    },
    steer(angle: number) {
      for (const p of frontWheels) p.rotation.y = -angle;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
