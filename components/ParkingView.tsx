"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DEFAULT_PARKING_CONFIG,
  ParkingSim,
  type ParkingConfig,
  type ParkingStats,
} from "@/lib/parking/sim";
import type { LotKind } from "@/lib/parking/lot";
import { CAR_LENGTH, CAR_WIDTH } from "@/lib/parking/lot";
import { buildCarRig, type CarRig } from "@/lib/parking/model3d";
import { buildLights, buildLotScene, type LotScene } from "@/lib/parking/scene3d";
import type { ParkControls } from "@/lib/parking/car";
import type { NetworkData } from "@/lib/network";

const STORAGE_KEY = "neural-driving:parking-brain";

type CameraMode = "orbit" | "chase" | "top" | "driver";

const emptyStats: ParkingStats = {
  generation: 1,
  alive: 0,
  population: 0,
  parked: 0,
  crashed: 0,
  bestScore: 0,
  allTimeBest: 0,
  distance: 0,
  headingErrorDeg: 0,
  speed: 0,
  elapsed: 0,
  episodeSeconds: DEFAULT_PARKING_CONFIG.episodeSeconds,
  successRate: 0,
  level: 0,
  insideSlot: false,
  gear: "N",
  steerDeg: 0,
};

export default function ParkingView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ParkingSim | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const keysRef = useRef<ParkControls>({
    throttle: false,
    brake: false,
    left: false,
    right: false,
    reverse: false,
  });

  const runningRef = useRef(true);
  const turboRef = useRef(1);
  const camModeRef = useRef<CameraMode>("orbit");
  const showRaysRef = useRef(true);
  const showGhostsRef = useRef(true);

  const [stats, setStats] = useState<ParkingStats>(emptyStats);
  const [running, setRunning] = useState(true);
  const [turbo, setTurbo] = useState(1);
  const [camMode, setCamMode] = useState<CameraMode>("orbit");
  const [showRays, setShowRays] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [manual, setManual] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [config, setConfig] = useState<ParkingConfig>(DEFAULT_PARKING_CONFIG);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { turboRef.current = turbo; }, [turbo]);
  useEffect(() => { camModeRef.current = camMode; }, [camMode]);
  useEffect(() => { showRaysRef.current = showRays; }, [showRays]);
  useEffect(() => { showGhostsRef.current = showGhosts; }, [showGhosts]);

  // ------------------------------------------------------------- 3D setup
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const saved = window.localStorage.getItem(STORAGE_KEY);
    const sim = new ParkingSim(
      DEFAULT_PARKING_CONFIG,
      saved ? (JSON.parse(saved) as NetworkData) : null,
    );
    simRef.current = sim;
    setConfig({ ...sim.config });
    setHasSaved(Boolean(saved));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1120");
    scene.fog = new THREE.Fog("#0b1120", 55, 130);
    buildLights(scene);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

    // hero car (full detail)
    const hero: CarRig = buildCarRig("#38bdf8");
    scene.add(hero.group);

    // ghost population (cheap boxes)
    const ghostGeo = new THREE.BoxGeometry(CAR_LENGTH, 1.1, CAR_WIDTH);
    const ghostMat = new THREE.MeshStandardMaterial({
      color: "#64748b",
      transparent: true,
      opacity: 0.22,
      roughness: 0.8,
    });
    const MAX_GHOSTS = 400;
    const ghosts = new THREE.InstancedMesh(ghostGeo, ghostMat, MAX_GHOSTS);
    ghosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ghosts.frustumCulled = false;
    scene.add(ghosts);

    // sensor rays
    const rayGeo = new THREE.BufferGeometry();
    const rayPositions = new Float32Array(64 * 2 * 3);
    rayGeo.setAttribute("position", new THREE.BufferAttribute(rayPositions, 3));
    const rayLines = new THREE.LineSegments(
      rayGeo,
      new THREE.LineBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.75 }),
    );
    rayLines.frustumCulled = false;
    scene.add(rayLines);

    let lotScene: LotScene | null = null;
    let currentLot: unknown = null;

    const syncLot = () => {
      if (currentLot === sim.lot) return;
      if (lotScene) {
        scene.remove(lotScene.root);
        lotScene.dispose();
      }
      lotScene = buildLotScene(sim.lot);
      scene.add(lotScene.root);
      currentLot = sim.lot;
    };
    syncLot();

    // ------------------------------------------------------- orbit camera
    const orbit = { theta: -Math.PI / 2.6, phi: 0.95, radius: 34, target: new THREE.Vector3(0, 0, -2) };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      orbit.theta -= (e.clientX - lastX) * 0.006;
      orbit.phi = Math.min(1.45, Math.max(0.15, orbit.phi - (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.radius = Math.min(80, Math.max(8, orbit.radius + e.deltaY * 0.03));
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // --------------------------------------------------------- main loop
    const dummy = new THREE.Object3D();
    let raf = 0;
    let lastTime = performance.now();
    let statTimer = 0;
    let prevX = sim.best.x;
    let prevZ = sim.best.z;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const frameDt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (runningRef.current) {
        const steps = Math.max(1, Math.round(turboRef.current));
        for (let i = 0; i < steps; i++) {
          sim.step(sim.manual ? keysRef.current : undefined);
        }
        syncLot();
      }

      const best = sim.best;

      // hero transform
      hero.group.position.set(best.x, 0, best.z);
      hero.group.rotation.y = -best.angle;
      hero.setColor(best.crashed ? "#ef4444" : best.parked ? "#22c55e" : best.color);
      hero.steer(best.steer);
      const moved = Math.hypot(best.x - prevX, best.z - prevZ) * Math.sign(best.speed || 1);
      hero.roll(moved);
      prevX = best.x;
      prevZ = best.z;
      hero.setLights({
        brake: best.controls.brake || best.crashed,
        reverse: best.speed < -0.05,
        head: true,
      });

      // ghosts
      let count = 0;
      if (showGhostsRef.current && !sim.manual) {
        for (const car of sim.cars) {
          if (car === best || count >= MAX_GHOSTS) continue;
          dummy.position.set(car.x, 0.55, car.z);
          dummy.rotation.set(0, -car.angle, 0);
          dummy.updateMatrix();
          ghosts.setMatrixAt(count++, dummy.matrix);
        }
      }
      ghosts.count = count;
      ghosts.instanceMatrix.needsUpdate = true;

      // rays
      if (showRaysRef.current) {
        rayLines.visible = true;
        const arr = rayGeo.attributes.position.array as Float32Array;
        let k = 0;
        for (const ray of best.rays) {
          if (k + 6 > arr.length) break;
          const end = ray.hit ?? ray.to;
          arr[k++] = ray.from.x; arr[k++] = 0.55; arr[k++] = ray.from.y;
          arr[k++] = end.x;      arr[k++] = 0.55; arr[k++] = end.y;
        }
        rayGeo.setDrawRange(0, k / 3);
        rayGeo.attributes.position.needsUpdate = true;
      } else {
        rayLines.visible = false;
      }

      // halo pulse
      if (lotScene) {
        const mat = lotScene.targetHalo.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.14 + Math.sin(now / 380) * 0.07 + (best.insideSlot ? 0.2 : 0);
        mat.color.set(best.parked ? "#22c55e" : best.insideSlot ? "#86efac" : "#22c55e");
      }

      // camera
      const mode = camModeRef.current;
      const fwdX = Math.cos(best.angle);
      const fwdZ = Math.sin(best.angle);
      if (mode === "orbit") {
        orbit.target.lerp(new THREE.Vector3(best.x * 0.35, 0, best.z * 0.35), 0.03);
        const r = orbit.radius;
        camera.position.set(
          orbit.target.x + r * Math.cos(orbit.theta) * Math.cos(orbit.phi),
          orbit.target.y + r * Math.sin(orbit.phi),
          orbit.target.z + r * Math.sin(orbit.theta) * Math.cos(orbit.phi),
        );
        camera.lookAt(orbit.target);
      } else if (mode === "chase") {
        const desired = new THREE.Vector3(best.x - fwdX * 9, 4.6, best.z - fwdZ * 9);
        camera.position.lerp(desired, 1 - Math.pow(0.001, frameDt));
        camera.lookAt(best.x + fwdX * 3, 1, best.z + fwdZ * 3);
      } else if (mode === "driver") {
        camera.position.set(
          best.x + fwdX * 0.35 - Math.sin(best.angle) * -0.35,
          1.45,
          best.z + fwdZ * 0.35,
        );
        camera.lookAt(best.x + fwdX * 12, 1.1, best.z + fwdZ * 12);
      } else {
        camera.position.set(best.x * 0.2, 42, best.z * 0.2 + 0.01);
        camera.lookAt(best.x * 0.2, 0, best.z * 0.2);
      }

      renderer.render(scene, camera);

      statTimer += frameDt;
      if (statTimer > 0.12) {
        statTimer = 0;
        setStats(sim.stats());
      }
    };
    raf = requestAnimationFrame(loop);

    // ------------------------------------------------------------ keyboard
    const keyMap: Record<string, keyof ParkControls> = {
      ArrowUp: "throttle",
      KeyW: "throttle",
      ArrowDown: "reverse",
      KeyS: "reverse",
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      Space: "brake",
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = keyMap[e.code];
      if (!k) return;
      e.preventDefault();
      keysRef.current[k] = down;
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      hero.dispose();
      lotScene?.dispose();
      ghostGeo.dispose();
      ghostMat.dispose();
      rayGeo.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // --------------------------------------------------------------- actions
  const patch = useCallback((p: Partial<ParkingConfig>) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setConfig(p);
    setConfig({ ...sim.config });
  }, []);

  const toggleManual = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.manual) {
      sim.stopManual();
      setManual(false);
      setCamMode("orbit");
    } else {
      sim.startManual();
      setManual(true);
      setCamMode("chase");
    }
  }, []);

  const saveBrain = useCallback(() => {
    const sim = simRef.current;
    const brain = sim?.bestBrain ?? (sim?.best.brain as unknown as NetworkData | undefined);
    if (!brain) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(brain));
    setHasSaved(true);
  }, []);

  const discardBrain = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setHasSaved(false);
  }, []);

  const downloadBrain = useCallback(() => {
    const sim = simRef.current;
    if (!sim?.bestBrain) return;
    const blob = new Blob([JSON.stringify(sim.bestBrain, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parking-brain-gen${sim.generation}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importBrain = useCallback(async (file: File) => {
    const sim = simRef.current;
    if (!sim) return;
    const data = JSON.parse(await file.text()) as NetworkData;
    sim.loadBrain(data);
  }, []);

  const progress = Math.min(1, stats.elapsed / Math.max(1, stats.episodeSeconds));

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="dot" style={{ background: "#4ade80", boxShadow: "0 0 0 4px rgba(74,222,128,0.15)" }} />
          <div>
            <h1>Neural Parking 3D</h1>
            <p>Mobil belajar parkir sendiri · bicycle model + sensor 360° + genetic algorithm</p>
          </div>
        </div>

        <div className="stats">
          <Stat label="Generasi" value={stats.generation} />
          <Stat label="Hidup" value={`${stats.alive}/${stats.population}`} />
          <Stat label="Parkir ✓" value={stats.parked} />
          <Stat label="Skor" value={`${stats.bestScore}`} />
          <Stat label="Rekor" value={`${stats.allTimeBest}`} />
          <Stat label="Jarak slot" value={`${stats.distance.toFixed(1)} m`} />
          <Stat label="Sudut" value={`${stats.headingErrorDeg.toFixed(0)}°`} />
          <Stat label="Sukses" value={`${Math.round(stats.successRate * 100)}%`} />
          <Stat label="Level" value={`${Math.round(stats.level * 100)}%`} />
        </div>
      </header>

      <main className="stage">
        <div ref={mountRef} className="world" style={{ position: "relative", overflow: "hidden" }} />

        <aside className="panel">
          <section>
            <h2>Kendali</h2>
            <div className="row">
              <button className="btn primary" onClick={() => setRunning((r) => !r)}>
                {running ? "⏸ Jeda" : "▶ Jalan"}
              </button>
              <button className="btn" onClick={() => simRef.current?.reset(true)}>
                ↺ Ulangi
              </button>
            </div>
            <div className="row">
              <button className="btn" onClick={toggleManual}>
                {manual ? "🤖 Kembali ke AI" : "🎮 Setir manual"}
              </button>
            </div>
            {manual && (
              <p className="hint">
                W/S atau ↑/↓ = gas &amp; mundur · A/D atau ←/→ = setir · Spasi = rem.
              </p>
            )}

            <label className="field">
              <span>Turbo training ×{turbo}</span>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={turbo}
                onChange={(e) => setTurbo(Number(e.target.value))}
              />
            </label>

            <div className="row">
              {(["orbit", "chase", "driver", "top"] as CameraMode[]).map((m) => (
                <button
                  key={m}
                  className={`btn${camMode === m ? " primary" : ""}`}
                  onClick={() => setCamMode(m)}
                >
                  {m === "orbit" ? "Orbit" : m === "chase" ? "Chase" : m === "driver" ? "Kabin" : "Atas"}
                </button>
              ))}
            </div>

            <label className="field toggle">
              <input type="checkbox" checked={showRays} onChange={(e) => setShowRays(e.target.checked)} />
              <span>Tampilkan sensor</span>
            </label>
            <label className="field toggle">
              <input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} />
              <span>Tampilkan populasi</span>
            </label>
          </section>

          <section>
            <h2>Skenario</h2>
            <div className="row">
              {(["perpendicular", "parallel", "angled"] as LotKind[]).map((k) => (
                <button
                  key={k}
                  className={`btn${config.kind === k ? " primary" : ""}`}
                  onClick={() => patch({ kind: k })}
                >
                  {k === "perpendicular" ? "Tegak lurus" : k === "parallel" ? "Paralel" : "Serong 45°"}
                </button>
              ))}
            </div>

            <label className="field">
              <span>Kepadatan mobil lain {Math.round(config.occupancy * 100)}%</span>
              <input
                type="range" min={0} max={1} step={0.05}
                value={config.occupancy}
                onChange={(e) => patch({ occupancy: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>Kelonggaran slot {config.slack.toFixed(2)} m</span>
              <input
                type="range" min={0} max={1.2} step={0.05}
                value={config.slack}
                onChange={(e) => patch({ slack: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>Durasi percobaan {config.episodeSeconds}s</span>
              <input
                type="range" min={8} max={45} step={1}
                value={config.episodeSeconds}
                onChange={(e) => patch({ episodeSeconds: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>Seed denah {config.seed}</span>
              <input
                type="range" min={1} max={60} step={1}
                value={config.seed}
                onChange={(e) => patch({ seed: Number(e.target.value) })}
              />
            </label>

            <label className="field toggle">
              <input
                type="checkbox"
                checked={config.curriculum}
                onChange={(e) => patch({ curriculum: e.target.checked })}
              />
              <span>Kurikulum bertahap (mulai dekat slot)</span>
            </label>

            <label className="field toggle">
              <input
                type="checkbox"
                checked={config.randomizeLot}
                onChange={(e) => patch({ randomizeLot: e.target.checked })}
              />
              <span>Acak denah tiap generasi</span>
            </label>
          </section>

          <section>
            <h2>Otak</h2>
            <label className="field">
              <span>Populasi {config.population}</span>
              <input
                type="range" min={20} max={300} step={10}
                value={config.population}
                onChange={(e) => patch({ population: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Mutasi {config.mutationRate.toFixed(2)}</span>
              <input
                type="range" min={0.02} max={0.6} step={0.02}
                value={config.mutationRate}
                onChange={(e) => patch({ mutationRate: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Sensor {config.rayCount} arah (360°)</span>
              <input
                type="range" min={6} max={24} step={2}
                value={config.rayCount}
                onChange={(e) => patch({ rayCount: Number(e.target.value) })}
              />
            </label>

            <div className="row">
              <button className="btn primary" onClick={saveBrain}>💾 Simpan</button>
              <button className="btn" onClick={discardBrain} disabled={!hasSaved}>🗑 Hapus</button>
            </div>
            <div className="row">
              <button className="btn" onClick={downloadBrain}>⬇ Ekspor</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Impor</button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importBrain(f);
                e.target.value = "";
              }}
            />
          </section>

          <section>
            <h2>Telemetri</h2>
            <div className="telemetry">
              <div><span>Gigi</span><b>{stats.gear}</b></div>
              <div><span>Kecepatan</span><b>{(stats.speed * 3.6).toFixed(1)} km/j</b></div>
              <div><span>Setir</span><b>{stats.steerDeg.toFixed(0)}°</b></div>
              <div><span>Di dalam slot</span><b>{stats.insideSlot ? "ya" : "belum"}</b></div>
              <div><span>Nabrak</span><b>{stats.crashed}</b></div>
              <div><span>Kesulitan</span><b>{Math.round(stats.level * 100)}%</b></div>
            </div>
            <div className="episode-bar"><i style={{ width: `${progress * 100}%` }} /></div>
            <p className="hint">
              Episode {stats.elapsed.toFixed(1)}s / {stats.episodeSeconds}s · drag untuk memutar
              kamera, scroll untuk zoom.
            </p>
            <p className="hint">
              <Link href="/">← Kembali ke mode balap / jalan raya</Link>
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export const CAR_SIZE = { CAR_LENGTH, CAR_WIDTH };
