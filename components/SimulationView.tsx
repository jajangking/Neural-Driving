"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_CONFIG,
  Simulation,
  type SimulationConfig,
  type SimulationStats,
} from "@/lib/simulation";
import type { Controls } from "@/lib/car";
import type { NetworkData } from "@/lib/network";
import { Visualizer } from "@/lib/visualizer";

const STORAGE_KEY = "neural-driving:brain";

const BRAIN_EVENT = "neural-driving:brain-changed";

function subscribeToBrainStore(onChange: () => void) {
  window.addEventListener(BRAIN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BRAIN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function notifyBrainStore() {
  window.dispatchEvent(new Event(BRAIN_EVENT));
}

const emptyStats: SimulationStats = {
  generation: 1,
  alive: 0,
  population: 0,
  distance: 0,
  bestDistance: 0,
  speed: 0,
  ticks: 0,
};

export default function SimulationView() {
  const worldRef = useRef<HTMLCanvasElement>(null);
  const brainRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const keysRef = useRef<Controls>({
    forward: false,
    left: false,
    right: false,
    reverse: false,
  });

  const [stats, setStats] = useState<SimulationStats>(emptyStats);
  const [running, setRunning] = useState(true);
  const [turbo, setTurbo] = useState(1);
  const [showSensors, setShowSensors] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [manualDrive, setManualDrive] = useState(false);
  const [config, setConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [toast, setToast] = useState<string | null>(null);

  const hasSaved = useSyncExternalStore(
    subscribeToBrainStore,
    () => window.localStorage.getItem(STORAGE_KEY) !== null,
    () => false,
  );

  const runningRef = useRef(running);
  const turboRef = useRef(turbo);
  const sensorsRef = useRef(showSensors);
  const ghostsRef = useRef(showGhosts);

  useEffect(() => {
    runningRef.current = running;
    turboRef.current = turbo;
    sensorsRef.current = showSensors;
    ghostsRef.current = showGhosts;
  }, [running, turbo, showSensors, showGhosts]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // boot the simulation once
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);

    const sim = new Simulation(DEFAULT_CONFIG);
    if (saved) {
      try {
        sim.loadBrain(JSON.parse(saved) as NetworkData);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        notifyBrainStore();
      }
    }
    simRef.current = sim;

    const world = worldRef.current!;
    const brainCanvas = brainRef.current!;
    const wctx = world.getContext("2d")!;
    const bctx = brainCanvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const [canvas, ctx] of [
        [world, wctx],
        [brainCanvas, bctx],
      ] as const) {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const s = simRef.current;
      if (!s) return;

      if (runningRef.current) {
        for (let i = 0; i < turboRef.current; i++) {
          s.step(keysRef.current);
        }
      }

      const wRect = world.getBoundingClientRect();
      s.render(wctx, wRect.width, wRect.height, {
        showSensors: sensorsRef.current,
        showGhosts: ghostsRef.current,
      });

      const bRect = brainCanvas.getBoundingClientRect();
      bctx.clearRect(0, 0, bRect.width, bRect.height);
      if (s.bestCar?.brain) {
        bctx.lineDashOffset = -(performance.now() / 50) % 1000;
        Visualizer.drawNetwork(
          bctx,
          s.bestCar.brain,
          24,
          24,
          bRect.width - 48,
          bRect.height - 48,
        );
      }

      if (frame++ % 6 === 0) setStats(s.stats);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // keyboard driving
  useEffect(() => {
    if (!manualDrive) return;
    const set = (key: string, value: boolean) => {
      const k = keysRef.current;
      if (key === "ArrowUp" || key === "w") k.forward = value;
      if (key === "ArrowDown" || key === "s") k.reverse = value;
      if (key === "ArrowLeft" || key === "a") k.left = value;
      if (key === "ArrowRight" || key === "d") k.right = value;
    };
    const down = (e: KeyboardEvent) => set(e.key, true);
    const up = (e: KeyboardEvent) => set(e.key, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [manualDrive]);

  const applyConfig = useCallback(
    (partial: Partial<SimulationConfig>, restart = false) => {
      setConfig((prev) => {
        const next = { ...prev, ...partial };
        simRef.current?.setConfig(next);
        if (restart) simRef.current?.reset();
        return next;
      });
    },
    [],
  );

  const saveBrain = () => {
    const data = simRef.current?.getBrain();
    if (!data) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    notifyBrainStore();
    flash("Brain tersimpan di browser");
  };

  const discardBrain = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyBrainStore();
    simRef.current?.clearBrain();
    flash("Brain dihapus, mulai dari nol");
  };

  const exportBrain = () => {
    const data = simRef.current?.getBrain();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neural-driving-gen${simRef.current?.generation ?? 0}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBrain = (file: File) => {
    file
      .text()
      .then((text) => {
        const data = JSON.parse(text) as NetworkData;
        simRef.current?.loadBrain(data);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        notifyBrainStore();
        flash("Brain dimuat dari file");
      })
      .catch(() => flash("File brain tidak valid"));
  };

  const toggleManual = () => {
    const sim = simRef.current;
    if (!sim) return;
    if (manualDrive) {
      sim.removePlayer();
      setManualDrive(false);
    } else {
      sim.spawnPlayer();
      setManualDrive(true);
    }
  };

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <div>
            <h1>Neural Driving</h1>
            <p>Self-driving car · neural network + genetic algorithm</p>
          </div>
        </div>
        <div className="stats">
          <Stat label="Generasi" value={stats.generation} />
          <Stat label="Hidup" value={`${stats.alive}/${stats.population}`} />
          <Stat label="Jarak" value={`${stats.distance} px`} />
          <Stat label="Rekor" value={`${stats.bestDistance} px`} />
          <Stat label="Kecepatan" value={stats.speed} />
        </div>
      </header>

      <main className="stage">
        <canvas ref={worldRef} className="world" />
        <aside className="panel">
          <section>
            <h2>Kontrol</h2>
            <div className="row">
              <button
                className={running ? "btn" : "btn primary"}
                onClick={() => setRunning((r) => !r)}
              >
                {running ? "Pause" : "Play"}
              </button>
              <button
                className="btn"
                onClick={() => simRef.current?.nextGeneration()}
              >
                Skip generasi
              </button>
            </div>
            <label className="field">
              <span>
                Turbo <b>{turbo}x</b>
              </span>
              <input
                type="range"
                min={1}
                max={12}
                value={turbo}
                onChange={(e) => setTurbo(Number(e.target.value))}
              />
            </label>
          </section>

          <section>
            <h2>Evolusi</h2>
            <label className="field">
              <span>
                Populasi <b>{config.population}</b>
              </span>
              <input
                type="range"
                min={20}
                max={500}
                step={10}
                value={config.population}
                onChange={(e) =>
                  applyConfig({ population: Number(e.target.value) })
                }
                onMouseUp={() => simRef.current?.reset()}
                onTouchEnd={() => simRef.current?.reset()}
              />
            </label>
            <label className="field">
              <span>
                Mutasi <b>{config.mutationRate.toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={0.01}
                max={0.8}
                step={0.01}
                value={config.mutationRate}
                onChange={(e) =>
                  applyConfig({ mutationRate: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>
                Sensor <b>{config.rayCount} ray</b>
              </span>
              <input
                type="range"
                min={3}
                max={15}
                step={2}
                value={config.rayCount}
                onChange={(e) =>
                  applyConfig({ rayCount: Number(e.target.value) }, true)
                }
              />
            </label>
            <label className="field">
              <span>
                Kepadatan lalu lintas{" "}
                <b>{Math.round(config.trafficDensity * 100)}%</b>
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={config.trafficDensity}
                onChange={(e) =>
                  applyConfig({ trafficDensity: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>
                Jumlah lajur <b>{config.laneCount}</b>
              </span>
              <input
                type="range"
                min={2}
                max={6}
                value={config.laneCount}
                onChange={(e) =>
                  applyConfig({ laneCount: Number(e.target.value) }, true)
                }
              />
            </label>
          </section>

          <section>
            <h2>Brain</h2>
            <div className="row">
              <button className="btn primary" onClick={saveBrain}>
                Simpan
              </button>
              <button className="btn" onClick={discardBrain} disabled={!hasSaved}>
                Hapus
              </button>
            </div>
            <div className="row">
              <button className="btn" onClick={exportBrain}>
                Export JSON
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Import
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importBrain(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="hint">
              {hasSaved
                ? "Ada brain tersimpan — otomatis dipakai saat halaman dibuka."
                : "Belum ada brain tersimpan. Simpan saat mobil sudah pintar."}
            </p>
          </section>

          <section>
            <h2>Tampilan</h2>
            <Toggle
              label="Sensor raycast"
              checked={showSensors}
              onChange={setShowSensors}
            />
            <Toggle
              label="Ghost populasi"
              checked={showGhosts}
              onChange={setShowGhosts}
            />
            <Toggle
              label="Mode manual (WASD / arrow)"
              checked={manualDrive}
              onChange={toggleManual}
            />
          </section>

          <section className="brain-box">
            <h2>Jaringan saraf mobil terbaik</h2>
            <canvas ref={brainRef} className="brain" />
          </section>
        </aside>
      </main>

      {toast && <div className="toast">{toast}</div>}
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
