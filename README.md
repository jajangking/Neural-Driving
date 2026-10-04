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
- **6 scene / sirkuit** yang bisa diganti kapan saja tanpa reload — brain ikut dibawa pindah:
  | Scene | Tipe | Catatan |
  |---|---|---|
  | Highway | lurus, terbuka | padat, fokus menyalip |
  | Jalan Berkelok | sinus panjang, terbuka | tikungan S |
  | Sirkuit Oval | loop tertutup | menghitung **lap** |
  | Sirkuit GP | loop tertutup acak | hairpin, layout bisa diacak |
  | Slalom | lurus + barrier zig-zag | nyaris tanpa lalu lintas |
  | Rally Chicane | berkelok + kerucut acak | mode tersulit |
- **Generator track berbasis seed** — tombol *Acak layout* bikin sirkuit baru yang deterministik.
- **Lalu lintas mengikuti jalur** (ikut menikung), kepadatan & jumlah lajur bisa diatur, auto-recycle di depan pemimpin.
- **Kamera follow + zoom 0.25–1.6×**, garis start kuning & finish hijau, progres/lap real-time.
- **Turbo 1–12×** untuk mempercepat training, pause/play, skip generasi.
- **Simpan / hapus / export / import brain** (localStorage + file JSON) — brain tersimpan otomatis dipakai lagi saat halaman dibuka.
- **Mode manual** (WASD / arrow keys) untuk ikut nyetir di tengah simulasi.
- **Mode balapan 1v1** — adu dua brain di lintasan yang sama: grid start, klasemen live
  (posisi, lap, gap, kecepatan, status crash/finish), waktu finis, dan penentuan pemenang.
  Lawan bisa diambil dari file JSON, brain tersimpan, atau mutan otomatis dari brain utama.

## 🅿️ Mode Parkir 3D (`/parking`)

Mode kedua: mobil belajar **parkir sendiri** di dunia **3D (three.js)** — bukan lagi top-down 2D.

- **Model mobil 3D detail** dibangun dari kode (`lib/parking/model3d.ts`): bodi membulat, kap & bagasi
  meruncing, kabin + kaca tembus pandang, bumper, grille berlapis krom, lampu depan/rem/mundur yang
  benar-benar menyala, spion, gagang pintu, knalpot, pelat nomor, antena, dan 4 roda lengkap
  (ban, velg 5 palang, cakram) yang **berputar sesuai jarak tempuh** dan **membelok mengikuti setir**.
- **Fisika bicycle model** dengan sudut setir, wheelbase, gigi maju/mundur, rem, dan drag —
  supaya manuver mundur-masuk-slot terasa benar.
- **Sensor 360°** (6–24 ray) + input relatif ke slot: posisi di kerangka mobil *dan* di kerangka slot,
  error sudut, kecepatan, sudut setir.
- **Otak kontinu** (`lib/parking/brain.ts`): MLP tanh, output = sumbu gas (maju/mundur), sumbu setir
  proporsional, dan rem. Jauh lebih halus daripada output biner mode balap.
- **Genetic algorithm**: elitisme top-12%, crossover seragam, mutasi gaussian bertingkat.
- **Kurikulum otomatis** — populasi mulai dari posisi sudah lurus di depan slot, lalu titik start
  mundur menjauh tiap kali ada yang berhasil parkir. Tanpa ini reward-nya terlalu jarang untuk dipelajari.
- **3 skenario**: parkir **tegak lurus**, **paralel** (kerbside), dan **serong 45°**, dengan kepadatan
  mobil lain, kelonggaran slot, seed denah, dan durasi percobaan yang bisa diatur.
- **4 kamera**: orbit (drag + scroll), chase, kabin pengemudi, dan tampak atas.
- **Setir manual** (WASD/arrow + spasi rem), simpan/hapus/ekspor/impor brain, turbo 1–20×.

Fitness-nya berlapis: kedekatan eksponensial ke slot × kelurusan², seberapa banyak bodi mobil masuk
slot, bonus besar saat seluruh mobil di dalam slot dan **berhenti** lurus selama ~1 detik, dikurangi
penalti waktu dan diskon berat kalau menabrak.

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

### Mode balapan

Tab **Balapan** di panel kanan mengadu **Brain A** (brain yang sedang dilatih) melawan seorang
**lawan**: file JSON hasil export, brain yang tersimpan di browser, atau mutan otomatis dari Brain A.
Keduanya start dari grid yang sama, melewati lalu lintas yang sama, dan:

- **Track terbuka** → pemenang = yang pertama menyentuh garis finis hijau.
- **Sirkuit tertutup** → pemenang = yang pertama menyelesaikan target lap (1–5).
- Kalau keduanya crash, pemenangnya yang paling jauh melaju (status `DNF`).

Tips training: mulai dengan mutasi tinggi (~0.4) dan turbo tinggi, **Simpan** setiap kali ada lompatan
rekor, lalu turunkan mutasi (~0.05–0.1) untuk menghaluskan perilaku.

## Struktur

```
app/                 halaman Next.js (App Router)
components/
  SimulationView.tsx UI, render loop, kontrol, persistensi brain
  ParkingView.tsx    UI + renderer three.js untuk mode parkir 3D
lib/
  network.ts         neural network + mutasi + serialisasi
  sensor.ts          raycasting
  car.ts             fisika mobil, tabrakan, kontrol
  track.ts           geometri track (centerline, tepi, lane, progres)
  scenes.ts          definisi 6 scene + generator track berseed
  traffic.ts         lalu lintas yang menyusuri jalur
  race.ts            mode balapan 1v1 + klasemen
  drive.ts           satu langkah mobil di atas track (dipakai latihan & balapan)
  render.ts          penggambar track bersama
  simulation.ts      dunia, populasi, genetic algorithm
  visualizer.ts      render jaringan saraf
  parking/
    lot.ts           denah parkir (slot, mobil terparkir, tembok, pilar) berseed
    car.ts           bicycle model + sensor 360° + fungsi fitness parkir
    brain.ts         MLP tanh + mutasi gaussian + crossover
    sim.ts           populasi, genetic algorithm, kurikulum
    model3d.ts       model 3D mobil detail (bodi, kaca, lampu, roda)
    scene3d.ts       denah 3D, marka, aspal prosedural, lampu
  utils.ts           lerp, intersection, helper warna
```

## Lisensi

MIT
