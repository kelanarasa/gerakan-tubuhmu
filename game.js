/* =====================================================================
   GERAKAN TUBUHMU - game.js  (Tahap 1: deteksi tubuh dengan kamera)

   Alur singkat:
   1. Pemain menekan "Aktifkan Kamera" -> browser meminta izin kamera.
   2. Library MediaPipe + model pose dimuat dari internet (CDN).
   3. Satu loop requestAnimationFrame berjalan terus: membaca pose dari
      video, memperbarui karakter, lalu menggambar canvas.
   4. Dari 12 titik tubuh kita hitung: posisi kiri-kanan, lompat,
      dan kedua tangan terangkat.

   Semua pemrosesan video terjadi di browser. Tidak ada video yang
   dikirim ke server.
   ===================================================================== */
"use strict";
import { Suara } from "./suara.js";   // efek suara + musik latar (dibuat dengan Web Audio, tanpa file audio)

/* ---------------------------------------------------------------------
   1. KONFIGURASI
   --------------------------------------------------------------------- */

// Library dan model dimuat dari CDN -> BUTUH INTERNET.
// Setiap daftar dicoba berurutan; yang pertama berhasil dipakai.
// Sumber terakhir adalah file LOKAL (opsional) untuk jaringan yang memblokir CDN:
//   Body-Quest/lib/vision_bundle.mjs  dan folder  Body-Quest/lib/wasm/
//   Body-Quest/models/pose_landmarker_lite.task
// Versi 0.10.14 diketahui bermasalah di sebagian browser ("dbg is not a function"),
// jadi versi yang lebih baru dicoba lebih dulu. Ubah daftar ini bila perlu.
const MP_VERSIONS = ["0.10.34", "0.10.21", "0.10.14"];
const MP_SOURCES = MP_VERSIONS.map((v) => ({
  name: "jsDelivr " + v,
  module: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + v + "/vision_bundle.mjs",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + v + "/wasm"
}));
MP_SOURCES.push({
  name: "unpkg " + MP_VERSIONS[0],
  module: "https://unpkg.com/@mediapipe/tasks-vision@" + MP_VERSIONS[0] + "/vision_bundle.mjs",
  wasm: "https://unpkg.com/@mediapipe/tasks-vision@" + MP_VERSIONS[0] + "/wasm"
});
MP_SOURCES.push({ name: "file lokal (lib/)", module: "./lib/vision_bundle.mjs", wasm: "./lib/wasm" });
const MODEL_SOURCES = [
  { name: "Google Storage", url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" },
  { name: "file lokal (models/)", url: "./models/pose_landmarker_lite.task" }
];

/* ---------------------------------------------------------------------
   LATAR PERMAINAN (background)
   Setiap permainan dimulai, game memilih satu gambar secara ACAK dari daftar
   ini (tidak sama dengan permainan sebelumnya). Letakkan file PNG di folder
   yang sama dengan index.html, lalu sesuaikan nama dan jumlahnya di sini.
   Boleh 1 sampai berapa pun gambar. Gambar yang tidak ditemukan dilewati;
   bila tidak ada satu pun, game memakai latar bawaan (langit dan bukit).

   Saran gambar: PNG 16:9 (contoh 1920x1080), ukuran file di bawah 1 MB.
   Gambar yang terlalu besar bisa gagal tampil di TV atau HP berkapasitas kecil.
   Karakter berdiri di sekitar 89% tinggi gambar (garis kaki), jadi
   siapkan "tanah" atau jalan di bagian bawah gambar.
   --------------------------------------------------------------------- */
const LATAR = [
  "latar/latar1.png",
  "latar/latar2.png",
  "latar/latar3.png"
];
const LATAR_FADE_MS = 500;   // lama pergantian latar (memudar), dalam milidetik

// Nomor landmark MediaPipe yang kita pakai (tubuh pemain, bukan "kiri layar").
const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13,    R_ELBOW: 14,
  L_WRIST: 15,    R_WRIST: 16,
  L_HIP: 23,      R_HIP: 24,
  L_KNEE: 25,     R_KNEE: 26,
  L_ANKLE: 27,    R_ANKLE: 28
};
const ALL_POINTS = Object.values(LM);   // semua 12 titik (untuk digambar bila terlihat)

// Mode jarak kamera: titik mana yang WAJIB terlihat agar input gerakan aktif.
// Lompat dan angkat tangan hanya butuh bahu, pinggul, dan pergelangan tangan,
// jadi kaki tidak wajib. Mode "knee" (sampai lutut) adalah bawaan.
const RANGE_MODES = {
  full: {
    label: "kepala hingga kaki",
    points: ALL_POINTS
  },
  knee: {
    label: "kepala hingga lutut",
    points: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
             LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE]
  },
  hip: {
    label: "kepala hingga pinggul",
    points: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
             LM.L_HIP, LM.R_HIP]
  }
};
let rangeMode = "knee";
let REQUIRED = RANGE_MODES[rangeMode].points;   // titik yang harus terlihat
const rangeLabel = () => RANGE_MODES[rangeMode].label;

// Pasangan titik untuk menggambar garis kerangka.
const BONES = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP],   [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE],       [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE],       [LM.R_KNEE, LM.R_ANKLE]
];

// Pengaturan yang bisa diubah lewat slider di halaman.
const settings = {
  jumpThreshold: 0.12,  // seberapa tinggi tubuh naik (dalam "panjang badan atas") agar dianggap lompat
  deadZone: 0.05,       // zona tengah (0..1 lebar frame) yang diabaikan
  jumpCooldown: 400     // milidetik jeda antar lompatan
};

// Konstanta deteksi (boleh disesuaikan kalau perlu).
const MIN_VISIBILITY = 0.5;  // landmark dianggap terlihat jika kepercayaannya >= ini
const GRACE_FRAMES = 9;      // toleransi frame hilang sebelum tubuh dianggap keluar frame
const SMOOTH_X = 0.3;        // 0..1, makin kecil makin halus (tapi makin lambat)
const SMOOTH_Y = 0.5;
const SMOOTH_JUMP = 0.8;     // penghalusan khusus lompat: tinggi (= lebih cepat bereaksi)
const MOVE_RANGE = 0.22;     // geser sejauh ini (lebar frame) = karakter di ujung
const HANDS_MARGIN = 0.02;   // pergelangan harus lebih tinggi dari bahu sebesar ini
const HANDS_FRAMES = 3;      // status tangan baru berubah setelah stabil sekian frame
const CALIB_PREP_MS = 2000;  // waktu bersiap sebelum kalibrasi
const CALIB_COLLECT_MS = 3000; // lama pengumpulan data kalibrasi

// Ukuran dunia game (canvas) dan fisika karakter.
const W = 960, H = 540;
const GROUND_Y = 450;        // garis tanah
const FEET_Y = 482;          // posisi kaki karakter saat di tanah
const MAX_TRAVEL = 360;      // jarak maksimum karakter dari tengah (piksel)
const GRAVITY = 1785;
const JUMP_SPEED = 982;      // tinggi = v^2/(2g) = 270 px, waktu di udara = 2v/g = 1,1 detik

/* ---------------------------------------------------------------------
   2. ELEMEN HTML
   --------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const rootEl = document.documentElement;
const menungguLandscape = () => rootEl.classList.contains("tegak");   // diatur oleh layar.js

const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const canvas = $("gameCanvas");
const ctx = canvas.getContext("2d");
const cameraBox = $("cameraBox");

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const btnCalibrate = $("btnCalibrate");
const btnTest = $("btnTest");

/* ---------------------------------------------------------------------
   3. STATUS (variabel yang berubah selama program berjalan)
   --------------------------------------------------------------------- */

// --- Kamera & model ---
let stream = null;
let landmarker = null;        // objek MediaPipe PoseLandmarker
let mpModule = null;          // modul MediaPipe (diimpor sekali saja)
let cameraState = "off";      // off | asking | on | error
let modelState = "idle";      // idle | loading | ready | error
let session = 0;              // naik setiap start/stop, untuk membatalkan proses lama
let errorMessage = "";
let lastVideoTime = -1;
let detectErrors = 0;
let testActive = false;       // true = tubuh benar-benar mengendalikan karakter
let popupDismissed = false;   // true = pemain memilih main dengan keyboard saja (pop-up disembunyikan)
let popupVisible = false;     // true = pop-up besar sedang tampil

// --- Hasil pembacaan tubuh ---
let bodyOk = false;           // tubuh lengkap & terdeteksi
let missFrames = 0;
let lastVisible = 0;          // jumlah landmark terlihat pada frame terakhir
let smoothInit = false;
let cxS = 0.5, hipS = 0, shS = 0, torsoS = 0.2;
let hipJ = 0, shJ = 0;        // posisi pinggul & bahu dengan penghalusan ringan (untuk lompat)   // nilai yang sudah dihaluskan
let neutralX = 0.5;           // posisi tengah (default 0.5, atau hasil kalibrasi)
let baseline = null;          // posisi vertikal netral {hip, sh, torso}
let calibrated = false;

let moveDir = "center";       // left | center | right
let bodyNorm = 0;             // -1 (kiri penuh) .. 1 (kanan penuh)
let handsRaised = false;
let handsCounter = 0;

let jumpState = "grounded";   // grounded | airborne
let jumpPeak = 0;             // titik tertinggi selama lompatan (untuk mendeteksi mendarat)
let lastJumpTime = -99999;
let jumpFlashUntil = 0;
let riseHistory = [];

// Data untuk panel debug.
const dbg = { offset: 0, hipRise: 0, shRise: 0, rise: 0, handsDelta: 0 };

// --- Kalibrasi ---
const calib = { phase: "idle", t0: 0, samples: [], totalFrames: 0 };
let calibResult = null;       // {text, type, until}

