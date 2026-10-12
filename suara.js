/* =====================================================================
   GERAKAN TUBUHMU - suara.js  (efek suara + musik latar)

   Semua suara dibuat langsung oleh browser lewat Web Audio API,
   jadi TIDAK ada file audio yang perlu diunduh dan tidak butuh internet.

   Aturan browser: suara baru boleh bunyi setelah pemain menyentuh layar
   atau menekan tombol. Karena itu game.js memanggil Suara.buka() pada
   sentuhan/tombol pertama (klik "Aktifkan Kamera" sudah cukup).

   Dimuat oleh game.js dengan:  import { Suara } from "./suara.js";
   ===================================================================== */

const AC = window.AudioContext || window.webkitAudioContext;

/* ---------------------------------------------------------------------
   PENGATURAN (boleh diubah)
   --------------------------------------------------------------------- */
const BPM = 128;                    // kecepatan musik latar
const VOL_UTAMA = 0.9;              // volume keseluruhan
const VOL_SFX = 0.9;                // volume efek suara
const VOL_BGM = { menu: 0.45, main: 0.8, selesai: 0.22 };   // volume musik menurut suasana

/* ---------------------------------------------------------------------
   MUSIK LATAR: 16 bar (2 bagian x 8 bar), tiap bar = 8 not seperdelapan.
   Angka = nomor not MIDI (72 = C5), 0 = diam.
   Akor: bagian A = C Am F G C Am F G, bagian B = F G Em Am F G C C
   --------------------------------------------------------------------- */
const AKAR = [48, 45, 41, 43, 48, 45, 41, 43,   41, 43, 40, 45, 41, 43, 48, 48];
const MELODI = [
  [79, 0, 76, 79, 84, 0, 79, 76],
  [76, 0, 72, 76, 81, 0, 76, 72],
  [77, 0, 81, 77, 84, 0, 81, 77],
  [83, 0, 79, 74, 79, 0, 83, 0],
  [84, 0, 79, 76, 79, 84, 0, 79],
  [81, 0, 76, 72, 76, 81, 0, 76],
  [77, 81, 84, 81, 77, 0, 81, 77],
  [79, 83, 86, 83, 79, 0, 74, 0],

  [81, 84, 81, 77, 84, 81, 77, 81],
  [83, 86, 83, 79, 86, 83, 79, 83],
  [79, 83, 79, 76, 83, 79, 76, 79],
  [81, 84, 81, 76, 84, 81, 76, 72],
  [84, 81, 77, 81, 84, 0, 81, 77],
  [86, 83, 79, 83, 86, 0, 83, 79],
  [84, 79, 76, 79, 84, 79, 76, 72],
  [72, 0, 76, 0, 79, 0, 84, 0]
];
const POLA_BAS = [0, 12, 7, 12, 0, 12, 7, 12];   // naik-turun ala "oom-pah"

/* ---------------------------------------------------------------------
   STATUS
   --------------------------------------------------------------------- */
let ctx = null, master = null, sfx = null, bgm = null, kebisingan = null;
let bisu = false;
try { bisu = localStorage.getItem("gt_bisu") === "1"; } catch (e) { /* abaikan */ }

let suasana = "menu";
let tempoKali = 1;
let bgmJalan = false, pemantau = null;
let langkah = 0, waktuLangkah = 0;
let terakhirGeser = -9, terakhirMagnet = -9, terakhirKoin = -9, kombo = 0;

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const siap = () => !!ctx && ctx.state === "running";

/* ---------------------------------------------------------------------
   ALAT DASAR
   --------------------------------------------------------------------- */

/** Satu nada: {f, f2 (geser ke), dur, tipe, vol, tunda atau t0, pan, ke}. */
function nada(o) {
  const t0 = o.t0 !== undefined ? o.t0 : ctx.currentTime + (o.tunda || 0);
  const osc = ctx.createOscillator();
  osc.type = o.tipe || "square";
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol !== undefined ? o.vol : 0.15, t0 + (o.att || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  let keluar = g;
  if (o.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p);
    keluar = p;
  }
  keluar.connect(o.ke || sfx);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

/** Desis / derau: {dur, vol, filter, f, f2, tunda atau t0, pan, ke}. */
function desis(o) {
  if (!kebisingan) {
    kebisingan = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = kebisingan.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = o.t0 !== undefined ? o.t0 : ctx.currentTime + (o.tunda || 0);
  const src = ctx.createBufferSource();
  src.buffer = kebisingan;
  const flt = ctx.createBiquadFilter();
  flt.type = o.filter || "highpass";
  flt.frequency.setValueAtTime(o.f || 2000, t0);
  if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol !== undefined ? o.vol : 0.1, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(flt);
  flt.connect(g);
  let keluar = g;
  if (o.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p);
    keluar = p;
  }
  keluar.connect(o.ke || sfx);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + o.dur + 0.05);
}

