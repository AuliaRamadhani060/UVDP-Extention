# UVPD → Browser Extension — Blueprint Pengembangan Lengkap

**Dokumen ini adalah spesifikasi arsitektur (bukan kode jadi).**
Tujuannya: menjadi acuan yang bisa Anda serahkan **per-bagian** ke code assistant, supaya ia paham *apa* yang dibangun, *ke mana* tiap bagian pergi, dan *mengapa*. Sasaran: ekstensi Manifest V3 yang **menyamai lalu melampaui** userscript UVPD v0.6.1 untuk konten **non-DRM**.

---

## 0. Cara memakai dokumen ini

1. Baca **Bab 1–3** dulu (diagnosa + prinsip + arsitektur). Ini konteks wajib.
2. Bangun **bertahap sesuai Bab 10** (Fase 0 → 4). Jangan minta code assistant membuat semuanya sekaligus — itu penyebab utama hasil berantakan.
3. Saat menyuruh code assistant, sertakan **Bab 3 (arsitektur)** + **bab komponen yang relevan** + **Bab 7 (kontrak pesan)**. Tanpa kontrak pesan, tiap potongan kode tidak akan menyambung.

---

## 1. Diagnosa: kenapa port sekarang lebih lemah dari userscript

Sebelum membangun, pahami *mengapa* hasil sekarang tidak menyamai. Hampir pasti karena satu atau lebih dari ini — dan tiap poin punya solusinya di bab terkait:

| Gejala | Akar masalah | Solusi (bab) |
|---|---|---|
| Media terdeteksi lalu "hilang" setelah beberapa detik | State ditaruh di **service worker yang ephemeral** (MV3 mematikan SW saat idle ~30 dtk). `Map` in-memory Anda terhapus. | §5.4, §9 |
| Hook `appendBuffer`/MediaSource tidak menangkap apa-apa | Content script berjalan di **isolated world** — tidak bisa melihat objek `MediaSource` milik halaman. | §5.2, §8 |
| Parser DASH (`.mpd`) error di background | **`DOMParser` tidak tersedia di service worker.** | §5.5, §9 |
| Menunggu isi manifest dari `webRequest` tapi tak pernah datang | `webRequest` **tidak memberi response body** — hanya URL, header, status. | §5.4 |
| Deteksi jalan, tapi tiap potongan kode tidak saling nyambung | Belum ada **kontrak pesan** yang tegas antar lapisan. | §7 |
| Banyak fitur lama hilang | Engine ditulis ulang dari nol, bukan **di-port**. Padahal ~80% bisa dipakai ulang. | §4 |

**Intinya:** ekstensi punya *empat konteks eksekusi berbeda* yang tidak ada di userscript. Kegagalan port hampir selalu karena kode ditaruh di konteks yang salah.

---

## 2. Prinsip & batas keras (non-goals) — WAJIB dipatuhi

Supaya code assistant tidak mengejar hal mustahil dan membuang waktu Anda:

**Yang DIKEJAR (sah, dalam desain):**
- Cakupan deteksi menyeluruh untuk media **non-DRM** (semua frame, service worker, background request).
- Menangkap URL fragmen/segment yang selama ini **dibuang** userscript.
- Menangkap buffer MSE **non-DRM** langsung dari pemutar.
- Unduhan andal, resumable, tulis-ke-disk.

**Batas keras yang TIDAK bergeser (jangan dikejar):**
- **Blob MediaSource tanpa URL** → isinya di memori, tak ada yang bisa di-fetch. Mustahil, bukan soal effort.
- **Konten DRM/EME** (Widevine/FairPlay/PlayReady) → frame terdekripsi tak pernah ada di memori yang bisa diakses JS. Ini garis yang tidak dilewati, dan sesuai header script Anda sendiri.

> **Aturan untuk setiap modul deteksi/unduh:** jika sebuah stream membawa sinyal proteksi (EME/`encrypted`/`ContentProtection` non-clear, HLS `SAMPLE-AES`/keyformat non-identity), tandai `protected` dan **hentikan pemrosesan**. Buffer yang tertangkap dari konten terenkripsi tetap terenkripsi dan tak berguna — jadi penjaga ini juga otomatis benar secara teknis.