// --- FPS ---
let fpsFrames = 0, fpsT0 = performance.now(), fpsValue = 0;

// --- Karakter ---
const ch = {
  x: W / 2, vx: 0,
  jumpY: 0, vy: 0, onGround: true,
  armsUp: 0, facing: 0, legPhase: 0,
  jumpBufUntil: 0,
  justLanded: false
};

// --- Keyboard ---
const keys = { left: false, right: false, space: false };
let lastKeyTime = -99999;

/* ---------------------------------------------------------------------
   4. KAMERA
   --------------------------------------------------------------------- */

/** Mengubah error kamera menjadi pesan yang mudah dipahami. */
function cameraErrorText(err, izin) {
  const name = (err && err.name) || "";
  const msg = (err && err.message) || "";
  const kode = " (kode: " + (name || "tidak diketahui") + ")";
  const TUTUP_OVERLAY = "Tutup semua balon atau overlay di layar (chat melayang, perekam layar, filter layar, asisten suara), lalu tekan Coba Lagi dan pilih Izinkan.";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    const status = izin ? " [status izin situs: " + izin + "]" : "";
    if (izin === "denied") {
      // Izin dicatat PER SITUS, jadi kamera tetap bisa dipakai situs lain walau situs ini diblokir.
      return "Browser sudah mencatat izin kamera untuk situs ini sebagai DITOLAK (biasanya terjadi setelah kotak izin sempat terhalang overlay beberapa kali). " +
        "Kamera di situs lain tetap bisa karena izin dicatat per situs. Reset izin situs ini: buka pengaturan situs di browser (ikon gembok atau menu > Pengaturan situs > Kamera > Izinkan), " +
        "atau di pengaturan TV pilih Aplikasi > browser > Hapus data. Lalu buka ulang halaman." + kode + status;
    }
    if (/dismiss|overlay|obscur/i.test(msg)) {
      return "Kotak izin kamera tertutup atau terhalang sebelum sempat dijawab. " + TUTUP_OVERLAY + kode + status;
    }
    return "Izin kamera ditolak untuk situs ini. Buka pengaturan situs di browser (Kamera > Izinkan) atau hapus data situs ini, lalu buka ulang halaman dan tekan Coba Lagi." + kode + status;
  }
  if (name === "TimeoutError") {
    return "Browser tidak menjawab permintaan kamera. " + TUTUP_OVERLAY +
      " Jika tetap gagal, browser di perangkat ini mungkin tidak mendukung kamera." + kode;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Kamera tidak ditemukan. Smart TV umumnya tidak punya kamera bawaan: sambungkan webcam USB, atau mainkan lewat HP atau laptop." + kode;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Kamera sedang dipakai aplikasi lain (misalnya Zoom atau Meet). Tutup aplikasi itu lalu coba lagi." + kode;
  }
  if (name === "OverconstrainedError") {
    return "Kamera tidak mendukung pengaturan yang diminta. Coba kamera lain." + kode;
  }
  if (name === "SecurityError") {
    return "Browser memblokir kamera demi keamanan. Buka halaman lewat https, atau lewat Live Server (http://127.0.0.1) di komputer." + kode;
  }
  return "Kamera gagal diaktifkan: " + (msg || err) + kode;
}

/** Status izin kamera untuk situs ini: "granted" | "denied" | "prompt" | "" (browser tidak mendukung). */
async function statusIzinKamera() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "";
    const r = await navigator.permissions.query({ name: "camera" });
    return r.state || "";
  } catch (e) {
    return "";   // sebagian browser TV tidak mengenal 'camera' di Permissions API
  }
}

/** Menunggu janji getUserMedia, tetapi menyerah bila browser tidak menjawab (sebagian TV tidak pernah menjawab). */
const BATAS_IZIN_MS = 60000;
function denganBatas(janji, ms) {
  return new Promise((resolve, reject) => {
    let habis = false;
    const timer = setTimeout(() => {
      habis = true;
      const e = new Error("Permintaan kamera tidak dijawab.");
      e.name = "TimeoutError";
      reject(e);
    }, ms);
    janji.then((s) => {
      if (habis) { s.getTracks().forEach((t) => t.stop()); return; }   // terlambat: matikan kamera yang baru menyala
      clearTimeout(timer);
      resolve(s);
    }, (e) => {
      if (habis) return;
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Meminta kamera. Bila pengaturan ideal ditolak (umum di Smart TV dan webcam USB), coba lagi dengan pengaturan paling sederhana. */
async function ambilKamera() {
  const percobaan = [
    { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false },   // HP: kamera depan
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },                       // tanpa facingMode (webcam USB / TV)
    { video: true, audio: false }                                                                      // paling sederhana
  ];
  let galat;
  for (const c of percobaan) {
    try {
      return await denganBatas(navigator.mediaDevices.getUserMedia(c), BATAS_IZIN_MS);
    } catch (e) {
      galat = e;
      const n = e && e.name;
      // Izin ditolak / tidak dijawab: percobaan kedua tidak akan membantu.
      if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError" || n === "TimeoutError") break;
    }
  }
  throw galat;
}

/** Dipanggil saat tombol "Aktifkan Kamera" ditekan. */
async function startCamera() {
  // Kamera sudah menyala tetapi model gagal dimuat -> cukup coba muat model lagi.
  if (cameraState === "on" && modelState === "error") {
    await ensureModel(session);
    return;
  }
  if (cameraState !== "off" && cameraState !== "error") return;

  popupDismissed = false;
  const mySession = ++session;   // kalau pemain menekan Hentikan, session berubah dan proses ini berhenti
  errorMessage = "";
  calibResult = null;
  cameraState = "asking";
  modelState = landmarker ? "ready" : "idle";
  updateButtons();

  // 1) Minta izin & nyalakan kamera
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraState = "error";
    errorMessage = "Browser ini tidak mendukung kamera, atau halaman tidak aman. Gunakan Live Server (http://127.0.0.1) atau https.";
    updateButtons();
    return;
  }

  let newStream;
  try {
    newStream = await ambilKamera();
  } catch (err) {
    if (session !== mySession) return;
    cameraState = "error";
    const izin = await statusIzinKamera();
    if (session !== mySession) return;
    errorMessage = cameraErrorText(err, izin);
    updateButtons();
    return;
  }

  // Pemain sudah menekan Hentikan selagi menunggu izin -> matikan kamera yang baru menyala.
  if (session !== mySession) {
    newStream.getTracks().forEach((t) => t.stop());
    return;
  }

  // 2) Tampilkan video langsung
  stream = newStream;
  video.srcObject = stream;
  try {
    await waitForVideoMetadata();
    await video.play();
  } catch (err) {
    if (session !== mySession) return;
    releaseCamera();
    cameraState = "error";
    errorMessage = "Video kamera tidak bisa diputar: " + ((err && err.message) || err);
    updateButtons();
    return;
  }
  if (session !== mySession) return;

  // Samakan ukuran canvas kerangka dengan ukuran video asli.
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
  cameraBox.style.aspectRatio = overlay.width + " / " + overlay.height;
  $("cameraPlaceholder").style.display = "none";
  cameraState = "on";
  lastVideoTime = -1;
  detectErrors = 0;

  // 3) Muat model (hanya sekali; berikutnya memakai yang sudah ada)
  await ensureModel(mySession);
}

/** Memuat model deteksi. Jika gagal, kamera TETAP menyala dan tombol berubah jadi "Coba Muat Model Lagi". */
async function ensureModel(mySession) {
  if (landmarker) {
    modelState = "ready";
    updateButtons();
    return;
  }
  modelState = "loading";
  errorMessage = "";
  updateButtons();
  try {
    await loadLandmarker();
  } catch (err) {
    if (session !== mySession) return;
    console.error("Gagal memuat MediaPipe:", err);
    modelState = "error";
    errorMessage = "Model deteksi gagal dimuat. " + ((err && err.message) || err) +
      " | Kamera sudah menyala; tekan Coba Muat Model Lagi setelah masalahnya diatasi (detail lengkap ada di Console, F12).";
    updateButtons();
    return;
  }
  if (session !== mySession) return;
  modelState = "ready";
  updateButtons();
}

/** Menunggu sampai ukuran video diketahui (maksimal 8 detik). */
function waitForVideoMetadata() {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error("Kamera tidak mengirim gambar.")), 8000);
    video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
  });
}

/** Memuat library MediaPipe lalu membuat PoseLandmarker. */
async function loadLandmarker() {
  const errText = (e) => (e && e.message) || String(e);

  // Langkah 1: unduh file model (.task). Dicoba dari beberapa sumber.
  let modelBuffer = null;
  const modelProblems = [];
  for (const src of MODEL_SOURCES) {
    try {
      const res = await fetch(src.url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      modelBuffer = await res.arrayBuffer();
      break;
    } catch (e) {
      console.warn("Model dari " + src.name + " gagal:", e);
      modelProblems.push(src.name + ": " + errText(e));
    }
  }
  if (!modelBuffer) {
    throw new Error("File model tidak bisa diunduh (" + modelProblems.join("; ") + ").");
  }

  // Langkah 2: muat library MediaPipe lalu buat PoseLandmarker. Dicoba dari beberapa sumber.
  const libProblems = [];
  for (const src of MP_SOURCES) {
    try {
      const mod = await import(src.module);
      const fileset = await mod.FilesetResolver.forVisionTasks(src.wasm);

      const create = (delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer.slice(0)), delegate: delegate },
        runningMode: "VIDEO",           // kita membaca frame video satu per satu
        numPoses: 1,                    // satu pemain saja
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      try {
        landmarker = await create("GPU");       // lebih cepat bila didukung
      } catch (gpuErr) {
        console.warn("GPU tidak tersedia, memakai CPU:", gpuErr);
        try {
          landmarker = await create("CPU");
        } catch (cpuErr) {
          throw new Error("GPU: " + errText(gpuErr) + " / CPU: " + errText(cpuErr));
        }
      }
      mpModule = mod;
      return;                                   // berhasil
    } catch (e) {
      console.warn("Library dari " + src.name + " gagal:", e);
      libProblems.push(src.name + ": " + errText(e));
    }
  }
  throw new Error("Library MediaPipe tidak bisa dimuat (" + libProblems.join("; ") + ").");
}

