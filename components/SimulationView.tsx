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
import { Race, type RaceEntry, type Standing } from "@/lib/race";
import { SCENES, getScene } from "@/lib/scenes";
import type { Controls } from "@/lib/car";
import { NeuralNetwork, type NetworkData } from "@/lib/network";
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

function mutatedCopy(brain: NetworkData, amount: number): NetworkData {
  const net = NeuralNetwork.fromJSON(brain);
  NeuralNetwork.mutate(net, amount);
  return JSON.parse(JSON.stringify(net)) as NetworkData;
}

const emptyStats: SimulationStats = {
  sceneName: getScene(DEFAULT_CONFIG.sceneId).name,
  generation: 1,
  alive: 0,
  population: 0,
  distance: 0,
  bestDistance: 0,
  laps: 0,
  progressPct: 0,
  speed: 0,
  finished: 0,
  ticks: 0,
};

type Mode = "train" | "race";

export default function SimulationView() {
  const worldRef = useRef<HTMLCanvasElement>(null);
  const brainRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const raceRef = useRef<Race | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rivalFileRef = useRef<HTMLInputElement>(null);
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

  // race state
  const [mode, setMode] = useState<Mode>("train");
  const [standings, setStandings] = useState<Standing[]>([]);
  const [raceOver, setRaceOver] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [raceTime, setRaceTime] = useState(0);
  const [targetLaps, setTargetLaps] = useState(2);
  const [raceTraffic, setRaceTraffic] = useState(true);
  const [rival, setRival] = useState<{ label: string; brain: NetworkData } | null>(
    null,
  );

  const hasSaved = useSyncExternalStore(
    subscribeToBrainStore,
    () => window.localStorage.getItem(STORAGE_KEY) !== null,
    () => false,
  );

  const runningRef = useRef(running);
  const turboRef = useRef(turbo);
  const sensorsRef = useRef(showSensors);
  const ghostsRef = useRef(showGhosts);
  const modeRef = useRef<Mode>(mode);

  useEffect(() => {
    runningRef.current = running;
    turboRef.current = turbo;
    sensorsRef.current = showSensors;
    ghostsRef.current = showGhosts;
    modeRef.current = mode;
  }, [running, turbo, showSensors, showGhosts, mode]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  // boot
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
      const wRect = world.getBoundingClientRect();
      const bRect = brainCanvas.getBoundingClientRect();
      let brain: NeuralNetwork | null = null;

      if (modeRef.current === "race" && raceRef.current) {
        const race = raceRef.current;
        if (runningRef.current && !race.over) {
          for (let i = 0; i < turboRef.current; i++) {
            race.step();
            if (race.over) break;
          }
        }
        race.render(wctx, wRect.width, wRect.height, {
          showSensors: sensorsRef.current,
        });
        brain = race.leader?.brain ?? null;
        if (frame % 6 === 0) {
          setStandings(race.standings);
          setRaceOver(race.over);
          setWinner(race.winner);
          setRaceTime(Number((race.ticks / 60).toFixed(1)));
        }
      } else {
        const s = simRef.current;
        if (s) {
          if (runningRef.current) {
            for (let i = 0; i < turboRef.current; i++) s.step(keysRef.current);
          }
          s.render(wctx, wRect.width, wRect.height, {
            showSensors: sensorsRef.current,
            showGhosts: ghostsRef.current,
          });
          brain = s.bestCar?.brain ?? null;
          if (frame % 6 === 0) setStats(s.stats);
        }
      }

      bctx.clearRect(0, 0, bRect.width, bRect.height);
      if (brain) {
        bctx.lineDashOffset = -(performance.now() / 50) % 1000;
        Visualizer.drawNetwork(bctx, brain, 24, 24, bRect.width - 48, bRect.height - 48);
      }
      frame++;
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // manual driving (training mode only)
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

  const scene = getScene(config.sceneId);

  const applyConfig = useCallback(
    (partial: Partial<SimulationConfig>, restart = false) => {
      setConfig((prev) => {
        const next = { ...prev, ...partial };
        simRef.current?.setConfig(next);
        if (raceRef.current && partial.zoom !== undefined) {
          raceRef.current.options.zoom = partial.zoom;
        }
        if (restart) simRef.current?.reset();
        return next;
      });
    },
    [],
  );

  // ----------------------------------------------------------- race logic

  const buildRace = useCallback(
    (cfg: SimulationConfig, rivalBrain: { label: string; brain: NetworkData } | null) => {
      const sim = simRef.current;
      if (!sim) return false;
      const champion = sim.getBrain();
      if (!champion) {
        flash("Belum ada brain untuk dibalapkan");
        return false;
      }
      const opponent = rivalBrain ?? {
        label: "Mutan A (0.15)",
        brain: mutatedCopy(champion, 0.15),
      };
      const entries: RaceEntry[] = [
        { name: "Brain A", color: "#38bdf8", brain: champion },
        { name: opponent.label, color: "#f472b6", brain: opponent.brain },
      ];
      raceRef.current = new Race(entries, {
        sceneId: cfg.sceneId,
        seed: cfg.seed,
        laneCount: cfg.laneCount,
        trafficDensity: raceTraffic ? cfg.trafficDensity : 0,
        maxSpeed: cfg.maxSpeed,
        targetLaps,
        zoom: cfg.zoom,
      });
      setStandings(raceRef.current.standings);
      setRaceOver(false);
      setWinner(null);
      setRaceTime(0);
      return true;
    },
    [flash, raceTraffic, targetLaps],
  );

  const startRace = () => {
    if (!buildRace(config, rival)) return;
    setMode("race");
    setRunning(true);
    flash(`Balapan dimulai di ${scene.name}`);
  };

  const restartRace = () => {
    if (!buildRace(config, rival)) return;
    setRunning(true);
  };

  const backToTraining = () => {
    raceRef.current = null;
    setMode("train");
    setStandings([]);
    setRaceOver(false);
    setWinner(null);
  };

  const loadRivalFromFile = (file: File) => {
    file
      .text()
      .then((text) => {
        const brain = JSON.parse(text) as NetworkData;
        NeuralNetwork.fromJSON(brain); // validate
        setRival({ label: file.name.replace(/\.json$/i, "").slice(0, 18), brain });
        flash("Lawan dimuat dari file");
      })
      .catch(() => flash("File brain lawan tidak valid"));
  };

  const useSavedAsRival = () => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return flash("Belum ada brain tersimpan");
    try {
      setRival({ label: "Brain tersimpan", brain: JSON.parse(raw) as NetworkData });
      flash("Lawan = brain tersimpan");
    } catch {
      flash("Brain tersimpan rusak");
    }
  };

  // -------------------------------------------------------- scene & brain

  const switchScene = (sceneId: string, keepBrain = true) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setScene(sceneId, { keepBrain });
    const next = { ...sim.config };
    setConfig(next);
    if (modeRef.current === "race") buildRace(next, rival);
    flash(
      keepBrain
        ? `Pindah ke ${getScene(sceneId).name} — brain dibawa`
        : `${getScene(sceneId).name} — mulai dari nol`,
    );
  };

  const randomizeScene = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.randomizeScene();
    const next = { ...sim.config };
    setConfig(next);
    if (modeRef.current === "race") buildRace(next, rival);
    flash("Layout track diacak");
  };

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
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neural-driving-${config.sceneId}-gen${simRef.current?.generation ?? 0}.json`;
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

  // ------------------------------------------------------------------ UI

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <div>
            <h1>Neural Driving</h1>
            <p>Self-driving car · neural network + genetic algorithm</p>
          </div>
          <a className="navlink" href="/parking">
            🅿️ Mode Parkir 3D
          </a>
        </div>

        {mode === "train" ? (
          <div className="stats">
            <Stat label="Scene" value={stats.sceneName} />
            <Stat label="Generasi" value={stats.generation} />
            <Stat label="Hidup" value={`${stats.alive}/${stats.population}`} />
            {scene.closed ? (
              <Stat label="Lap" value={`${stats.laps} (${stats.progressPct}%)`} />
            ) : (
              <Stat label="Progres" value={`${stats.progressPct}%`} />
            )}
            <Stat label="Jarak" value={`${stats.distance} px`} />
            <Stat label="Rekor" value={`${stats.bestDistance} px`} />
          </div>
        ) : (
          <div className="stats">
            <Stat label="Mode" value="Balapan" />
            <Stat label="Scene" value={scene.name} />
            <Stat label="Waktu" value={`${raceTime}s`} />
            {scene.closed && <Stat label="Target" value={`${targetLaps} lap`} />}
            <Stat label="Status" value={raceOver ? `🏁 ${winner ?? "-"}` : "Berjalan"} />
          </div>
        )}
      </header>

      <main className="stage">
        <canvas ref={worldRef} className="world" />
        <aside className="panel">
          <div className="tabs">
            <button
              className={`tab ${mode === "train" ? "active" : ""}`}
              onClick={backToTraining}
            >
              Latihan
            </button>
            <button
              className={`tab ${mode === "race" ? "active" : ""}`}
              onClick={() => (mode === "race" ? restartRace() : startRace())}
            >
              Balapan
            </button>
          </div>

          {mode === "race" ? (
            <>
              <section>
                <h2>Klasemen</h2>
                <ol className="standings">
                  {standings.map((s) => (
                    <li key={s.name} className={`standing ${s.status}`}>
                      <span className="pos">{s.position}</span>
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="who">
                        <b>{s.name}</b>
                        <small>
                          {s.status === "finished"
                            ? `selesai · ${s.timeSec}s`
                            : s.status === "crashed" || s.status === "dnf"
                              ? "crash"
                              : scene.closed
                                ? `lap ${s.lap}`
                                : `${s.progress} px`}
                          {s.position > 1 && s.gap > 0 ? ` · -${s.gap} px` : ""}
                        </small>
                      </span>
                      <span className="spd">{s.speed}</span>
                    </li>
                  ))}
                </ol>
                {raceOver && (
                  <p className="winner">🏁 Pemenang: <b>{winner}</b></p>
                )}
              </section>

              <section>
                <h2>Pengaturan balapan</h2>
                <div className="row">
                  <button className="btn primary" onClick={restartRace}>
                    {raceOver ? "Balapan lagi" : "Restart"}
                  </button>
                  <button className="btn" onClick={() => setRunning((r) => !r)}>
                    {running ? "Pause" : "Play"}
                  </button>
                </div>
                <label className="field">
                  <span>
                    Kecepatan tayang <b>{turbo}x</b>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={turbo}
                    onChange={(e) => setTurbo(Number(e.target.value))}
                  />
                </label>
                {scene.closed && (
                  <label className="field">
                    <span>
                      Target lap <b>{targetLaps}</b>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={targetLaps}
                      onChange={(e) => setTargetLaps(Number(e.target.value))}
                    />
                  </label>
                )}
                <label className="field">
                  <span>
                    Zoom kamera <b>{config.zoom.toFixed(2)}x</b>
                  </span>
                  <input
                    type="range"
                    min={0.25}
                    max={1.6}
                    step={0.05}
                    value={config.zoom}
                    onChange={(e) => applyConfig({ zoom: Number(e.target.value) })}
                  />
                </label>
                <Toggle
                  label="Lalu lintas di lintasan"
                  checked={raceTraffic}
                  onChange={setRaceTraffic}
                />
                <Toggle label="Sensor raycast" checked={showSensors} onChange={setShowSensors} />
              </section>

              <section>
                <h2>Pembalap</h2>
                <p className="hint">
                  <b style={{ color: "#38bdf8" }}>Brain A</b> = brain yang sedang dilatih.
                  <br />
                  <b style={{ color: "#f472b6" }}>Lawan</b> = {rival?.label ?? "Mutan A (0.15)"}
                </p>
                <div className="row">
                  <button className="btn" onClick={() => rivalFileRef.current?.click()}>
                    Lawan dari file
                  </button>
                  <button className="btn" onClick={useSavedAsRival} disabled={!hasSaved}>
                    Lawan = tersimpan
                  </button>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => setRival(null)}>
                    Pakai mutan A
                  </button>
                </div>
                <input
                  ref={rivalFileRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadRivalFromFile(f);
                    e.target.value = "";
                  }}
                />
              </section>
            </>
          ) : (
            <>
              <section>
                <h2>Kontrol</h2>
                <div className="row">
                  <button
                    className={running ? "btn" : "btn primary"}
                    onClick={() => setRunning((r) => !r)}
                  >
                    {running ? "Pause" : "Play"}
                  </button>
                  <button className="btn" onClick={() => simRef.current?.nextGeneration()}>
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
                <label className="field">
                  <span>
                    Zoom kamera <b>{config.zoom.toFixed(2)}x</b>
                  </span>
                  <input
                    type="range"
                    min={0.25}
                    max={1.6}
                    step={0.05}
                    value={config.zoom}
                    onChange={(e) => applyConfig({ zoom: Number(e.target.value) })}
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
                    onChange={(e) => applyConfig({ population: Number(e.target.value) })}
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
                    onChange={(e) => applyConfig({ mutationRate: Number(e.target.value) })}
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
                    onChange={(e) => applyConfig({ rayCount: Number(e.target.value) }, true)}
                  />
                </label>
                <label className="field">
                  <span>
                    Kepadatan lalu lintas <b>{Math.round(config.trafficDensity * 100)}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.trafficDensity}
                    onChange={(e) => applyConfig({ trafficDensity: Number(e.target.value) })}
                    onMouseUp={() => simRef.current?.reset()}
                    onTouchEnd={() => simRef.current?.reset()}
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
                    onChange={(e) => applyConfig({ laneCount: Number(e.target.value) }, true)}
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
                <Toggle label="Sensor raycast" checked={showSensors} onChange={setShowSensors} />
                <Toggle label="Ghost populasi" checked={showGhosts} onChange={setShowGhosts} />
                <Toggle
                  label="Mode manual (WASD / arrow)"
                  checked={manualDrive}
                  onChange={toggleManual}
                />
              </section>
            </>
          )}

          <section>
            <h2>Scene / sirkuit</h2>
            <div className="scenes">
              {SCENES.map((s) => (
                <button
                  key={s.id}
                  className={`scene ${s.id === config.sceneId ? "active" : ""}`}
                  onClick={() => switchScene(s.id)}
                  title={s.description}
                >
                  <b>{s.name}</b>
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn" onClick={randomizeScene} disabled={!scene.randomizable}>
                Acak layout
              </button>
              {mode === "train" && (
                <button className="btn" onClick={() => switchScene(config.sceneId, false)}>
                  Reset brain
                </button>
              )}
            </div>
          </section>

          <section className="brain-box">
            <h2>{mode === "race" ? "Jaringan saraf pemimpin" : "Jaringan saraf mobil terbaik"}</h2>
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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