---

## 3. Arsitektur target: empat konteks + dua lapis

Meniru pola IDM (pengamat + pekerja), tapi seluruhnya berbasis web-extension.

### 3.1 Empat konteks eksekusi

```
┌──────────────────────────────────────────────────────────────────┐
│  HALAMAN WEB (tab pengguna)                                        │
│                                                                    │
│  ① MAIN world  ── media-hook.js (injected)                         │
│     • hook MediaSource / SourceBuffer.appendBuffer                 │
│     • hook fetch / XHR (opsional, sbagian yg butuh objek halaman)  │
│     • kirim temuan via window.postMessage / CustomEvent            │
│            │                                                        │
│            ▼ (postMessage, world → isolated)                       │
│  ② Content script (isolated world) ── bridge.js                    │
│     • jembatan dua arah page ⇄ background                          │
│     • scan DOM/Shadow DOM (port dari userscript)                   │
│     • suntik media-hook.js ke MAIN world                           │
│     • render UI in-page bila perlu (tombol mengambang)             │
└────────────┬───────────────────────────────────────────────────────┘
             │ chrome.runtime.sendMessage / Port
             ▼
┌──────────────────────────────────────────────────────────────────┐
│  ③ BACKGROUND SERVICE WORKER ── otak (LAPISAN PENGAMAT baru)        │
│     • webRequest: amati SEMUA request (semua frame, SW, xorigin)   │
│     • klasifikasi media + registry terpadu (persisted)             │
│     • message router (kontrak §7)                                  │
│     • download engine (PORT dari userscript)                       │
│     • parser HLS (PORT) — fetch manifest sendiri lalu parse        │
│     • Web Crypto (AES-128), IndexedDB (resume) — tersedia di SW    │
└────────────┬───────────────────────────────────────────────────────┘
             │ chrome.offscreen (untuk yg butuh DOM/berat)
             ▼
┌──────────────────────────────────────────────────────────────────┐
│  ④ OFFSCREEN DOCUMENT ── pekerja DOM                                │
│     • DOMParser untuk .mpd (DASH) — tak ada di SW                  │
│     • tugas parsing/proses berat lain                             │
└──────────────────────────────────────────────────────────────────┘

UI SURFACES (terpisah): popup · side panel · options page · player window/tab
```

### 3.2 Dua lapis (cara memandangnya)

- **Lapisan Pengamat (BARU):** ①+③ — menangkap kandidat media dari seluruh jaringan & pemutar, mengelola state, antrean, siklus hidup.
- **Lapisan Pekerja (DIPAKAI ULANG):** parser, player, download engine, dekripsi, ffmpeg export — kode matang Anda yang **pindah rumah**, bukan ditulis ulang.

### 3.3 Prinsip alur data (ingat baik-baik)

1. `webRequest` **hanya memberi URL + header**, bukan isi. Untuk parse manifest → background **re-fetch URL itu sendiri** (origin ekstensi bebas CORS dengan host permission), lalu parse.
2. Hook MSE **harus di MAIN world**, hasilnya dialirkan turun ke content script lalu ke background.
3. State hidup **hanya di tempat persisten** (chrome.storage / IndexedDB) atau di UI yang aktif — **tidak** di variabel SW.

---

## 4. Peta migrasi: pakai ulang vs. tulis ulang vs. baru

Ini menjawab langsung "kenapa tidak menyamai userscript" — kemungkinan besar bagian "PORT" di bawah ditulis ulang, padahal seharusnya dipindah nyaris apa adanya.