/** Mematikan semua track kamera dan mengosongkan status. */
function releaseCamera() {
  session++;                                  // batalkan proses start yang masih berjalan
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());   // lampu kamera mati
    stream = null;
  }
  video.srcObject = null;
  cameraState = "off";
  modelState = landmarker ? "ready" : "idle";
  testActive = false;
  calib.phase = "idle";
  auto.stage = "wait";                        // urutan otomatis diulang saat kamera dinyalakan lagi
  auto.okSince = 0;
  auto.lostSince = 0;
  calibrated = false;                         // kalibrasi diulang setiap kamera dinyalakan
  neutralX = 0.5;
  game.state = "idle";                        // game kembali ke awal
  game.items = [];
  game.floats = [];
  resetTracking();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  $("cameraPlaceholder").style.display = "grid";
  lastVideoTime = -1;
}

/** Dipanggil saat tombol "Hentikan Kamera" ditekan. */
function stopCamera() {
  releaseCamera();
  errorMessage = "";
  calibResult = null;
  updateButtons();
}

/** Mengosongkan hasil pembacaan tubuh (dipakai saat tubuh hilang / kamera mati). */
function resetTracking() {
  bodyOk = false;
  missFrames = 0;
  lastVisible = 0;
  smoothInit = false;
  moveDir = "center";
  bodyNorm = 0;
  handsRaised = false;
  handsCounter = 0;
  jumpState = "grounded";
  riseHistory = [];
  if (!calibrated) baseline = null;   // tanpa kalibrasi, posisi netral diambil ulang otomatis
}

/* ---------------------------------------------------------------------
   5. DETEKSI POSE
   --------------------------------------------------------------------- */

/** Apakah landmark ini terlihat jelas dan berada di dalam frame? */
function isVisible(l) {
  if (!l) return false;
  if (l.visibility !== undefined && l.visibility < MIN_VISIBILITY) return false;
  return l.x > 0.01 && l.x < 0.99 && l.y > 0.01 && l.y < 0.99;
}

/** Membaca satu frame video (hanya jika ada frame baru). */
function detectPose(now) {
  if (cameraState !== "on" || modelState !== "ready" || !landmarker) return;
  if (video.readyState < 2) return;                 // frame belum tersedia
  if (video.currentTime === lastVideoTime) return;  // frame ini sudah diproses
  lastVideoTime = video.currentTime;

  let result;
  try {
    result = landmarker.detectForVideo(video, now);
    detectErrors = 0;
  } catch (err) {
    console.error("Deteksi gagal:", err);
    if (++detectErrors >= 5) {
      releaseCamera();
      cameraState = "error";
      errorMessage = "Deteksi pose berhenti karena error berulang. Muat ulang halaman lalu coba lagi.";
      updateButtons();
    }
    return;
  }

  fpsFrames++;
  // Jangan membaca landmark kalau hasilnya belum ada.
  const lm = result && result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
  handlePose(lm, now);
  drawSkeleton(lm);
}

/** Mengolah landmark satu frame menjadi data gerakan. */
function handlePose(lm, now) {
  // Hitung berapa dari 12 titik yang terlihat.
  let visible = 0;
  if (lm) for (const i of REQUIRED) if (isVisible(lm[i])) visible++;
  lastVisible = visible;
  const complete = visible === REQUIRED.length;

  if (calib.phase === "collect") calib.totalFrames++;

  // --- Tubuh tidak lengkap: toleransi beberapa frame, lalu jeda input ---
  if (!complete) {
    missFrames++;
    if (missFrames >= GRACE_FRAMES && bodyOk) {
      if (testActive && game.state === "playing") Suara.hilang();
      resetTracking();               // input gerakan dihentikan sementara
    }
    return;
  }
  missFrames = 0;
  bodyOk = true;

  // --- Ambil titik penting. Sumbu X dibalik (1 - x) agar sama dengan tampilan cermin:
  //     bergeser ke kanan -> nilai x membesar. ---
  const p = (i) => ({ x: 1 - lm[i].x, y: lm[i].y });
  const ls = p(LM.L_SHOULDER), rs = p(LM.R_SHOULDER);
  const lh = p(LM.L_HIP),      rh = p(LM.R_HIP);
  const lw = p(LM.L_WRIST),    rw = p(LM.R_WRIST);

  const shMid  = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const cxRaw = (shMid.x + hipMid.x) / 2;                       // pusat tubuh (horizontal)
  const torso = Math.hypot(shMid.x - hipMid.x, shMid.y - hipMid.y); // panjang badan atas (patokan skala)

  // --- Smoothing (rata-rata bergerak) supaya tidak bergetar ---
  if (!smoothInit) {
    cxS = cxRaw; hipS = hipMid.y; shS = shMid.y; torsoS = torso;
    hipJ = hipMid.y; shJ = shMid.y;
    smoothInit = true;
  } else {
    cxS    += (cxRaw - cxS) * SMOOTH_X;
    hipJ   += (hipMid.y - hipJ) * SMOOTH_JUMP;
    shJ    += (shMid.y - shJ) * SMOOTH_JUMP;
    hipS   += (hipMid.y - hipS) * SMOOTH_Y;
    shS    += (shMid.y - shS) * SMOOTH_Y;
    torsoS += (torso - torsoS) * SMOOTH_X;
  }

  // Selama kalibrasi, kumpulkan sampel mentah.
  if (calib.phase === "collect") {
    calib.samples.push({ cx: cxRaw, hip: hipMid.y, sh: shMid.y, torso: torso });
  }

  // Tanpa kalibrasi: pakai posisi pertama sebagai netral sementara.
  if (!baseline) baseline = { hip: hipS, sh: shS, torso: Math.max(torsoS, 0.05) };

  // --- A. Kiri / kanan ---
  const offset = cxS - neutralX;
  const abs = Math.abs(offset);
  const dead = settings.deadZone;
  const prevDir = moveDir;
  if (moveDir === "center") {
    if (abs > dead) moveDir = offset < 0 ? "left" : "right";
  } else if (abs < dead * 0.8) {          // histeresis: harus kembali sedikit ke dalam dead zone
    moveDir = "center";
  } else {
    moveDir = offset < 0 ? "left" : "right";
  }
  if (moveDir !== prevDir && moveDir !== "center" && testActive) Suara.geser(moveDir === "left" ? -1 : 1);
  if (moveDir === "center") {
    bodyNorm = 0;
  } else {
    const span = Math.max(MOVE_RANGE - dead, 0.05);
    bodyNorm = Math.sign(offset) * Math.min(Math.max((abs - dead) / span, 0), 1);
  }

  // --- B. Lompat ---
  // "rise" = seberapa tinggi tubuh naik dibanding posisi netral, diukur dalam panjang badan atas.
  // Kita ambil nilai TERKECIL antara pinggul dan bahu, jadi gerakan kepala/bahu saja tidak cukup.
  const hipRise = (baseline.hip - hipJ) / baseline.torso;
  const shRise  = (baseline.sh - shJ) / baseline.torso;
  const rise = (hipRise + shRise) / 2;       // rata-rata; keduanya tetap harus naik (lihat updateJump)
  dbg.offset = offset; dbg.hipRise = hipRise; dbg.shRise = shRise; dbg.rise = rise;
  if (calib.phase === "idle") updateJump(now, rise, hipRise, shRise);

  // --- C. Kedua tangan terangkat ---
  // Pergelangan tangan harus berada di atas bahu (y lebih kecil = lebih tinggi).
  const handsDelta = Math.min(ls.y - lw.y, rs.y - rw.y);
  dbg.handsDelta = handsDelta;
  const handsRaw = handsDelta > HANDS_MARGIN;
  if (handsRaw === handsRaised) {
    handsCounter = 0;
  } else if (++handsCounter >= HANDS_FRAMES) {  // harus stabil beberapa frame sebelum berubah
    handsRaised = handsRaw;
    handsCounter = 0;
    if (handsRaised && testActive) Suara.magnet();
  }
}

/** Mesin status lompat: grounded -> airborne -> grounded. */
function updateJump(now, rise, hipRise, shRise) {
  const thr = settings.jumpThreshold;

  // Simpan riwayat 300 ms terakhir untuk memeriksa KECEPATAN naik.
  riseHistory.push({ t: now, r: rise });
  while (riseHistory.length > 0 && riseHistory[0].t < now - 300) riseHistory.shift();
  let minRecent = rise;
  for (const h of riseHistory) if (h.r < minRecent) minRecent = h.r;

  if (jumpState === "grounded") {
    const cooled = now - lastJumpTime > settings.jumpCooldown;
    // Lompat = sudah cukup tinggi DAN naiknya cepat (bukan sekadar berdiri tegak perlahan).
    // Pinggul DAN bahu sama-sama harus naik, supaya mengangkat kepala/bahu saja tidak dihitung.
    const bothUp = Math.min(hipRise, shRise) > thr * 0.35;
    if (cooled && bothUp && rise > thr && (rise - minRecent) > thr * 0.5) {
      jumpState = "airborne";
      jumpPeak = rise;
      lastJumpTime = now;
      jumpFlashUntil = now + 800;
      if (testActive) characterJump();
    } else if (Math.abs(hipRise) < thr * 0.5 && Math.abs(shRise) < thr * 0.5) {
      // Saat berdiri biasa, posisi netral bergeser pelan-pelan mengikuti pemain
      // (menangani pemain maju/mundur sedikit). Posisi kiri-kanan TIDAK ikut bergeser.
      baseline.hip   += (hipS - baseline.hip) * 0.01;
      baseline.sh    += (shS - baseline.sh) * 0.01;
      baseline.torso += (Math.max(torsoS, 0.05) - baseline.torso) * 0.01;
    }
  } else {
    // Sedang di udara: siap lagi setelah tubuh turun mendekati netral.
    // Dianggap mendarat jika tubuh sudah dekat netral ATAU sudah turun jauh dari puncak lompatan,
    // supaya lompatan berikutnya tidak tertahan menunggu tubuh kembali persis ke posisi awal.
    jumpPeak = Math.max(jumpPeak, rise);
    const landed = rise < thr * 0.5 || (jumpPeak - rise) > thr * 0.8;
    if (landed && now - lastJumpTime > Math.min(settings.jumpCooldown, 300)) {
      jumpState = "grounded";
    } else if (now - lastJumpTime > 900) {
      // Terlalu lama "di udara" (mungkin pemain bergeser): ambil ulang posisi netral.
      baseline = { hip: hipS, sh: shS, torso: Math.max(torsoS, 0.05) };
      jumpState = "grounded";
    }
  }
}

