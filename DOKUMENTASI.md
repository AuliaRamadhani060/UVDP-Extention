# UVPD Extension — Dokumentasi Sistem (Yang Sudah Ada & Berjalan)

> Dokumen ini menjelaskan **apa yang benar-benar sudah dibangun dan berfungsi** pada ekstensi
> UVPD (Universal Video Player & Downloader). Bukan rencana, bukan fitur masa depan — hanya
> kondisi nyata sistem saat ini.
>
> **Status build:** `tsc --noEmit` bersih; build sukses untuk **Chrome/Edge/Brave** (`dist/chrome`)
> dan **Firefox** (`dist/firefox`). Sejumlah logika inti sudah diverifikasi lewat uji harness Node
> (lihat bagian *Validasi*).

---

## 1. Ringkasan

UVPD adalah ekstensi **Manifest V3 lintas-browser** hasil migrasi userscript UVPD 0.6.1. Tujuannya:
mendeteksi, memutar, dan mengunduh media **non-DRM** (HTML5, HLS, DASH, file per-kualitas, stream
fragmen, dan tangkapan MSE) dari berbagai situs.

**Stack teknis:**
- **TypeScript + Vite** + `@crxjs/vite-plugin` (bundling MV3, output per-browser).
- **Preact + @preact/signals** untuk seluruh UI (popup, side panel, options, player).
- **webextension-polyfill** untuk API `browser.*` lintas-browser.
- **hls.js + dash.js** dibundel lokal (bukan CDN) untuk pemutaran.
- **i18n** runtime sendiri (6 bahasa) + **design tokens** (tema gelap/terang/sistem).

**Batas keras (disengaja):** konten **DRM/EME** (Widevine/FairPlay/PlayReady, HLS SAMPLE-AES,
DASH ContentProtection) ditandai `protected` dan **tidak diproses**. Blob MediaSource murni tanpa
sumber yang bisa diambil juga tidak dapat diunduh langsung.

---

## 2. Arsitektur: 4 Konteks Eksekusi

Ekstensi bekerja di empat konteks berbeda (inilah yang membedakannya dari userscript):

```
HALAMAN WEB (tab pengguna)
├─ ① MAIN world  — src/injected/hooks.ts
│     hook fetch / XHR (URL + isi body), MediaSource.appendBuffer (MSE capture),
│     EME (penjaga DRM), sniff manifest dari isi respons.
│     Kirim temuan ke bridge via window.postMessage.
│
└─ ② Content script (isolated) — src/content/index.ts
      jembatan page⇄background, pemindai DOM/atribut/script/teks,
      akumulasi buffer MSE, kirim kandidat ke background (kontrak §7).

③ BACKGROUND service worker — src/background/index.ts (OTAK)
      webRequest observer, klasifikasi, registry persisted, enrichment manifest,
      pengelompokan kualitas & fragmen, download engine, referer-spoof, router pesan.

④ OFFSCREEN document — src/offscreen/offscreen.ts (Chromium)
      DOMParser (DASH), crypto.subtle + Blob + createObjectURL untuk engine unduh
      tersegmentasi. (Firefox: dikerjakan langsung di background page.)

UI TERPISAH: side panel · popup · options · player (halaman ekstensi)
```

**Prinsip data penting yang sudah diterapkan:**
- State registry **persisted** ke `chrome.storage.session` → tidak hilang saat SW tidur.
- `webRequest` hanya memberi URL/header → manifest **di-fetch ulang** oleh background lalu di-parse.
- Hook MSE **wajib** di MAIN world (isolated tak bisa lihat objek halaman).
- DASH butuh `DOMParser` → offscreen (Chromium) / background page (Firefox).

---

## 3. Struktur Folder & Fungsi Tiap File

### `src/manifest.ts`
Generator manifest MV3 lintas-browser. Menghasilkan manifest berbeda per target:
- **Chromium:** `service_worker`, izin `offscreen` + `sidePanel`, kunci `side_panel`.
- **Firefox:** `background.scripts`, `sidebar_action`, `browser_specific_settings.gecko`.
- Izin bersama: `storage, downloads, notifications, contextMenus, webRequest,
  declarativeNetRequest, scripting, tabs`, `host_permissions: <all_urls>`.