| Modul userscript UVPD v0.6.1 | Nasib | Pindah ke konteks | Catatan |
|---|---|---|---|
| Parser HLS (`processPlaylist`) | **PORT** (≈apa adanya) | Background SW | Ganti sumber teks: fetch sendiri, bukan dari hook fetch halaman |
| Parser DASH (`processDashManifest`) | **PORT + adaptasi** | **Offscreen** (butuh `DOMParser`) | Atau ganti ke parser XML murni-JS agar tetap di SW |
| Download engine (direct/segmented/queue) | **PORT** | Background SW | `GM_xmlhttpRequest` → `fetch` (ekstensi bebas CORS) atau `chrome.downloads` |
| Dekripsi AES-128 (`crypto.subtle`) | **PORT** (apa adanya) | Background SW | Web Crypto tersedia di SW |
| Resume via IndexedDB | **PORT** (apa adanya) | Background SW | IndexedDB tersedia di SW; ini malah lebih pas di sini |
| ffmpeg command builder | **PORT** (apa adanya) | Background/UI | Logika murni string |
| Scan DOM / Shadow DOM | **PORT** | Content script | Konteks isolated cukup untuk baca DOM |
| Redaksi token / canonical identity | **PORT** (apa adanya) | Background SW | Logika murni |
| Registry media (`videos` Map) | **REDESAIN** | Background + chrome.storage | Tidak boleh in-memory murni (lihat §9) |
| Player window (hls.js/dash.js, PiP, subtitle, thumbnail) | **PORT** | Extension page (player.html) | Buka via `chrome.tabs`/window; muat hls.js dari file lokal (bukan CDN) |
| UI Media Library (modal) | **PORT + pindah** | Side panel / popup / options | Boleh tetap in-page, tapi side panel lebih kokoh untuk SPA |
| Persistensi `GM_*` | **GANTI** | — | `GM_getValue/Set` → `chrome.storage.local`; `GM_download` → `chrome.downloads` |
| Interceptor fetch/XHR (bagian jaringan) | **GANTI** | Background `webRequest` | Ini upgrade besar: dari "1 origin" → "semua request" |
| Filter `isVideoLike` (buang fragmen) | **REDESAIN** | Background | Jangan buang fragmen — kelompokkan (lihat §5.4 & §8) |
| Bridge iframe (`postMessage`) | **DIGANTIKAN** | webRequest + `frameId` | webRequest sudah melihat semua frame; bridge manual tak perlu |

**Estimasi:** ±80% baris logika inti dipakai ulang. Yang benar-benar **baru** hanya: lapisan `webRequest`, injektor MAIN-world, offscreen, dan kontrak pesan.

---

## 5. Spesifikasi komponen

### 5.1 `manifest.json` (Manifest V3)

Kerangka minimum yang dibutuhkan:

```jsonc
{
  "manifest_version": 3,
  "name": "UVPD — Universal Video Player & Downloader",
  "version": "0.7.0",
  "permissions": [
    "webRequest",          // amati request (observasi, bukan blocking)
    "storage",             // pengganti GM_getValue/Set
    "downloads",           // tulis file ke disk
    "scripting",           // suntik MAIN-world hook
    "offscreen",           // DOMParser & tugas berat
    "tabs",                // buka player window, kelola tab
    "sidePanel"            // UI utama (opsional tapi disarankan)
  ],
  "host_permissions": ["<all_urls>"],   // agar webRequest & fetch lintas-situs
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/bridge.js"],
    "run_at": "document_start",
    "all_frames": true
  }],
  "web_accessible_resources": [{
    "resources": ["page/media-hook.js", "player/player.html", "vendor/hls.min.js", "vendor/dash.min.js"],
    "matches": ["<all_urls>"]
  }],
  "side_panel": { "default_path": "ui/panel.html" },
  "action": { "default_popup": "ui/popup.html" },
  "options_page": "ui/options.html"
}
```

**Catatan penting untuk code assistant:**
- MV3 `webRequest` untuk **observasi tetap boleh**; yang dibatasi hanya *blocking/modifying* (itu wilayah `declarativeNetRequest`). Deteksi media = observasi → aman.
- Pustaka `hls.js`/`dash.js` **di-bundle sebagai file lokal** di `vendor/` (bukan dari CDN), karena CSP situs (mis. YouTube) bisa memblokir CDN eksternal.

### 5.2 Injektor MAIN-world — `page/media-hook.js`

**Kenapa perlu:** untuk mengait objek milik halaman (`MediaSource`, `SourceBuffer`), kode harus berada di **JS context yang sama dengan halaman**. Content script biasa (isolated) tidak bisa.