/** Menggambar titik dan garis kerangka di atas pratinjau kamera. */
function drawSkeleton(lm) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lm) return;

  const w = overlay.width, h = overlay.height;
  const color = bodyOk ? "#22e08f" : "#ffc93c";
  const scale = w / 640;

  octx.lineWidth = 4 * scale;
  octx.lineCap = "round";
  octx.strokeStyle = color;
  for (const [a, b] of BONES) {
    if (!isVisible(lm[a]) || !isVisible(lm[b])) continue;
    octx.beginPath();
    octx.moveTo(lm[a].x * w, lm[a].y * h);
    octx.lineTo(lm[b].x * w, lm[b].y * h);
    octx.stroke();
  }
  octx.fillStyle = "#ffffff";
  for (const i of ALL_POINTS) {
    if (!isVisible(lm[i])) continue;
    octx.beginPath();
    octx.arc(lm[i].x * w, lm[i].y * h, 5 * scale, 0, Math.PI * 2);
    octx.fill();
    octx.lineWidth = 2 * scale;
    octx.strokeStyle = color;
    octx.stroke();
  }
}

/* ---------------------------------------------------------------------
   6. KALIBRASI
   --------------------------------------------------------------------- */

function startCalibration() {
  if (cameraState !== "on" || modelState !== "ready" || calib.phase !== "idle") return;
  calibResult = null;
  calib.phase = "prep";
  calib.t0 = performance.now();
  calib.samples = [];
  calib.totalFrames = 0;
}

/** Dipanggil setiap frame untuk memajukan tahap kalibrasi. */
function updateCalibration(now) {
  if (calib.phase === "prep" && now - calib.t0 >= CALIB_PREP_MS) {
    calib.phase = "collect";
    calib.t0 = now;
    calib.samples = [];
    calib.totalFrames = 0;
  } else if (calib.phase === "collect" && now - calib.t0 >= CALIB_COLLECT_MS) {
    finishCalibration(now);
  }
}

function finishCalibration(now) {
  const n = calib.samples.length;
  const ratio = n / Math.max(calib.totalFrames, 1);
  calib.phase = "idle";

  const fail = (text) => { calibResult = { text: text, type: "error", until: now + 8000 }; Suara.gagal(); };

  if (n < 15 || ratio < 0.7) {
    fail("Kalibrasi gagal: tubuh tidak terdeteksi lengkap cukup lama. Atur posisi sampai " + rangeLabel() + " terlihat, lalu coba lagi.");
    return;
  }

  const mean = (key) => calib.samples.reduce((s, v) => s + v[key], 0) / n;
  const std = (key, m) => Math.sqrt(calib.samples.reduce((s, v) => s + (v[key] - m) ** 2, 0) / n);
  const mCx = mean("cx"), mHip = mean("hip"), mSh = mean("sh"), mTorso = mean("torso");

  // Pemain harus diam; kalau terlalu banyak bergerak, hasilnya tidak bisa dipercaya.
  if (std("cx", mCx) > 0.04 || std("hip", mHip) / mTorso > 0.10) {
    fail("Kalibrasi gagal: kamu terlalu banyak bergerak. Berdiri tegak dan diam selama kalibrasi, lalu coba lagi.");
    return;
  }

  // Simpan posisi netral.
  neutralX = mCx;
  baseline = { hip: mHip, sh: mSh, torso: Math.max(mTorso, 0.05) };
  calibrated = true;
  jumpState = "grounded";
  riseHistory = [];
  moveDir = "center";
  calibResult = { text: "✅ Kalibrasi berhasil! Posisi netral tersimpan.", type: "ok", until: now + 2500 };
  Suara.berhasil();
}

/* ---------------------------------------------------------------------
   7. KARAKTER
   --------------------------------------------------------------------- */

function characterJump() {
  if (ch.onGround) {
    ch.vy = -JUMP_SPEED;
    ch.onGround = false;
    Suara.lompat();
  } else {
    // Masih di udara: ingat permintaan lompat sebentar supaya langsung lompat lagi saat mendarat.
    ch.jumpBufUntil = performance.now() + 200;
  }
}

/** Memperbarui posisi dan pose karakter berdasarkan input. */
function updateCharacter(dt) {
  // Input tubuh hanya dipakai jika tes aktif DAN tubuh terdeteksi lengkap.
  const bodyActive = testActive && bodyOk;

  // Keyboard punya prioritas (hanya untuk pengujian cadangan).
  let targetNorm = 0;
  if (keys.left || keys.right) targetNorm = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  else if (bodyActive) targetNorm = bodyNorm;

  // Bergerak halus menuju target (kembali ke tengah jika target = 0).
  const targetX = W / 2 + targetNorm * MAX_TRAVEL;
  const prevX = ch.x;
  ch.x += (targetX - ch.x) * (1 - Math.exp(-dt * 7));
  ch.vx = dt > 0 ? (ch.x - prevX) / dt : 0;
  if (Math.abs(ch.vx) > 15) ch.facing += (Math.sign(ch.vx) - ch.facing) * 0.2;
  else ch.facing *= 0.9;
  ch.legPhase += Math.abs(ch.vx) * dt * 0.06;

  // Tangan
  const wantHands = keys.space || (bodyActive && handsRaised);
  ch.armsUp += ((wantHands ? 1 : 0) - ch.armsUp) * (1 - Math.exp(-dt * 12));

  // Fisika lompat
  if (!ch.onGround) {
    ch.vy += GRAVITY * dt;
    ch.jumpY += ch.vy * dt;
    if (ch.jumpY >= 0) {
      ch.jumpY = 0;
      ch.vy = 0;
      ch.onGround = true;   // mendarat -> siap lompat lagi
      Suara.mendarat();
      ch.justLanded = true; // dibaca updateGame untuk memberi kebal sesaat
      if (performance.now() < ch.jumpBufUntil) {   // ada permintaan lompat yang tertunda
        ch.jumpBufUntil = 0;
        ch.vy = -JUMP_SPEED;
        ch.onGround = false;
        Suara.lompat();
      }
    }
  }
}

/* ---------------------------------------------------------------------
   8. MENGGAMBAR CANVAS
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   7b. MEKANISME GAME: koin & batang kayu (versi anak-anak)
   - Geser kiri-kanan  : ambil koin
   - Lompat            : lewati batang kayu yang menggelinding; koin tinggi
   - Angkat kedua tangan: magnet koin
   - 3 nyawa; kena kayu = -1 nyawa lalu kebal sebentar.
   Game mulai otomatis saat tes gerakan aktif (atau tekan Enter).
   --------------------------------------------------------------------- */
const RULES = {
  lives: 3,
  invulnSec: 1.5,        // kebal setelah terkena kayu
  coinPoints: 10,
  coinLife: 7,           // detik koin bertahan
  maxCoins: 6,
  logHalf: 12,           // setengah lebar area sentuh kayu (gambar kayu tetap lebar; area sentuh sengaja lebih kecil)
  charHalf: 12,          // setengah lebar area sentuh karakter
  landGraceSec: 0.5,     // kebal sesaat setelah mendarat (kayu yang lewat saat mendarat tidak melukai)
  logHeight: 30,         // tinggi kayu (lompat harus lebih tinggi dari ini)
  logSpeedStart: 170,    // px/detik (pelan, untuk anak-anak)
  logSpeedMax: 240,
  rampSeconds: 90,       // waktu sampai tingkat kesulitan maksimum
  magnetRange: 280,
  restartDelay: 3        // detik sebelum hitungan mundur main lagi
};

const game = {
  state: "idle",         // idle | playing | over
  score: 0, best: 0, lives: RULES.lives,
  time: 0, coinT: 0, logT: 2.5, invulnUntil: 0, graceUntil: 0, overT: 0,
  items: [], floats: []
};

function startGame() {
  pilihLatar();                             // latar acak setiap permainan dimulai
  game.state = "playing";
  game.score = 0;
  game.lives = RULES.lives;
  game.time = 0;
  game.coinT = 0.3;
  game.logT = 3;
  game.invulnUntil = 0;
  game.graceUntil = 0;
  ch.justLanded = false;
  game.overT = 0;
  game.items = [];
  game.floats = [];
}

function magnetActive() {
  return keys.space || (testActive && bodyOk && handsRaised);
}

function addFloat(x, y, text, color) {
  game.floats.push({ x: x, y: y, text: text, color: color, t: 0 });
}