/* ---------------------------------------------------------------------
   MUSIK LATAR (penjadwal not)
   --------------------------------------------------------------------- */
function mainkanLangkah(idx, t, dur) {
  const bar = Math.floor(idx / 8), s = idx % 8;

  // Melodi (gelombang kotak, ceria)
  const m = MELODI[bar][s];
  if (m) nada({ f: mtof(m), dur: dur * 0.92, tipe: "square", vol: 0.075, t0: t, ke: bgm });

  // Bas (gelombang segitiga, lembut)
  nada({ f: mtof(AKAR[bar] + POLA_BAS[s]), dur: dur * 0.95, tipe: "triangle", vol: 0.2, t0: t, ke: bgm });

  // Drum: kick di ketukan 1 dan 3, snare di 2 dan 4, hi-hat di tiap not
  if (s === 0 || s === 4) nada({ f: 150, f2: 45, dur: 0.13, tipe: "sine", vol: 0.32, t0: t, ke: bgm });
  if (s === 2 || s === 6) {
    desis({ dur: 0.1, vol: 0.1, filter: "highpass", f: 1500, t0: t, ke: bgm });
    nada({ f: 220, f2: 140, dur: 0.07, tipe: "triangle", vol: 0.08, t0: t, ke: bgm });
  }
  desis({ dur: 0.035, vol: s % 2 ? 0.035 : 0.055, filter: "highpass", f: 7000, t0: t, ke: bgm });
}

function jadwalkan() {
  if (!siap() || !bgmJalan) return;
  if (waktuLangkah < ctx.currentTime) waktuLangkah = ctx.currentTime + 0.05;   // setelah tab sempat tidur
  while (waktuLangkah < ctx.currentTime + 0.25) {
    const dur = 60 / (BPM * tempoKali) / 2;
    mainkanLangkah(langkah % 128, waktuLangkah, dur);
    waktuLangkah += dur;
    langkah++;
  }
}

function aturVolumeBgm() {
  if (!bgm) return;
  bgm.gain.setTargetAtTime(VOL_BGM[suasana] !== undefined ? VOL_BGM[suasana] : 0.45, ctx.currentTime, 0.4);
}

function mulaiBgm() {
  if (bgmJalan) return;
  bgmJalan = true;
  waktuLangkah = ctx.currentTime + 0.1;
  aturVolumeBgm();
  pemantau = setInterval(jadwalkan, 60);
}

/* ---------------------------------------------------------------------
   API UNTUK GAME
   --------------------------------------------------------------------- */