**Cara menyuntik (dua opsi):**
- **Deklaratif (Chrome 111+):** tambahkan entri `content_scripts` kedua dengan `"world": "MAIN"`.
- **Programatik:** dari `bridge.js` panggil `chrome.scripting.executeScript({ target, world: 'MAIN', files: ['page/media-hook.js'] })`.

**Tugas hook:**
- Bungkus `window.MediaSource.prototype.addSourceBuffer` dan `SourceBuffer.prototype.appendBuffer`.
- Untuk tiap `appendBuffer(chunk)` pada media **non-terenkripsi**: salin `ArrayBuffer`, kirim ke bridge via `window.postMessage({ source: 'uvpd-hook', ... })`.
- (Opsional) tangkap `URL.createObjectURL` untuk memetakan handle blob ↔ MediaSource, demi info diagnostik (bukan untuk unduh).
- **Penjaga DRM:** jika terkait EME (`requestMediaKeySystemAccess` terdeteksi / SourceBuffer dari MediaKeys), **jangan tangkap** — tandai protected. Lihat §8.

### 5.3 Content script (bridge) — `content/bridge.js` (isolated world)

Peran: **jembatan + mata di DOM**.
- Menyuntik `media-hook.js` ke MAIN world sedini mungkin (`document_start`).
- Mendengar `window.message` dari hook → teruskan ke background via `chrome.runtime.sendMessage`.
- Menerima perintah dari background/UI → aksi di halaman bila perlu.
- **Port dari userscript:** scan DOM/Shadow DOM (`scanElementForMediaCandidates`), deteksi `<track>` subtitle/thumbnail. Kirim kandidat ke background.
- (Opsional) render tombol mengambang in-page — tapi UI utama sebaiknya di side panel.

### 5.4 Background service worker — `background/index.js` (OTAK)

Sub-modul:

**a. Network observer (`net-observer.js`) — BARU, inti keunggulan**
- Daftarkan listener observasi:
  ```js
  chrome.webRequest.onBeforeRequest.addListener(handler, { urls: ["<all_urls>"] });
  chrome.webRequest.onResponseStarted.addListener(handler2, { urls: ["<all_urls>"] }, ["responseHeaders"]);
  ```
- Untuk tiap request: ambil `url`, `type`, `tabId`, `frameId`, `responseHeaders` (Content-Type).
- **Klasifikasi** (logika port dari userscript, tapi JANGAN buang fragmen):
  - `.m3u8` / `application/vnd.apple.mpegurl` → HLS manifest → antre untuk **re-fetch & parse**.
  - `.mpd` / `application/dash+xml` → DASH manifest → re-fetch & parse (via offscreen).
  - progressive (`video/mp4`, `video/webm`, …) → media langsung.
  - **fragmen/segment** (`.ts`, `.m4s`, `range=`, host `googlevideo`, `seg/chunk/frag`) → **JANGAN dibuang**: kelompokkan per "stream induk" (lihat pengelompokan di §8), simpan pola URL + itag/quality.
- **Ingat:** webRequest tak memberi body. Untuk manifest, background **fetch sendiri** URL-nya lalu serahkan teksnya ke parser.

**b. Registry & state (`registry.js`) — REDESAIN**
- Struktur data terpadu (§6), disimpan ke `chrome.storage.session` (hidup selama browser sesi) + snapshot penting ke `chrome.storage.local`.
- **Jangan** simpan hanya di variabel modul SW (akan hilang saat SW mati). Rehydrate saat SW bangun.

**c. Message router (`router.js`)**
- Satu titik masuk `chrome.runtime.onMessage` yang mem-*dispatch* sesuai `type` (kontrak §7).

**d. Engine (PORT):** download manager, parser HLS, dekripsi AES-128, resume IndexedDB, ffmpeg builder, redaksi token. Web Crypto + IndexedDB + fetch semuanya tersedia di SW.

### 5.5 Offscreen document — `offscreen/offscreen.html` + `offscreen.js`