function updateGame(dt) {
  if (menungguLandscape()) return;          // HP masih tegak: game menunggu diputar ke landscape
  if (calib.phase !== "idle") return;       // kalibrasi ulang sedang berjalan: game dijeda
  // Mulai otomatis saat tes gerakan aktif dan tubuh terdeteksi.
  if (game.state === "idle" && testActive && bodyOk) startGame();

  if (game.state === "over") {
    game.overT += dt;
    if (game.overT > RULES.restartDelay && testActive && bodyOk) {
      if (!auto.on) startGame();
      else if (auto.stage === "done") beginCountdown(performance.now());   // main lagi: hitungan mundur dulu
    }
    return;
  }
  if (game.state !== "playing") return;
  if (testActive && !bodyOk) return;      // tubuh keluar frame -> game dijeda

  game.time += dt;
  if (ch.justLanded) {                       // baru mendarat -> kebal sebentar (tanpa berkedip)
    ch.justLanded = false;
    game.graceUntil = game.time + RULES.landGraceSec;
  }
  const level = Math.min(game.time / RULES.rampSeconds, 1);
  Suara.tempo(1 + 0.15 * level);             // musik makin cepat bersama tingkat kesulitan
  const feetY = FEET_Y + ch.jumpY;

  // --- Munculkan koin ---
  game.coinT -= dt;
  if (game.coinT <= 0) {
    game.coinT = 1.3 + Math.random() * 0.6;
    const coins = game.items.filter((i) => i.type === "coin").length;
    if (coins < RULES.maxCoins) {
      game.items.push({
        type: "coin",
        x: W / 2 + (Math.random() * 2 - 1) * MAX_TRAVEL,
        y: Math.random() < 0.4 ? 215 : 425,   // 40% koin tinggi (perlu lompat)
        born: game.time
      });
    }
  }

  // --- Munculkan batang kayu dari kiri atau kanan ---
  game.logT -= dt;
  if (game.logT <= 0) {
    game.logT = 4.2 - level * 1.4 + Math.random() * 1.2;
    const fromLeft = Math.random() < 0.5;
    game.items.push({
      type: "log",
      x: fromLeft ? -40 : W + 40,
      dir: fromLeft ? 1 : -1,
      vx: RULES.logSpeedStart + (RULES.logSpeedMax - RULES.logSpeedStart) * level,
      roll: 0
    });
  }

  // --- Perbarui benda ---
  const magnet = magnetActive();
  const bodyCy = feetY - 100;
  const kept = [];
  for (const it of game.items) {
    if (it.type === "coin") {
      if (magnet) {
        const dx = ch.x - it.x, dy = bodyCy - it.y, d = Math.hypot(dx, dy);
        if (d < RULES.magnetRange && d > 1) {
          const step = Math.min(300 * dt, d);
          it.x += (dx / d) * step;
          it.y += (dy / d) * step;
        }
      }
      // Ambil koin: dekat secara horizontal dan di dalam tinggi tubuh karakter.
      if (Math.abs(it.x - ch.x) < 48 && it.y > feetY - 215 && it.y < feetY) {
        game.score += RULES.coinPoints;
        addFloat(it.x, it.y, "+" + RULES.coinPoints, "#e09b00");
        Suara.koin();
        continue;
      }
      if (game.time - it.born > RULES.coinLife) continue;   // koin hilang sendiri
      kept.push(it);
    } else {
      it.x += it.dir * it.vx * dt;
      it.roll += it.dir * it.vx * dt * 0.05;
      // Tabrakan: dekat secara horizontal DAN kaki belum cukup tinggi.
      const hitX = Math.abs(it.x - ch.x) < RULES.logHalf + RULES.charHalf;
      const hitY = -ch.jumpY < RULES.logHeight - 8;
      if (hitX && hitY && game.time > game.invulnUntil && game.time > game.graceUntil) {
        game.lives--;
        game.invulnUntil = game.time + RULES.invulnSec;
        addFloat(ch.x, feetY - 190, "Aduh!", "#ff6b57");
        Suara.aduh();
        if (game.lives <= 0) {
          Suara.selesai();
          game.state = "over";
          game.overT = 0;
          game.best = Math.max(game.best, game.score);
        }
      }
      if (it.x > -80 && it.x < W + 80) kept.push(it);
    }
  }
  game.items = kept;

  // --- Teks melayang ---
  for (const f of game.floats) { f.t += dt; f.y -= 60 * dt; }
  game.floats = game.floats.filter((f) => f.t < 0.9);
}