export const Suara = {

  /** Panggil saat ada sentuhan/tombol pemain: menyalakan suara dan musik latar. */
  buka() {
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      const kompresor = ctx.createDynamicsCompressor();   // mencegah suara pecah bila banyak yang berbunyi
      master = ctx.createGain();
      master.gain.value = bisu ? 0 : VOL_UTAMA;
      master.connect(kompresor);
      kompresor.connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.gain.value = VOL_SFX;
      sfx.connect(master);
      bgm = ctx.createGain();
      bgm.gain.value = 0;
      bgm.connect(master);
      document.addEventListener("visibilitychange", () => {   // tab disembunyikan -> senyap
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
      });
    }
    if (ctx.state === "suspended") {
      ctx.resume().then(() => mulaiBgm()).catch(() => {});
    } else if (ctx.state === "running") {
      mulaiBgm();
    }
  },

  /** Bisu / bunyi. Mengembalikan true bila sekarang bisu. */
  balikBisu() {
    bisu = !bisu;
    try { localStorage.setItem("gt_bisu", bisu ? "1" : "0"); } catch (e) { /* abaikan */ }
    if (master) master.gain.setTargetAtTime(bisu ? 0 : VOL_UTAMA, ctx.currentTime, 0.05);
    return bisu;
  },
  get bisu() { return bisu; },

  /** Suasana musik: "menu" | "main" | "selesai". */
  setSuasana(s) {
    if (s === suasana) return;
    suasana = s;
    if (siap()) aturVolumeBgm();
  },

  /** Kecepatan musik (1 = normal, 1.15 = 15% lebih cepat). */
  tempo(k) { tempoKali = Math.min(Math.max(k, 0.8), 1.3); },

  /* ----- Efek suara ----- */

  klik() {
    if (!siap()) return;
    nada({ f: 880, f2: 1320, dur: 0.07, tipe: "square", vol: 0.1 });
  },

  lompat() {
    if (!siap()) return;
    nada({ f: 320, f2: 760, dur: 0.2, tipe: "square", vol: 0.13 });
    nada({ f: 640, f2: 1500, dur: 0.16, tipe: "sine", vol: 0.07 });
  },

  mendarat() {
    if (!siap()) return;
    nada({ f: 190, f2: 70, dur: 0.1, tipe: "sine", vol: 0.2 });
  },

  /** arah: -1 kiri, 1 kanan (suara bergeser ke telinga yang sesuai). */
  geser(arah) {
    if (!siap() || ctx.currentTime - terakhirGeser < 0.25) return;
    terakhirGeser = ctx.currentTime;
    desis({ dur: 0.15, vol: 0.08, filter: "bandpass", f: arah > 0 ? 800 : 2600, f2: arah > 0 ? 2600 : 800, pan: arah * 0.6 });
  },

  /** Koin diambil; makin beruntun makin tinggi nadanya. */
  koin() {
    if (!siap()) return;
    const now = ctx.currentTime;
    kombo = now - terakhirKoin < 1.3 ? Math.min(kombo + 1, 7) : 0;
    terakhirKoin = now;
    const f = 988 * Math.pow(2, (kombo * 2) / 12);
    nada({ f: f, dur: 0.08, tipe: "square", vol: 0.1 });
    nada({ f: f * 1.5, dur: 0.2, tipe: "square", vol: 0.1, tunda: 0.07 });
  },

  magnet() {
    if (!siap() || ctx.currentTime - terakhirMagnet < 0.6) return;
    terakhirMagnet = ctx.currentTime;
    nada({ f: 300, f2: 1100, dur: 0.3, tipe: "triangle", vol: 0.18 });
    nada({ f: 450, f2: 1650, dur: 0.3, tipe: "sine", vol: 0.09, tunda: 0.04 });
  },

  /** Terkena kayu. */
  aduh() {
    if (!siap()) return;
    nada({ f: 420, f2: 110, dur: 0.32, tipe: "sawtooth", vol: 0.14 });
    desis({ dur: 0.12, vol: 0.1, filter: "lowpass", f: 1800 });
  },

  /** Nyawa habis. */
  selesai() {
    if (!siap()) return;
    [523, 392, 330, 262].forEach((f, i) => {
      nada({ f: f, dur: i === 3 ? 0.55 : 0.2, tipe: "triangle", vol: 0.2, tunda: 0.4 + i * 0.18 });
    });
  },

  /** Hitungan mundur 3, 2, 1. */
  tik(n) {
    if (!siap()) return;
    const f = { 3: 523, 2: 587, 1: 659 }[n] || 523;
    nada({ f: f, dur: 0.14, tipe: "square", vol: 0.13 });
  },

  /** "Mulai!" */
  mulai() {
    if (!siap()) return;
    nada({ f: 523, f2: 1046, dur: 0.35, tipe: "square", vol: 0.12 });
    nada({ f: 784, f2: 1568, dur: 0.35, tipe: "triangle", vol: 0.14 });
  },

  /** Tubuh terdeteksi lengkap. */
  terdeteksi() {
    if (!siap()) return;
    nada({ f: 784, dur: 0.1, tipe: "square", vol: 0.1 });
    nada({ f: 1047, dur: 0.2, tipe: "square", vol: 0.1, tunda: 0.09 });
  },

  /** Kalibrasi berhasil. */
  berhasil() {
    if (!siap()) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      nada({ f: f, dur: i === 3 ? 0.3 : 0.1, tipe: "square", vol: 0.1, tunda: i * 0.09 });
    });
  },

  /** Kalibrasi gagal. */
  gagal() {
    if (!siap()) return;
    nada({ f: 300, f2: 190, dur: 0.22, tipe: "triangle", vol: 0.2 });
  },

  /** Tubuh keluar dari frame saat bermain. */
  hilang() {
    if (!siap()) return;
    nada({ f: 360, f2: 240, dur: 0.18, tipe: "triangle", vol: 0.16 });
  }
};