**Kenapa perlu:** service worker **tidak punya `DOMParser`** (dan tak punya DOM). Parser DASH Anda memakai `DOMParser`.
- Dibuat on-demand via `chrome.offscreen.createDocument({ reasons: ['DOM_PARSER'], ... })`.
- Terima teks `.mpd` dari background → parse dengan `DOMParser` (port `processDashManifest`) → kembalikan hasil terstruktur.
- **Alternatif** agar tak perlu offscreen: pakai parser XML murni-JS (mis. `fast-xml-parser`) dan tetap di SW. Pilih salah satu; offscreen lebih setia ke kode lama.

### 5.6 Download engine (PORT)

- Ganti `GM_xmlhttpRequest` → `fetch` (ekstensi + host permission = bebas CORS, setara `@connect *`).
- Untuk file besar/simpan-ke-disk: `chrome.downloads.download({ url | blob, filename, saveAs })`.
- Pertahankan: worker paralel, retry backoff+jitter, dekripsi AES-128, penanganan audio/video terpisah, resume IndexedDB (semua sudah kompatibel SW).
- Progress → kirim ke UI via Port (streaming), bukan sendMessage sekali-jalan.

### 5.7 Parser (PORT)

- HLS: di SW (teks murni).
- DASH: di offscreen (atau parser JS di SW).
- Pertahankan deteksi enkripsi & penandaan `protected` persis seperti userscript.

### 5.8 UI surfaces

| Surface | Peran | Kenapa |
|---|---|---|
| **Side panel** (`panel.html`) | Media Library utama (port dari modal) | Persisten lintas-navigasi SPA; tak terpengaruh reload halaman |
| **Popup** (`popup.html`) | Ringkasan cepat + jumlah temuan tab aktif | Akses 1 klik |
| **Options** (`options.html`) | Semua setting (port `DEFAULT_SETTINGS`) + export/import | Pengganti settings overlay |
| **Player** (`player.html`) | Player kustom (port: hls.js/dash.js, speed, PiP, subtitle, thumbnail, track switch) | Halaman ekstensi → bebas CSP situs, hls.js lokal |

---

## 6. Model data terpadu (schema `MediaEntry`)

Satu bentuk konsisten dipakai lintas semua lapisan. Ini mencegah "tiap potongan kode bicara bahasa berbeda".

```jsonc
{
  "id": "fnv-hash-dari-canonical-identity",   // stabil, dari userscript
  "kind": "direct | hls | dash | mse-capture", // sumber deteksi
  "url": "https://... (asli)",
  "canonicalId": "https://...{redacted}...",   // token diredaksi
  "origin": "youtube.com",
  "tabId": 42,
  "frameId": 0,
  "name": "judul terbaik yg bisa didapat",
  "protected": false,                          // true → JANGAN proses
  "protectionType": "",                        // mis. 'widevine','SAMPLE-AES'
  "container": "mp4 | webm | ts | m4s",
  "durationSec": 0,
  "sizeBytes": 0,
  "variants": [ { "width":1920,"height":1080,"bandwidth":0,"codecs":"","fps":0,"url":"" } ],
  "audioTracks": [ { "lang":"","codecs":"","url":"" } ],
  "textTracks":  [ { "lang":"","kind":"subtitles","url":"" } ],
  "thumbnailTrack": "url .vtt | null",
  "segments": {                                // untuk stream fragmen (BARU)
    "pattern": "template/rentang URL",
    "itag": "137",
    "collected": 0,
    "complete": false
  },
  "mseChunks": null,                           // ref buffer tertangkap (BARU, non-DRM)
  "discoveredAt": 0,
  "source": "dom | network | mse | manual"
}
```

---

## 7. Kontrak pesan antar-lapisan (KRITIS)

Tanpa ini, kode tiap konteks tidak menyambung. Semua pesan objek `{ type, payload }`. Rekomendasi: `sendMessage` untuk event singkat, `Port` (`chrome.runtime.connect`) untuk stream progress.