- Dua content script: isolated (`content/index.ts`) + **MAIN world** (`injected/hooks.ts`), keduanya
  `all_frames: true`, `document_start`.

### `src/platform/`
- **browser.ts** — ekspor `browser` (webextension-polyfill) sebagai lapisan lintas-browser.

### `src/shared/`
- **types.ts** — tipe domain: `MediaItem`, `MediaKind` (`file|hls|dash|mse|fragmented|unknown`),
  `QualityVariant`, `Track`, `DownloadProgress`.
- **contract.ts** — **kontrak pesan §7** (satu sumber kebenaran semua pesan antar-konteks).
- **messaging.ts** — pengirim tipe-aman: `sendUi`, `sendBridge`, `broadcast`.
- **store.ts** — persistensi via `chrome.storage`: `Settings`, favorites, history (`getSettings`,
  `saveSettings`, `getFavorites`, `toggleFavorite`, `getHistory`, `pushHistory`).

### `src/core/` (logika murni, netral-browser)
- **url-utils.ts** — normalisasi/identitas URL, `stableVideoId`, penyaring segmen
  (`isSegmentUrl`, `isListableMediaUrl`), hint HLS/DASH, `MEDIA_URL_REGEX`.
- **media-utils.ts** — `mediaKind`, `mediaDisplayName`, `mediaOrigin`, `mediaQualityLabel`,
  `formatDuration`, `buildDownloadFilename`, `buildFfmpegCommand`, dan **`mediaRelevanceScore`**
  (ranking "video utama").
- **quality.ts** — skor & pemilihan varian kualitas (`pickBestQualityVariant`, dll.).
- **hls-parser.ts** — parse HLS (master/media): variants, audio, subtitle, deteksi enkripsi.
- **hls-plan.ts** — parse **media playlist** jadi rencana unduh: segmen, key/IV, EXT-X-MAP,
  byterange, container, live.
- **dash-parser.ts** — parse MPD ringkas (variants/audio/subtitle/ContentProtection) untuk deteksi.
- **dash-plan.ts** — parse MPD lengkap untuk unduh: SegmentTemplate/Timeline/List, video+audio
  terpisah, multi-period/live.
- **segment-crypto.ts** — dekripsi **AES-128 (AES-CBC)**: `sequenceIv`, `parseIv`, `decryptSegment`.
- **segment-downloader.ts** — engine unduh tersegmentasi: worker paralel, retry backoff, rakit Blob
  (fetchBuffer disuntik → netral konteks).
- **segmented-runner.ts** — orkestrator: master→varian terbaik, penjaga protected/live/multi-period
  (→ ffmpeg), unduh video + audio terpisah + petunjuk mux.
- **media-registry.ts** — `MediaRegistry` **persisted** (write-through `storage.session` +
  rehydrate-merge).

### `src/background/` (service worker)
- **index.ts** — entry OTAK: rangkai router, offscreen, net-sniffer; `registerAndEnrich`
  (upsert + badge + broadcast + referer + probe ukuran + enrichment); pembersihan registry saat
  navigasi tab.
- **router.ts** — router kontrak §7 tunggal (top-level, sinkron). Menangani semua pesan UI/bridge;
  diagnostik disimpan di `storage.session`.
- **net-sniffer.ts** — `webRequest.onHeadersReceived`: klasifikasi media (buang segmen dari daftar,
  rutekan ke pengelompok fragmen).
- **enricher.ts** — background **fetch manifest sendiri** (bebas CORS, `credentials:'include'`) lalu
  parse HLS (SW) / DASH (offscreen/bg) → variants.
- **quality-grouper.ts** — gabungkan file **per-kualitas** (`_720m.mp4`, `_480m.mp4`, `/1080/…`)
  jadi satu entri multi-resolusi.
- **fragment-grouper.ts** — kelompokkan **segmen/fragmen** (`.ts`, `range=`, googlevideo) per stream
  induk (host+template+itag) → entri `fragmented` yang bisa dirakit.
- **download-manager.ts** — unduhan file via `chrome.downloads` (resume native), progress polling,
  **antrean persisted** (`storage.local`), retry, revoke blob URL.
- **segmented.ts** — `downloadMedia(media)`: putuskan direct vs segmented vs fragmen vs MSE;
  orkestrasi via offscreen (Chromium) / background (Firefox).
