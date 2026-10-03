# Neural Driving

Simulasi mobil yang **belajar menyetir sendiri** langsung di browser — tanpa library ML, tanpa backend.
Setiap mobil punya neural network kecil yang membaca sensor raycast dan memutuskan gas, rem, dan belok.
Populasi mobil dievolusikan dengan *genetic algorithm*: yang paling jauh melaju jadi induk generasi berikutnya.

![stack](https://img.shields.io/badge/Next.js-16-black) ![ts](https://img.shields.io/badge/TypeScript-5-blue) ![deps](https://img.shields.io/badge/ML%20deps-0-brightgreen)

## Fitur

- **Neural network from scratch** (`lib/network.ts`) — feedforward multi-layer, aktivasi threshold, mutasi berbobot.
- **Sensor raycast** 3–15 ray, mendeteksi pembatas jalan & mobil lain, dinormalisasi ke `[0,1]`.
- **Genetic algorithm** — populasi s/d 500 mobil paralel, elitism + mutasi, fitness = jarak tempuh.
- **Visualizer jaringan** real-time: bobot, bias, dan neuron aktif mobil terbaik.
- **Jalan tak terbatas** dengan lalu lintas prosedural (kepadatan & jumlah lajur bisa diatur).
- **Turbo 1–12×** untuk mempercepat training, pause/play, skip generasi.
- **Simpan / hapus / export / import brain** (localStorage + file JSON) — brain tersimpan otomatis dipakai lagi saat halaman dibuka.
- **Mode manual** (WASD / arrow keys) untuk ikut nyetir di tengah simulasi.

## Jalankan lokal

```bash
npm install
npm run dev
# buka http://localhost:3000
```

Perintah lain:

```bash
npm run build   # production build
npm run start   # jalankan hasil build
npm run lint    # eslint
```

## Deploy ke Vercel

Proyek ini Next.js App Router standar, 100% static-friendly (tidak ada server state), jadi deploy-nya instan:

1. Push repo ini ke GitHub.
2. Buka [vercel.com/new](https://vercel.com/new) → **Import** repo `Neural-Driving`.
3. Biarkan semua default (Framework: Next.js, Build: `next build`), klik **Deploy**.

Atau lewat CLI:

```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

Tidak ada environment variable yang dibutuhkan.

## Cara kerja singkat

```
sensor (n ray)  →  hidden layer  →  4 output
   [0..1]                           ↑ ← → ↓
```

1. Tiap tick, sensor menembakkan ray dan mengukur jarak ke objek terdekat.
2. Nilai sensor masuk ke `NeuralNetwork.feedForward` → 4 output biner jadi kontrol mobil.
3. Mobil yang menabrak pembatas/mobil lain "mati". Fitness = jarak terjauh yang dicapai.
4. Saat semua mati (atau macet), brain terbaik di-clone ke seluruh populasi berikutnya, lalu dimutasi
   sebesar *mutation rate* — kecuali satu mobil yang tetap murni (elitism).

Tips training: mulai dengan mutasi tinggi (~0.4) dan turbo tinggi, **Simpan** setiap kali ada lompatan
rekor, lalu turunkan mutasi (~0.05–0.1) untuk menghaluskan perilaku.

## Struktur

```
app/                 halaman Next.js (App Router)
components/
  SimulationView.tsx UI, render loop, kontrol, persistensi brain
lib/
  network.ts         neural network + mutasi + serialisasi
  sensor.ts          raycasting
  car.ts             fisika mobil, tabrakan, kontrol
  road.ts            jalan & lajur
  traffic via simulation.ts
  simulation.ts      dunia, populasi, genetic algorithm
  visualizer.ts      render jaringan saraf
  utils.ts           lerp, intersection, helper warna
```

## Lisensi

MIT