**MAIN-world hook → content bridge** (via `window.postMessage`):
| type | payload | arti |
|---|---|---|
| `HOOK_MEDIA_URL` | `{ url, container }` | hook fetch/XHR menemukan URL media |
| `HOOK_MSE_CHUNK` | `{ streamId, bytes(ArrayBuffer), mime, protected }` | potongan `appendBuffer` non-DRM |
| `HOOK_EME_DETECTED` | `{ keySystem }` | halaman memakai DRM → tandai protected |

**Content bridge → background** (via `runtime.sendMessage`):
| type | payload |
|---|---|
| `MEDIA_CANDIDATE` | `MediaEntry parsial (dari DOM/hook)` |
| `DOM_TRACKS_FOUND` | `{ tabId, textTracks, thumbnailTrack }` |

**UI (panel/popup) → background:**
| type | payload |
|---|---|
| `GET_MEDIA_LIST` | `{ tabId }` → balas daftar `MediaEntry` |
| `PLAY_MEDIA` | `{ id }` → background buka player.html |
| `DOWNLOAD_MEDIA` | `{ id, strategy: 'direct|segmented|resumable', quality }` |
| `COPY_FFMPEG` | `{ id }` |
| `TOGGLE_SITE` | `{ host, enabled }` |
| `UPDATE_SETTINGS` | `{ ...settings }` |

**Background → UI (broadcast / Port):**
| type | payload |
|---|---|
| `MEDIA_LIST_UPDATED` | `{ tabId, entries[] }` |
| `DOWNLOAD_PROGRESS` | `{ id, done, total, bytes, speed }` |
| `DOWNLOAD_DONE` / `DOWNLOAD_ERROR` | `{ id, ... }` |

---

## 8. Modul baru kunci: penangkapan MSE + pengelompokan fragmen (non-DRM)

Inilah yang menutup celah "YouTube-like". Dua teknik komplementer:

### 8.1 Pengelompokan fragmen (dari webRequest)
- Alih-alih membuang URL `range=`/segment (yang userscript lakukan), **kumpulkan** per stream induk.
- Kunci pengelompokan: host + path template + `itag`/quality param. Fragmen dengan itag sama = satu representasi.
- Simpan pola sehingga bisa disusun ulang berurutan, lalu diunduh via engine segmented yang sudah ada.
- Untuk audio/video terpisah (itag berbeda) → unduh dua-duanya → arahkan mux via ffmpeg (jalur yang sudah Anda punya).

### 8.2 Penangkapan `appendBuffer` (dari MAIN-world hook)
- Untuk sumber yang URumumnya tak terekspos, tangkap `ArrayBuffer` saat disuntik ke `SourceBuffer` (§5.2).
- Akumulasi per `streamId` → saat pemutaran menjangkau seluruh durasi, gabung → remux (ffmpeg) → simpan.
- **Sadari & tulis di UI:** penangkapan bersifat **real-time** (harus memutar seluruh video), dan hasil butuh remux. Ini bukan unduh instan.

### 8.3 Penjaga DRM (mutlak)
- Sebelum menyimpan chunk apa pun: cek apakah stream terkait EME/`encrypted`. Jika ya → set `protected=true`, buang buffer, hentikan. Buffer terenkripsi memang tak berguna, jadi penjaga ini benar secara teknis sekaligus etis.

---

## 9. Jebakan MV3 (checklist anti-gagal)

| Jebakan | Akibat | Penangkal |
|---|---|---|
| Service worker ephemeral | State hilang, deteksi "reset" | Simpan state di `chrome.storage.session`/IndexedDB; rehydrate saat SW bangun; jangan andalkan variabel modul |
| Isolated vs MAIN world | Hook MSE gagal total | Suntik hook via `world:"MAIN"` (§5.2) |
| `DOMParser` tak ada di SW | Parser DASH crash | Offscreen document, atau parser XML JS (§5.5) |
| `webRequest` tanpa body | Manifest tak bisa dibaca | Background fetch ulang URL lalu parse (§5.4) |
| CSP situs blokir CDN | hls.js/dash.js gagal load | Bundle pustaka sebagai file lokal `vendor/` (§5.1) |
| Blocking webRequest dibatasi MV3 | Fitur modifikasi request gagal | Anda hanya butuh **observasi** — itu tetap didukung |
| Listener didaftar di dalam async | webRequest/onMessage tak ter-*register* | Daftarkan listener di **top-level** SW, sinkron saat startup |
| Port progress vs sendMessage | Progress unduhan patah-patah | Pakai `Port` untuk stream progress (§7) |