- **offscreen-manager.ts** — kelola offscreen document (Chromium), `parseDashViaOffscreen`,
  `isOffscreenAvailable`, ping.
- **referer-spoof.ts** — `ensureRefererRule` (declarativeNetRequest set Referer situs untuk host
  media → lolos hotlink protection) + `probeSize` (ambil ukuran via ranged GET sebelum play).

### `src/offscreen/`
- **offscreen.html / offscreen.ts** — konteks ke-4 (Chromium): balas PING, `PARSE_DASH`,
  `RUN_SEGMENTED`, `RUN_FRAGMENTS`, `REVOKE_BLOBS`. Punya DOMParser/crypto/Blob/createObjectURL.

### `src/content/`
- **index.ts** — bridge: pindai DOM/atribut/script/teks, relay hook MAIN-world, kirim
  `MEDIA_CANDIDATE`, tangani `FINALIZE_MSE`.
- **dom-scanner.ts** — `scanVideos` (+trek), `scanDomForMedia`, `scanAttributes` (data-setup dll.),
  `scanScripts`, `scanPageText`, `observeDom` (MutationObserver).
- **detect.ts** — `classifyFromUrl`, `toMediaItem`.
- **mse-capture.ts** — akumulasi potongan `appendBuffer` per SourceBuffer, daftarkan entri capture,
  `mseFinalize` (rakit Blob → unduh lewat anchor di content).

### `src/injected/`
- **hooks.ts** — berjalan di MAIN world: hook `fetch`/`XHR` (URL + **sniff isi body** untuk URL &
  manifest), hook `MediaSource.addSourceBuffer`/`appendBuffer` (capture), hook EME (penjaga DRM).