function drawItems() {
  // Aura magnet
  if (game.state === "playing" && magnetActive()) {
    ctx.strokeStyle = "rgba(91,91,240,0.55)";
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.arc(ch.x, FEET_Y + ch.jumpY - 100, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const it of game.items) {
    if (it.type === "coin") {
      const age = game.time - it.born;
      if (age > RULES.coinLife - 1.5 && Math.floor(age * 8) % 2 === 0) continue;   // berkedip sebelum hilang
      const y = it.y + Math.sin(game.time * 4 + it.x) * 4;
      circle(it.x, y, 17, "#e09b00");
      circle(it.x, y, 14, "#ffd54a");
      circle(it.x, y, 8, "#ffe98a");
    } else {
      const y = FEET_Y - 15;
      roundRect(it.x - 28, y - 15, 56, 30, 12, "#a56a3a");
      ctx.strokeStyle = "#7a4a22";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(it.x - 16, y - 6); ctx.lineTo(it.x + 6, y - 6);
      ctx.moveTo(it.x - 8, y + 6);  ctx.lineTo(it.x + 16, y + 6);
      ctx.stroke();
      // Lingkaran tahun di ujung kayu (berputar sedikit agar terlihat menggelinding)
      const ex = it.x + it.dir * 28;
      circle(ex, y, 15, "#d9a066");
      ctx.strokeStyle = "#a56a3a";
      ctx.beginPath();
      ctx.arc(ex, y, 8 + Math.sin(it.roll) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawFloats() {
  ctx.textAlign = "center";
  ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
  for (const f of game.floats) {
    ctx.globalAlpha = Math.max(1 - f.t / 0.9, 0);
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawPanel(lines) {
  ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
  const boxW = tw + 60, boxH = 36 + lines.length * 34;
  roundRect(W / 2 - boxW / 2, 150, boxW, boxH, 18, "rgba(31,42,68,0.88)");
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 150 + 42 + i * 34));
}

function drawGameHud() {
  // Skor (kanan atas)
  ctx.textAlign = "right";
  ctx.font = "bold 28px 'Trebuchet MS', sans-serif";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";   // garis tepi putih supaya terbaca di latar gelap maupun terang
  ctx.strokeText("Skor: " + game.score, W - 18, 36);
  ctx.fillStyle = "#1f2a44";
  ctx.fillText("Skor: " + game.score, W - 18, 36);

  // Nyawa (kiri atas)
  ctx.textAlign = "left";
  ctx.font = "bold 34px 'Trebuchet MS', sans-serif";
  for (let i = 0; i < RULES.lives; i++) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeText("\u2665", 16 + i * 38, 44);
    ctx.fillStyle = i < game.lives ? "#ff4f6d" : "rgba(31,42,68,0.35)";
    ctx.fillText("\u2665", 16 + i * 38, 44);
  }

  if (popupVisible) return;   // petunjuk dan hitungan mundur tampil di pop-up besar

  if (game.state === "idle") {
    // Hanya muncul bila pop-up disembunyikan (mode keyboard atau ?auto=0)
    drawPanel([
      "Kumpulkan koin sebanyak-banyaknya!",
      "Geser kiri-kanan = ambil koin",
      "Lompat = lewati kayu & koin tinggi",
      "Angkat kedua tangan = magnet koin",
      "Tekan Enter untuk mulai"
    ]);
  } else if (game.state === "over") {
    drawPanel([
      "Permainan selesai!",
      "Skor: " + game.score + "   Terbaik: " + game.best,
      testActive ? "Main lagi otomatis sebentar lagi..." : "Tekan Enter untuk main lagi"
    ]);
  }
}

function circle(x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function cloud(x, y, s) {
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  [[0, 0, 34], [34, -10, 40], [76, 0, 32], [38, 12, 34]].forEach(([dx, dy, r]) => {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  });
}

let res = 1;   // pengali resolusi canvas (koordinat game tetap 960x540)
function updateResolution() {
  const fit = Math.min(window.innerWidth / W, window.innerHeight / H);
  const cap = window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;   // HP dibatasi agar tetap ringan
  const next = Math.min(Math.max(Math.round(fit * (window.devicePixelRatio || 1) * 2) / 2, 1), cap);
  if (next !== res || canvas.width !== Math.round(W * next)) {
    res = next;
    canvas.width = Math.round(W * res);
    canvas.height = Math.round(H * res);
  }
}

/* ---------------------------------------------------------------------
   LATAR: gambar acak dari daftar LATAR, atau latar bawaan bila belum ada
   --------------------------------------------------------------------- */
const latar = { siap: [], sekarang: null, lama: null, t0: -99999 };

/** Memuat semua gambar latar di awal agar siap dipakai saat permainan dimulai. */
function muatLatar() {
  for (const src of LATAR) {
    const img = new Image();
    img.onload = () => { if (img.naturalWidth > 0) latar.siap.push(img); };
    img.onerror = () => console.warn("Gambar latar tidak ditemukan atau gagal dibuka: " + src);
    img.src = src;
  }
}

/** Memilih latar acak untuk permainan baru (tidak sama dengan yang sebelumnya bila ada pilihan lain). */
function pilihLatar() {
  if (latar.siap.length === 0) return;      // belum ada gambar: tetap latar bawaan
  let kandidat = latar.siap;
  if (kandidat.length > 1 && latar.sekarang) kandidat = kandidat.filter((x) => x !== latar.sekarang);
  latar.lama = latar.sekarang;
  latar.sekarang = kandidat[Math.floor(Math.random() * kandidat.length)];
  latar.t0 = performance.now();
}

/** Menggambar satu gambar memenuhi seluruh layar (dipotong di tepi bila rasionya bukan 16:9). */
function gambarCover(img, alpha) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

function gambarLatar(now) {
  if (!latar.sekarang) { gambarLatarBawaan(); return; }
  const p = Math.min(Math.max((now - latar.t0) / LATAR_FADE_MS, 0), 1);
  if (p < 1) {
    if (latar.lama) gambarCover(latar.lama, 1); else gambarLatarBawaan();   // memudar dari latar sebelumnya
  } else {
    latar.lama = null;
    ctx.fillStyle = "#bfe6ff";               // alas, untuk PNG yang punya bagian transparan
    ctx.fillRect(0, 0, W, H);
  }
  gambarCover(latar.sekarang, p);
}

/** Latar bawaan: langit, matahari, awan, bukit, tanah, dan penanda tengah. */
function gambarLatarBawaan() {
  // Langit
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#7cc8ff");
  sky.addColorStop(1, "#e4f4ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  circle(850, 95, 46, "#ffd54a");
  cloud(130, 100, 1);
  cloud(500, 62, 0.8);
  cloud(720, 170, 0.6);

  // Bukit
  ctx.fillStyle = "#9be8b0";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.quadraticCurveTo(220, GROUND_Y - 130, 460, GROUND_Y);
  ctx.quadraticCurveTo(700, GROUND_Y - 90, W, GROUND_Y);
  ctx.closePath();
  ctx.fill();

  // Tanah
  ctx.fillStyle = "#52d681";
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = "#2fb866";
  ctx.fillRect(0, GROUND_Y, W, 10);

  // Penanda tengah
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(W / 2, GROUND_Y + 14);
  ctx.lineTo(W / 2, H - 10);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawScene(now) {
  ctx.setTransform(res, 0, 0, res, 0, 0);   // semua gambar memakai koordinat 960x540
  gambarLatar(now);

  drawItems();
  const invulnerable = game.state === "playing" && game.time < game.invulnUntil;
  ctx.globalAlpha = invulnerable && Math.floor(game.time * 10) % 2 === 0 ? 0.35 : 1;   // berkedip saat kebal
  drawCharacter();
  ctx.globalAlpha = 1;
  drawFloats();
  drawGameHud();
  drawHud(now);
}

function drawCharacter() {
  const x = ch.x;
  const height = -ch.jumpY;                 // tinggi lompatan (positif)
  const feetY = FEET_Y + ch.jumpY;
  const skin = "#ffd7a8", shirt = "#5b5bf0", pants = "#2b3556", cap = "#ff6b57";

  // Bayangan (mengecil saat karakter di udara)
  ctx.fillStyle = "rgba(0,0,0," + Math.max(0.28 - height / 900, 0.1) + ")";
  ctx.beginPath();
  ctx.ellipse(x, FEET_Y + 4, Math.max(54 - height * 0.12, 28), 10, 0, 0, Math.PI * 2);
  ctx.fill();

  const legLen = 62, torsoH = 78;
  const hipY = feetY - legLen;
  const torsoTop = hipY - torsoH;
  const headY = torsoTop - 32;

  // Kaki
  ctx.lineCap = "round";
  ctx.strokeStyle = pants;
  ctx.lineWidth = 17;
  const moving = Math.min(Math.abs(ch.vx) / 150, 1);
  [-1, 1].forEach((side) => {
    let fx, fy;
    if (ch.onGround) {
      fx = x + side * 15 + Math.sin(ch.legPhase + (side > 0 ? Math.PI : 0)) * 14 * moving;
      fy = feetY;
    } else {
      fx = x + side * 24;          // kaki terbuka saat di udara
      fy = feetY - 12;
    }
    ctx.beginPath();
    ctx.moveTo(x + side * 14, hipY);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = "#1c2440";
    ctx.beginPath();
    ctx.ellipse(fx + side * 4, fy + 2, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Badan
  roundRect(x - 34, torsoTop, 68, torsoH, 20, shirt);

  // Lengan: sudut 0 = lurus ke bawah, sekitar 2.75 rad = terangkat ke atas
  const angle = 0.38 + (2.75 - 0.38) * ch.armsUp;
  const armLen = 60;
  const shoulderY = torsoTop + 18;
  ctx.strokeStyle = skin;
  ctx.lineWidth = 15;
  [-1, 1].forEach((side) => {
    const sx = x + side * 32;
    const hx = sx + side * Math.sin(angle) * armLen;
    const hy = shoulderY + Math.cos(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(sx, shoulderY);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    circle(hx, hy, 11, skin);
  });

  // Kepala
  const lookX = ch.facing * 4;
  circle(x, headY, 35, skin);
  ctx.fillStyle = cap;                     // topi
  ctx.beginPath();
  ctx.arc(x, headY - 4, 36, Math.PI * 1.08, Math.PI * 1.92);
  ctx.closePath();
  ctx.fill();

  // Wajah
  circle(x - 12 + lookX, headY + 2, 4.5, "#1f2a44");
  circle(x + 12 + lookX, headY + 2, 4.5, "#1f2a44");
  ctx.strokeStyle = "#1f2a44";
  ctx.lineWidth = 3;
  if (ch.armsUp > 0.5) {                   // senang saat tangan terangkat
    ctx.fillStyle = "#1f2a44";
    ctx.beginPath();
    ctx.arc(x + lookX, headY + 15, 9, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x + lookX, headY + 11, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

/** Teks kecil di dalam canvas: status tes dan peringatan. */
function drawHud(now) {
  const ready = cameraState === "on" && modelState === "ready";

  if (ready && testActive && !bodyOk) {
    const msg = "Tubuh keluar dari frame - input gerakan dijeda";
    ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
    const tw = ctx.measureText(msg).width + 40;
    roundRect(W / 2 - tw / 2, 78, tw, 46, 14, "rgba(31,42,68,0.85)");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(msg, W / 2, 108);
  }
}

/* ---------------------------------------------------------------------
   9. UPDATE TAMPILAN HTML (status, indikator, debug)
   --------------------------------------------------------------------- */

function setPill(id, cls, text) {
  const el = $(id);
  el.className = "pill " + cls;
  el.lastElementChild.textContent = text;
}

function setChip(id, cls, valueId, text) {
  $(id).className = "chip" + (cls ? " " + cls : "");
  $(valueId).textContent = text;
}

/** Menentukan pesan banner berdasarkan kondisi saat ini. */
function computeBanner(now) {
  if (errorMessage) return { text: errorMessage, type: "error" };

  if (calib.phase === "prep") {
    const s = Math.max(Math.ceil((CALIB_PREP_MS - (now - calib.t0)) / 1000), 1);
    return { text: "🧍 Berdiri tegak menghadap kamera, " + rangeLabel() + " terlihat. Mulai dalam " + s + " detik...", type: "info" };
  }
  if (calib.phase === "collect") {
    const s = Math.max(Math.ceil((CALIB_COLLECT_MS - (now - calib.t0)) / 1000), 1);
    return { text: "🧍 Tahan posisi dan jangan bergerak... " + s + " detik lagi.", type: "info" };
  }
  if (calibResult && now < calibResult.until) return calibResult;

  if (cameraState === "asking") {
    return { text: "Menunggu izin kamera. Klik Izinkan pada kotak dialog browser.", type: "info" };
  }
  if (cameraState === "on" && modelState === "loading") {
    return { text: "Memuat model deteksi pose dari internet. Pertama kali bisa butuh beberapa detik...", type: "info" };
  }
  if (cameraState !== "on" || modelState !== "ready") {
    return { text: "Mode keyboard: panah kiri/kanan = gerak, panah atas = lompat, spasi = magnet, Enter = mulai. Tekan ⏹️ untuk kembali memilih kamera.", type: "info" };
  }

  if (!bodyOk) {
    const pause = testActive ? " Input gerakan dijeda." : "";
    if (lastVisible === 0) {
      return { text: "🔍 Tubuh belum terdeteksi. Berdirilah di depan kamera dengan pencahayaan cukup." + pause, type: "warn" };
    }
    return {
      text: "🔍 Tubuh belum terlihat lengkap (" + lastVisible + "/" + REQUIRED.length + " titik). Atur jarak agar " + rangeLabel() + " masuk ke dalam frame." + pause,
      type: "warn"
    };
  }
  if (auto.on && auto.stage === "countdown") {
    return { text: "🎮 Bersiap! Game dimulai sebentar lagi.", type: "ok" };
  }
  if (!testActive) {
    if (auto.on) return { text: "✅ Tubuh terdeteksi! Tahan posisimu sebentar untuk kalibrasi.", type: "ok" };
    return { text: "Tubuh terdeteksi lengkap. Buka ⚙️ Pengaturan, lalu pilih Kalibrasi Ulang dan Mulai Tes Gerakan.", type: "ok" };
  }
  return { text: "🎮 Ayo kumpulkan koin! Geser, lompat, dan angkat kedua tangan.", type: "ok" };
}

let lastBannerKey = "";
function updateButtons() {
  const ready = cameraState === "on" && modelState === "ready";
  const modelRetry = cameraState === "on" && modelState === "error";
  btnStart.disabled = !(cameraState === "off" || cameraState === "error" || modelRetry);
  btnStart.textContent = cameraState === "asking" ? "Menunggu izin kamera..." : modelRetry ? "Coba Muat Model Lagi" : cameraState === "error" ? "Coba Lagi" : "Aktifkan Kamera";
  btnStop.disabled = (cameraState === "off" || cameraState === "error") && !popupDismissed;
  btnCalibrate.disabled = !ready || calib.phase !== "idle";
  btnTest.disabled = !ready;
  btnTest.textContent = testActive ? "Jeda Tes Gerakan" : "Mulai Tes Gerakan";
}

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

/** Tampilan pop-up besar saat ini: "awal", "tahap", atau "" (tersembunyi). */
function popupView() {
  if (popupDismissed) return "";
  if (cameraState === "off" || cameraState === "error" || modelState === "error") return "awal";
  if (cameraState === "asking" || modelState !== "ready") return "tahap";   // izin kamera / memuat model
  if (calib.phase !== "idle") return "tahap";
  if (auto.on && auto.stage !== "done") return "tahap";
  return "";
}

/** Mengisi tampilan persiapan: mendeteksi tubuh -> kalibrasi -> hitungan mundur. */
function updateTahap(now) {
  const ready = cameraState === "on" && modelState === "ready";
  let step = 0, ikon = "⏳", judul = "Menyiapkan game", info = "", angka = "";

  if (cameraState === "asking") {
    ikon = "📷"; judul = "Menyiapkan kamera";
    info = "Klik Izinkan pada kotak dialog browser. Jika kotaknya tidak muncul, tutup balon atau overlay di layar, lalu tekan Batal dan coba lagi.";
  } else if (!ready) {
    info = "Memuat model deteksi gerakan. Pertama kali bisa butuh beberapa detik...";
  } else if (calib.phase !== "idle" || auto.stage === "calib") {
    step = 2; ikon = "🧍"; judul = "Kalibrasi";
    if (calib.phase === "prep") {
      info = "Berdiri tegak menghadap kamera, lalu bersiap untuk tidak bergerak.";
      angka = String(Math.max(Math.ceil((CALIB_PREP_MS - (now - calib.t0)) / 1000), 1));
    } else if (calib.phase === "collect") {
      info = "Tahan posisi dan jangan bergerak...";
      angka = String(Math.max(Math.ceil((CALIB_COLLECT_MS - (now - calib.t0)) / 1000), 1));
    } else {
      info = "Menyiapkan kalibrasi...";
    }
  } else if (auto.stage === "countdown") {
    step = 3; ikon = "🎮"; judul = "Bersiap!";
    info = bodyOk ? "Game dimulai sebentar lagi." : "Tubuhmu keluar dari frame. Kembali ke depan kamera!";
    const e = now - auto.cdT0;
    angka = e >= COUNTDOWN_MS ? "Mulai!" : String(3 - Math.floor(e / 1000));
  } else {
    step = 1; ikon = "🔍"; judul = "Mendeteksi tubuh";
    if (calibResult && calibResult.type === "error" && now < calibResult.until) {
      info = "Kalibrasi belum berhasil. Mencoba lagi, tetap berdiri tegak dan diam.";
    } else if (bodyOk) {
      info = "✅ Tubuh terdeteksi! Tahan posisimu sebentar.";
    } else if (lastVisible === 0) {
      info = "Berdirilah di depan kamera dengan pencahayaan cukup.";
    } else {
      info = "Tubuh belum terlihat lengkap (" + lastVisible + "/" + REQUIRED.length + " titik). Atur jarak agar " + rangeLabel() + " masuk ke dalam frame.";
    }
  }

  $("btnBatal").hidden = cameraState !== "asking";
  setText("tahapIkon", ikon);
  setText("tahapJudul", judul);
  setText("tahapInfo", info);
  for (let i = 1; i <= 3; i++) {
    $("lg" + i).className = i < step ? "selesai" : i === step ? "aktif" : "";
  }
  const el = $("tahapAngka");
  el.hidden = angka === "";
  if (el.textContent !== angka) {
    el.textContent = angka;
    el.classList.toggle("kecil", angka === "Mulai!");
    el.classList.remove("pop");
    void el.offsetWidth;                    // mulai ulang animasi membesar-menyusut
    if (angka) el.classList.add("pop");
  }
}

function updateUI(now) {
  updateButtons();

  // Pop-up besar: "awal" (petunjuk + tombol kamera) -> "tahap" (mendeteksi tubuh, kalibrasi, hitungan mundur)
  const view = popupView();
  popupVisible = view !== "";
  Suara.setSuasana(popupVisible ? "menu" : game.state === "playing" ? "main" : game.state === "over" ? "selesai" : "menu");   // musik latar mengikuti keadaan game
  $("popup").hidden = !popupVisible;
  $("bingkai").dataset.popup = view;
  $("popupAwal").hidden = view !== "awal";
  $("popupTahap").hidden = view !== "tahap";
  $("banner").hidden = view === "awal";     // pesan kesalahan sudah tampil di dalam pop-up
  if (view === "awal") {
    const msg = errorMessage ||
      "Game ini memakai kamera untuk membaca gerakan tubuhmu. Berdirilah sekitar 2 meter dari kamera sampai kepala hingga lutut terlihat. Video hanya diproses di perangkat ini dan tidak dikirim ke mana pun.";
    setText("popupMsg", msg);
    $("popupMsg").classList.toggle("error", !!errorMessage);
  } else if (view === "tahap") {
    updateTahap(now);
  }

  // Banner (notifikasi)
  const b = computeBanner(now);
  const key = b.type + "|" + b.text;
  if (key !== lastBannerKey) {
    const el = $("banner");
    el.className = "banner " + b.type;
    el.textContent = b.text;
    el.title = b.text;
    lastBannerKey = key;
  }

  // Status kamera & model
  const camMap = {
    off: ["off", "Kamera: mati"], asking: ["wait", "Kamera: meminta izin..."],
    on: ["ok", "Kamera: aktif"], error: ["error", "Kamera: gagal"]
  };
  setPill("pillCamera", camMap[cameraState][0], camMap[cameraState][1]);

  const modelMap = {
    idle: ["off", "Model: belum dimuat"], loading: ["wait", "Model: memuat..."],
    ready: ["ok", "Model: siap"], error: ["error", "Model: gagal dimuat"]
  };
  setPill("pillModel", modelMap[modelState][0], modelMap[modelState][1]);

  const ready = cameraState === "on" && modelState === "ready";
  if (!ready) setPill("pillBody", "off", "Tubuh: -");
  else if (bodyOk) setPill("pillBody", "ok", "Tubuh: terdeteksi lengkap");
  else if (lastVisible > 0) setPill("pillBody", "warn", "Tubuh: sebagian (" + lastVisible + "/" + REQUIRED.length + ")");
  else setPill("pillBody", "warn", "Tubuh: tidak terdeteksi");

  // Indikator gerakan
  const dirText = { left: "Kiri", center: "Tengah", right: "Kanan" };
  if (ready && bodyOk) {
    setChip("chipDir", moveDir === "center" ? "" : "active", "valDir", dirText[moveDir]);
    const flashing = now < jumpFlashUntil;
    setChip("chipJump", flashing ? "active" : "", "valJump", flashing ? "Melompat terdeteksi" : "Siap");
    setChip("chipHands", handsRaised ? "active" : "", "valHands", handsRaised ? "Terangkat" : "Turun");
    setChip("chipBody", "active", "valBody", "Terdeteksi");
  } else {
    setChip("chipDir", "", "valDir", "-");
    setChip("chipJump", "", "valJump", "-");
    setChip("chipHands", "", "valHands", "-");
    setChip("chipBody", ready ? "alert" : "", "valBody", ready ? "Tidak terdeteksi" : "-");
  }

  // Sumber input
  let source = "-";
  if (now - lastKeyTime < 1500) source = "Keyboard (cadangan)";
  else if (testActive && bodyOk) source = "Kamera (gerakan tubuh)";
  else if (ready) source = "Kamera aktif, menunggu Mulai Tes Gerakan";
  $("valSource").textContent = source;

  // FPS deteksi (dihitung tiap ~1 detik)
  if (now - fpsT0 >= 1000) {
    fpsValue = (fpsFrames * 1000) / (now - fpsT0);
    fpsFrames = 0;
    fpsT0 = now;
  }

  // Panel debug
  if (ready && bodyOk) {
    $("dbgX").textContent = "x=" + cxS.toFixed(3) + "  netral=" + neutralX.toFixed(3) +
      "  selisih=" + dbg.offset.toFixed(3) + "  arah=" + dirText[moveDir];
    $("dbgY").textContent = "pinggul=" + dbg.hipRise.toFixed(3) + "  bahu=" + dbg.shRise.toFixed(3) +
      "  terkecil=" + dbg.rise.toFixed(3) + "  (ambang " + settings.jumpThreshold.toFixed(2) + ")";
    $("dbgJump").textContent = (now < jumpFlashUntil ? "TERDETEKSI" : "tidak") + "  [" + jumpState + "]";
    $("dbgHands").textContent = (handsRaised ? "terangkat" : "turun") + "  (selisih tangan-bahu=" + dbg.handsDelta.toFixed(3) + ")";
  } else {
    $("dbgX").textContent = "-";
    $("dbgY").textContent = "-";
    $("dbgJump").textContent = "-";
    $("dbgHands").textContent = "-";
  }
  $("dbgLm").textContent = ready ? lastVisible + "/" + REQUIRED.length + " " + (bodyOk ? "(lengkap)" : "(belum lengkap)") : "-";
  $("dbgFps").textContent = ready ? fpsValue.toFixed(1) : "-";
  $("dbgCalib").textContent = calibrated ? "Sudah (netral x=" + neutralX.toFixed(3) + ")" : "Belum (pakai posisi awal otomatis)";
}

/* ---------------------------------------------------------------------
   10. LOOP UTAMA (hanya satu, dimulai sekali)
   --------------------------------------------------------------------- */
let lastFrame = performance.now();
let lastUI = 0;

/* ---------------------------------------------------------------------
   ALUR OTOMATIS (bawaan aktif; matikan dengan  ?auto=0  di alamat URL)
   Setelah kamera menyala dan model siap:
     wait      -> tunggu tubuh terdeteksi lengkap dan stabil 1,5 detik
     calib     -> kalibrasi otomatis (kalau gagal, diulang setelah 3 detik)
     countdown -> hitungan mundur 3-2-1-Mulai!
     done      -> tes gerakan aktif dan game berjalan
   Hitungan mundur juga dipakai sebelum main lagi setelah game selesai.
   Semua tahap hanya tampil sebagai notifikasi (banner) dan angka di layar.
   Buka dengan  ?auto=1  agar kamera juga dinyalakan tanpa menekan tombol.
   --------------------------------------------------------------------- */
const COUNTDOWN_MS = 3000;   // lama angka 3-2-1
const GO_MS = 700;           // lama tulisan "Mulai!"
const auto = {
  on: new URLSearchParams(location.search).get("auto") !== "0",
  startCam: new URLSearchParams(location.search).get("auto") === "1",
  stage: "wait",     // wait | calib | countdown | done
  okSince: 0,        // sejak kapan tubuh terdeteksi lengkap
  retryAt: 0,
  cdT0: 0,           // awal hitungan mundur
  lostSince: 0,      // sejak kapan tubuh hilang selama hitungan mundur
  lastTick: 99       // angka hitungan mundur terakhir yang sudah dibunyikan
};

function beginCountdown(now) {
  auto.stage = "countdown";
  auto.cdT0 = now;
  auto.lostSince = 0;
  auto.lastTick = 99;
}

function updateAuto(now) {
  if (!auto.on || auto.stage === "done" || menungguLandscape()) return;
  const ready = cameraState === "on" && modelState === "ready";

  if (auto.stage === "wait") {
    if (!ready || !bodyOk || now < auto.retryAt) { auto.okSince = 0; return; }
    if (!auto.okSince) auto.okSince = now;
    if (now - auto.okSince >= 1500) {   // tubuh stabil 1,5 detik
      Suara.terdeteksi();
      if (calibrated) {
        beginCountdown(now);            // sudah dikalibrasi (mis. tubuh sempat keluar frame)
      } else {
        startCalibration();
        auto.stage = "calib";
      }
    }
  } else if (auto.stage === "calib") {
    if (calib.phase !== "idle") return;             // kalibrasi masih berjalan
    if (calibResult && calibResult.type === "ok") {
      beginCountdown(now);
    } else {
      auto.stage = "wait";              // gagal -> coba lagi setelah 3 detik
      auto.retryAt = now + 3000;
      auto.okSince = 0;
    }
  } else if (auto.stage === "countdown") {
    if (calib.phase !== "idle") { auto.stage = "calib"; return; }   // kalibrasi ulang manual dari panel
    const e = now - auto.cdT0;                    // bunyi tik 3-2-1 lalu "Mulai!" (sesuai angka di pop-up)
    if (e < COUNTDOWN_MS) {
      const n = 3 - Math.floor(e / 1000);
      if (n !== auto.lastTick) { auto.lastTick = n; Suara.tik(n); }
    } else if (auto.lastTick !== 0) {
      auto.lastTick = 0;
      Suara.mulai();
    }
    if (!bodyOk) {                      // tubuh keluar frame: batalkan hitungan bila lebih dari 0,8 detik
      if (!auto.lostSince) auto.lostSince = now;
      else if (now - auto.lostSince > 800) { auto.stage = "wait"; auto.okSince = 0; auto.lostSince = 0; }
      return;
    }
    auto.lostSince = 0;
    if (now - auto.cdT0 >= COUNTDOWN_MS + GO_MS) {
      auto.stage = "done";
      testActive = true;                // tubuh mengendalikan karakter
      startGame();
    }
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  detectPose(now);            // baca pose (jika kamera & model siap)
  updateCalibration(now);     // majukan tahap kalibrasi
  updateAuto(now);            // mode otomatis (?auto=1)
  updateCharacter(dt);        // gerakkan karakter
  updateGame(dt);             // koin, kayu, skor, nyawa
  drawScene(now);             // gambar canvas

  if (now - lastUI > 100) {   // update teks HTML ~10 kali per detik
    updateUI(now);
    lastUI = now;
  }
}

/* ---------------------------------------------------------------------
   11. EVENT: tombol, slider, keyboard
   --------------------------------------------------------------------- */
let toggleSuara = () => {};   // diisi di init()

function init() {
  btnStart.addEventListener("click", startCamera);
  btnStop.addEventListener("click", () => {
    if ((cameraState === "off" || cameraState === "error") && popupDismissed) popupDismissed = false;   // kembali ke pop-up awal
    else stopCamera();
  });
  $("btnKeyboard").addEventListener("click", () => { popupDismissed = true; });
  $("btnBatal").addEventListener("click", stopCamera);   // batalkan permintaan izin yang menggantung
  btnCalibrate.addEventListener("click", startCalibration);
  btnTest.addEventListener("click", () => {
    if (cameraState === "on" && modelState === "ready") {
      testActive = !testActive;
      updateButtons();
    }
  });

  // Suara: dibuka pada sentuhan/tombol pertama (aturan browser), klik tombol berbunyi, tombol bisu
  const bukaSuara = () => Suara.buka();
  window.addEventListener("pointerdown", bukaSuara, { passive: true });
  window.addEventListener("keydown", bukaSuara, { passive: true });
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("button")) Suara.klik();
  });
  const btnSuara = $("btnSuara");
  const tampilSuara = () => {
    btnSuara.textContent = Suara.bisu ? "🔇" : "🔊";
    btnSuara.title = Suara.bisu ? "Nyalakan suara (M)" : "Matikan suara (M)";
    btnSuara.setAttribute("aria-pressed", String(Suara.bisu));
  };
  toggleSuara = () => { Suara.balikBisu(); tampilSuara(); };
  btnSuara.addEventListener("click", toggleSuara);
  tampilSuara();

  // Panel status & pengaturan (geser dari kanan)
  const panel = $("panel");
  const setPanel = (open) => {
    panel.classList.toggle("open", open);
    $("btnPanel").setAttribute("aria-expanded", String(open));
  };
  $("btnPanel").addEventListener("click", () => setPanel(!panel.classList.contains("open")));
  $("btnPanelClose").addEventListener("click", () => setPanel(false));

  // Tampilkan / sembunyikan pratinjau kamera
  $("chkCam").addEventListener("change", (e) => cameraBox.classList.toggle("hide", !e.target.checked));

  // Resolusi canvas mengikuti ukuran layar
  muatLatar();
  updateResolution();
  window.addEventListener("resize", updateResolution);
  window.addEventListener("orientationchange", () => setTimeout(updateResolution, 400));
  document.addEventListener("fullscreenchange", () => setTimeout(updateResolution, 200));
  document.addEventListener("webkitfullscreenchange", () => setTimeout(updateResolution, 200));

  // Slider pengaturan
  const bindSlider = (sliderId, labelId, apply, format) => {
    const slider = $(sliderId);
    const update = () => {
      apply(parseFloat(slider.value));
      $(labelId).textContent = format(parseFloat(slider.value));
    };
    slider.addEventListener("input", update);
    slider.addEventListener("change", () => slider.blur());  // agar panah keyboard kembali mengendalikan karakter
    update();
  };
  $("sliderJump").value = settings.jumpThreshold;        // nilai bawaan diatur di objek settings
  $("sliderCooldown").value = settings.jumpCooldown;
  bindSlider("sliderJump", "valJumpThr", (v) => { settings.jumpThreshold = v; }, (v) => v.toFixed(2));
  bindSlider("sliderDead", "valDead", (v) => { settings.deadZone = v; }, (v) => v.toFixed(2));
  bindSlider("sliderCooldown", "valCool", (v) => { settings.jumpCooldown = v; }, (v) => Math.round(v) + " ms");

  // Mode jarak kamera (titik tubuh yang wajib terlihat)
  const rangeSelect = $("selectRange");
  rangeSelect.value = rangeMode;
  rangeSelect.addEventListener("change", () => {
    rangeMode = rangeSelect.value;
    REQUIRED = RANGE_MODES[rangeMode].points;
    missFrames = 0;
    rangeSelect.blur();    // agar panah keyboard kembali mengendalikan karakter
  });

  // Tampilkan / sembunyikan debug
  $("chkDebug").addEventListener("change", (e) => {
    $("debugList").classList.toggle("hidden", !e.target.checked);
  });

  // Keyboard cadangan
  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT" && e.target.type === "range") return;
    if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleSuara(); return; }
    if (e.key === "ArrowLeft")  { if (!e.repeat) Suara.geser(-1); keys.left = true; }
    else if (e.key === "ArrowRight") { if (!e.repeat) Suara.geser(1); keys.right = true; }
    else if (e.key === "ArrowUp") { if (!e.repeat) characterJump(); }
    else if (e.key === " ") { if (!e.repeat) Suara.magnet(); keys.space = true; }
    else if (e.key === "Enter") { if (game.state !== "playing" && auto.stage !== "countdown") { Suara.mulai(); startGame(); } }
    else return;
    e.preventDefault();
    lastKeyTime = performance.now();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft")  keys.left = false;
    else if (e.key === "ArrowRight") keys.right = false;
    else if (e.key === " ") { keys.space = false; e.preventDefault(); }
  });
  // Jika jendela kehilangan fokus, lepaskan semua tombol agar karakter tidak "macet".
  window.addEventListener("blur", () => { keys.left = keys.right = keys.space = false; });

  // Peringatan bila dibuka langsung dari file (bukan lewat Live Server)
  if (location.protocol === "file:") {
    errorMessage = "Halaman dibuka lewat file://. Gunakan Live Server di VS Code agar kamera dan library dapat bekerja.";
  }

  updateButtons();
  if (auto.startCam && location.protocol !== "file:") startCamera();   // kamera menyala sendiri
  requestAnimationFrame(loop);   // satu-satunya loop
}

init();