---

## 10. Roadmap bertahap (bangun sesuai urutan ini)

Jangan lompat. Tiap fase harus jalan sebelum lanjut.

**Fase 0 — Kerangka & kontrak (fondasi)**
- Scaffold manifest, background SW, content bridge, side panel kosong.
- Implement **kontrak pesan §7** (walau isinya masih dummy).
- Verifikasi pesan mengalir: page → bridge → background → panel.
- *Kriteria lulus:* panel menampilkan "hello" yang dikirim dari background.

**Fase 1 — Parity deteksi (samai userscript)**
- Port scan DOM/Shadow DOM ke bridge.
- Pasang `webRequest` observer + klasifikasi HLS/DASH/direct.
- Port parser HLS (SW) + DASH (offscreen).
- Registry terpadu + tampil di side panel (search/filter/sort — port UI).
- *Kriteria lulus:* di situs uji non-DRM, ekstensi mendeteksi ≥ sebanyak userscript.

**Fase 2 — Parity player & unduh (samai userscript)**
- Port player.html (hls.js/dash.js lokal, PiP, subtitle, thumbnail, track switch).
- Port download engine (direct/segmented/resumable), AES-128, ffmpeg export.
- *Kriteria lulus:* semua yang bisa dilakukan userscript, kini bisa di ekstensi.

**Fase 3 — Lampaui userscript (keunggulan baru)**
- Aktifkan **pengelompokan fragmen** (§8.1) — mulai tangkap stream yang dulu dibuang.
- Registry lintas-frame via `frameId` (hilangkan bridge iframe manual).
- Antrean unduhan global + resume lintas-sesi via `chrome.storage`.

**Fase 4 — MSE capture (celah YouTube-like, non-DRM)**
- Aktifkan hook `appendBuffer` MAIN-world (§8.2) dengan penjaga DRM (§8.3).
- Akumulasi + remux pipeline.
- *Kriteria lulus:* stream MSE non-DRM tertentu bisa ditangkap & disusun.

---

## 11. Checklist validasi akhir

- [ ] SW mati lalu bangun → state deteksi tidak hilang.
- [ ] Navigasi SPA (klik-klik dalam situs) → deteksi tetap update tanpa reload.
- [ ] Media di dalam iframe lintas-origin terdeteksi (uji `frameId`).
- [ ] `.m3u8` & `.mpd` ter-parse benar (variants/audio/subtitle).
- [ ] Konten DRM → ditandai `protected`, **tidak** diproses, tidak ada buffer disimpan.
- [ ] Unduhan segmented + AES-128 menghasilkan file utuh & benar.
- [ ] Resume: putus di tengah → lanjut dari chunk terakhir, integritas lolos.
- [ ] hls.js/dash.js load dari file lokal di situs ber-CSP ketat.
- [ ] ffmpeg command benar untuk kasus live/multi-period/SegmentBase.

---

## Ringkasan satu paragraf

Ekstensi UVPD adalah userscript Anda yang **pindah rumah ke empat konteks eksekusi**: hook di MAIN world untuk menangkap MSE non-DRM, content script sebagai jembatan + mata DOM, background service worker sebagai otak dengan `webRequest` yang melihat *seluruh* jaringan (inilah keunggulan setara-IDM), dan offscreen document untuk `DOMParser` DASH. Sekitar 80% logika inti Anda — parser, player, download engine, dekripsi, resume — **dipakai ulang**, bukan ditulis ulang; yang baru hanya lapisan pengamat jaringan, injektor, dan kontrak pesan. Hasilnya jauh lebih kuat dan fleksibel untuk konten **non-DRM**, sambil tetap berhenti tegas di dua tembok yang tak bisa dilewati siapa pun: blob MediaSource tanpa URL, dan konten ber-DRM.