### `src/i18n/`
- **index.ts** — engine i18n reaktif (signals): `t()`, `setLocale`, deteksi otomatis, dukungan RTL.
- **locales/** — `id, en, es, ar (RTL), ja, zh` (6 bahasa).

### `src/ui/`
- **theme/tokens.css** — design tokens (warna/spasi/radius) + tema gelap/terang/sistem.
- **theme/theme.ts** — store tema reaktif (`system|light|dark`).
- **components/** — `Icon` (set SVG feather), `LanguageSwitcher`, `ThemeSwitcher`.
- **sidepanel/** (`SidePanel.tsx`, `panel.html`, `panel.css`, `main.tsx`) — **UI utama Media
  Library**: tab Media/Favorit/Riwayat/Unduhan, filter berhitung, sort, cari, kartu media, multi-
  select batch, badge "Utama".
- **popup/** — ringkasan cepat tab aktif + tombol buka side panel.
- **options/** — pengaturan (tema, bahasa, auto-load HLS, dll.).
- **player/** (`Player.tsx`, dll.) — player kustom: HTML5 native + hls.js + dash.js, **pemilih
  kualitas** (level hls.js atau varian mp4), kecepatan, subtitle, **PiP**.

---

## 4. Fitur yang Berjalan

### 4.1 Deteksi media (berlapis, termasuk sebelum play)
Sumber deteksi yang aktif:
1. **`webRequest`** (background) — semua request media di semua frame, dari header Content-Type.
2. **Hook fetch/XHR MAIN-world** — melaporkan URL request **dan memindai isi body respons**
   (JSON/konfigurasi/API) untuk URL media → **deteksi bekerja sebelum video diputar**.
3. **Sniff manifest dari isi** — respons diawali `#EXTM3U`/`<MPD` dilaporkan sebagai HLS/DASH
   **walau URL bertoken tanpa ekstensi**.
4. **Pemindai DOM** — elemen `<video>/<source>/<iframe>`, atribut `data-*` & `data-setup` (video.js),
   script inline, teks halaman; diperbarui via MutationObserver + interval.
5. **Hook MSE/EME** — deteksi stream berbasis blob & konten DRM.

Segmen (`.ts/.m4s/…`) **tidak** dimunculkan sebagai baris terpisah (agar daftar bersih), tetapi
**dikumpulkan** untuk stream fragmen.

### 4.2 Pengelompokan pintar
- **Kualitas per-file:** `video_720m.mp4` + `video_480m.mp4` → **satu entri** dengan varian
  `[480p, 720p, …]` (whitelist tinggi standar, menghindari salah-cocok ID acak).
- **Fragmen stream:** segmen dikelompokkan per stream induk (host + template + itag) → entri
  `fragmented` yang bisa dirakit; audio & video terpisah dipasangkan (mux via ffmpeg).

### 4.3 Ranking "video utama"
`mediaRelevanceScore` menaikkan manifest multi-resolusi & file besar ke atas (badge **"Utama"**),
menurunkan klip `preview/trailer/thumb` dan entri `blob` yang tak bisa dipakai langsung.

### 4.4 Enrichment manifest
Saat HLS/DASH terdeteksi, background **fetch manifest sendiri** (bebas CORS, kirim cookie) → parse →
isi `variants/audioTracks/subtitles/bestVariant/protected`. HLS di service worker; DASH di offscreen
(Chromium) atau langsung di background (Firefox).

### 4.5 Player
Halaman ekstensi (bebas CSP situs). Memutar:
- **File direct** (native), dengan **dropdown kualitas** menukar sumber mp4 per-kualitas.
- **HLS** via hls.js dengan **pemilih level** (adaptif).
- **DASH** via dash.js.
Plus kontrol kecepatan, subtitle (`<track>`), dan **Picture-in-Picture**.

### 4.6 Downloader
`downloadMedia` memilih strategi:
- **File langsung** → `chrome.downloads` (resume/pause native, progress real-time).
- **HLS/DASH tersegmentasi** → fetch semua segmen + **dekripsi AES-128** + rakit Blob → unduh
  (dijalankan di offscreen/bg). Audio & video terpisah → dua file + petunjuk ffmpeg mux.
- **Stream fragmen** → rakit dari segmen yang terkumpul.
- **Capture MSE** → rakit buffer di content → unduh.
- **Live/multi-period/protected** → dihentikan, diarahkan ke tombol **"Salin ffmpeg"**.
Antrean unduhan **persisted** (bertahan restart) + tab **Downloads** (progress/cancel/retry).

### 4.7 Hotlink protection (Referer spoof) + ukuran sebelum play
`declarativeNetRequest` menyisipkan **`Referer` situs** pada request extension ke host media →
player & unduh **lolos proteksi hotlink** (mengatasi player hitam / 403). `probeSize` mengambil
**ukuran file sebelum diputar** via ranged GET.

### 4.8 Penangkapan MSE (§8.2) dengan penjaga DRM (§8.3)
Hook `appendBuffer` menyalin potongan buffer non-DRM → diakumulasi di content per SourceBuffer →
bisa dirakit & diunduh. Jika EME terdeteksi, **buffer dibuang** (protected). Bersifat real-time
(file lengkap hanya bila video diputar sampai habis).

### 4.9 UI & pengalaman
- **Side panel** = Media Library utama (persisten lintas navigasi SPA): tab Media/Favorit/Riwayat/
  Unduhan, filter berhitung, sort (relevansi/terbaru/kualitas), pencarian, multi-select batch,
  kartu dengan badge jenis, origin, token metadata, chip varian, aksi Putar/Unduh/ffmpeg/Copy/Favorit.
- **Popup** = ringkasan cepat tab aktif + tombol buka panel.
- **Options** = pengaturan.
- **Tema** gelap/terang/sistem + **6 bahasa** (id/en/es/ar/ja/zh) dengan RTL, ganti tanpa reload.

---

## 5. Kontrak Pesan (§7)

Semua pesan berbentuk `{ type, payload }`. Nama tipe HURUF_BESAR = kontrak.

| Arah | Tipe utama |
|---|---|
| MAIN hook → bridge (postMessage) | `hello`, `fetch/xhr` (URL), `manifest`, `mse-open`, `mse-chunk`, `eme` |
| Bridge → background | `MEDIA_CANDIDATE`, `PING_CHAIN` |
| UI/player → background | `GET_MEDIA_LIST`, `GET_MEDIA`, `PLAY_MEDIA`, `DOWNLOAD_MEDIA`, `DOWNLOAD_CANCEL`, `DOWNLOAD_RETRY`, `GET_DOWNLOADS`, `COPY_FFMPEG`, `GET_SETTINGS`, `UPDATE_SETTINGS`, `TOGGLE_SITE`, `NOTIFY`, `GET_DIAGNOSTICS` |
| Background → UI (broadcast) | `MEDIA_LIST_UPDATED`, `DOWNLOAD_PROGRESS`, `DOWNLOAD_DONE`, `DOWNLOAD_ERROR`, `HELLO` |
| Background → offscreen | `OFFSCREEN_PING`, `PARSE_DASH`, `RUN_SEGMENTED`, `RUN_FRAGMENTS`, `REVOKE_BLOBS` |
| Background → content | `FINALIZE_MSE` |

---

## 6. Model Data `MediaItem`

```ts
{
  id, url, pageUrl, tabId, frameId,
  kind: 'file'|'hls'|'dash'|'mse'|'fragmented'|'unknown',
  contentType, sizeBytes, duration, title,
  segmentCount, fragmentType,          // untuk fragmented / capture
  protected, protectionType, encrypted,
  variants[], bestVariant,             // multi-resolusi
  audioTracks[], subtitles[], thumbnailTracks[],
  source: 'network'|'dom'|'page-hook'|'text-scan',
  firstSeen, lastSeen
}
```

---

## 7. Build & Menjalankan

```bash
npm install
npm run build            # build dist/chrome + dist/firefox
npm run dev              # Chromium, hot-reload
npm run dev:firefox      # Firefox
npm run typecheck        # tsc --noEmit
```

Muat unpacked:
- **Chromium:** `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- **Firefox:** `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`.

Buka Media Library: klik ikon UVPD → tombol panel (side panel), atau sidebar (Firefox).

---

## 8. Validasi (uji harness Node yang sudah lolos)

- **Parser HLS** — master/variant/audio/subtitle, resolusi URL relatif, SAMPLE-AES → protected.
- **Dekripsi AES-128** — round-trip enkripsi→dekripsi via engine tersegmentasi = byte cocok persis.
- **HLS media plan** — segmen/key/init/container/live terbaca benar.
- **Router kontrak §7** — `MEDIA_CANDIDATE`→registry, `GET_MEDIA_LIST`, `PLAY_MEDIA`,
  `DOWNLOAD_MEDIA` (item protected dilewati).
- **Registry persisted** — rehydrate entri setelah "restart".
- **Fragment grouping** — grup per itag, urutan sekuens benar, sibling audio, generik `.ts` bernomor.
- **MSE capture** — akumulasi berurutan + penjaga DRM (protected → tak menyimpan buffer).
- **Ekstraksi URL** — dari konfigurasi video.js (slash ter-escape) & API JSON.
- **Ranking** — manifest multi-res > file besar > preview > blob.
- **Quality grouping** — `_480m` + `_720m` → satu entri `[480p, 720p]`; ID acak tak salah cocok.

Semua diverifikasi lewat harness Node (bukan browser nyata).

---

## 9. Batasan Jujur (hal yang memang tidak bisa / belum teruji browser)

**Batas keras (tidak akan bisa, sesuai desain):**
- Konten **DRM/EME** (Widevine/FairPlay/PlayReady, SAMPLE-AES) — ditandai protected, tidak diproses.
- **Blob MediaSource** murni tanpa sumber yang bisa diambil — hanya bisa lewat capture MSE (real-time).

**Keterbatasan praktis:**
- **Capture MSE bersifat real-time** — file lengkap hanya jika video diputar sampai habis.
- **Reassembly fragmen** hanya mengunduh segmen yang **teramati** (parsial bila belum diputar penuh).
- **Unduhan tersegmentasi** dirakit di memori (tidak resume di tengah); unduhan **file langsung**
  resume otomatis via `chrome.downloads`.
- **Manifest via `application/octet-stream`** yang tak ikut dipindai bisa terlewat.
- Situs dengan **URL bertanda-tangan/token per-sesi** yang kadaluarsa: Referer spoof saja mungkin
  belum cukup.

**Belum diuji di browser sungguhan (baru lolos harness/build):** render UI nyata end-to-end,
DASH offscreen saat runtime, unduhan tersegmentasi/fragmen/MSE pada situs nyata, dan pemutaran
di berbagai situs. Perlu pengujian manual dengan Load unpacked.

---

*Dokumen ini mencerminkan kondisi kode saat penulisan. Semua modul di atas ada di repositori,
ter-typecheck, dan ter-build untuk kedua target.*
