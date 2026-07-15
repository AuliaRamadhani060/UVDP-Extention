# UVPD Extension — Rancangan Kerangka Dasar

Migrasi dari userscript `Universal Video Player & Downloader (UVPD) v0.6.1` menjadi
browser extension resmi (Manifest V3), dengan mesin deteksi video yang jauh lebih kuat.

---

## 1. Kenapa extension jauh lebih kuat daripada userscript

Userscript hanya bisa "mengintip" dari dalam halaman. Extension punya akses level browser.
Kemampuan baru yang tidak mungkin dilakukan userscript:

| Kemampuan | Userscript | Extension (MV3) |
|---|---|---|
| Lihat semua request network (semua frame, worker, service worker, CDN segmen) | ❌ hanya hook fetch/XHR di main frame | ✅ `chrome.webRequest` |
| Deteksi di iframe cross-origin | ❌ terblokir | ✅ content script `all_frames: true` |
| Video `blob:` (MSE) | ❌ sebagian | ✅ hook `MediaSource` di MAIN world via `chrome.scripting` |
| Download native (progress, pause, resume, folder) | ❌ GM_download terbatas | ✅ `chrome.downloads` |
| Fetch cross-origin tanpa CORS | ⚠️ GM_xmlhttpRequest | ✅ `host_permissions` |
| Ubah header (Referer/Origin untuk media hotlink-protected) | ❌ | ✅ `declarativeNetRequest` |
| Penyimpanan besar untuk merakit segmen HLS/DASH | ❌ | ✅ OPFS + `unlimitedStorage` |
| Player bebas CSP situs | ⚠️ | ✅ halaman extension sendiri |

## 2. Target platform & catatan kebijakan store

- **Basis: Chrome Manifest V3** — juga jalan di Edge, Brave, Opera.
- **Firefox**: pakai `webextension-polyfill`; perbedaan API kecil, ditangani lewat satu adapter.
- ⚠️ **Kebijakan Chrome Web Store**: extension pengunduh video **dilarang mengunduh dari YouTube**
  (dan umumnya ditolak jika memfasilitasi pelanggaran hak cipta). Wajib ada blocklist YouTube
  bawaan agar lolos review. Firefox AMO lebih longgar tetapi tetap melarang bypass DRM.
- **Batas tegas (dipertahankan dari userscript)**: konten DRM (Widevine/FairPlay/PlayReady/EME)
  hanya **dideteksi dan diberi label "Protected"**, tidak pernah dibypass. Ini syarat mutlak
  diterima di store sekaligus batas legal.

## 3. Tooling

- **WXT** (framework build extension, aktif dikembangkan) + **TypeScript** + **Vite** di dalamnya.
  Alternatif: plain Vite + @crxjs/vite-plugin (kurang terawat) atau tanpa bundler (menyulitkan
  pemecahan file 7.500 baris menjadi modul).
- **Vitest** untuk unit test modul murni (parser HLS/DASH, dedup, scoring kualitas).
- Library yang di-bundle (bukan CDN — CDN dilarang di MV3): `hls.js`, `dashjs`, `mux.js`/`mp4box.js`.

## 4. Struktur proyek

```
uvpd-extension/
├─ wxt.config.ts
├─ package.json
├─ public/icons/
└─ src/
   ├─ entrypoints/
   │  ├─ background.ts          # service worker: sniffer network, registry, download engine
   │  ├─ content.ts             # ISOLATED world: DOM scanner, MutationObserver, jembatan pesan
   │  ├─ main-world.content.ts  # MAIN world: hook fetch/XHR/MSE/attachShadow/EME
   │  ├─ popup/                 # daftar media tab aktif + aksi cepat
   │  ├─ player/                # halaman player (hls.js/dash.js), pengganti "player tab builder"
   │  └─ options/               # pengaturan (porting settings userscript)
   ├─ core/                     # ← porting logika murni dari userscript, bisa di-unit-test
   │  ├─ hls-parser.ts
   │  ├─ dash-parser.ts
   │  ├─ media-identity.ts      # canonicalMediaIdentity, stableVideoId, dedup
   │  ├─ quality.ts             # scoreQualityVariant, pickBestQualityVariant
   │  └─ url-heuristics.ts      # hasHlsHint, isVideoLike, scanTextForVideoUrls, dll.
   ├─ background/
   │  ├─ network-sniffer.ts     # webRequest listeners (Layer A)
   │  ├─ media-registry.ts      # Map per-tabId, badge count, korelasi antar-layer
   │  └─ download/              # queue, segment fetcher, muxer, resume via OPFS
   └─ shared/
      ├─ messages.ts            # protokol pesan typed (content ⇄ background ⇄ pages)
      └─ types.ts               # VideoMeta, Variant, DownloadSession, Settings
```

## 5. Mesin deteksi berlapis — inti dari "mendeteksi seluruh video"

Lima layer independen yang semuanya melapor ke `media-registry` di background,
lalu dideduplikasi dengan `canonicalMediaIdentity`:

**Layer A — Network sniffer (BARU, terkuat)** — `chrome.webRequest.onHeadersReceived`:
cocokkan `content-type` (video/*, mpegurl, dash+xml) dan ekstensi URL (.m3u8, .mpd, .mp4, .m4s,
.ts, .webm, ...). Menangkap request dari **semua** frame, worker, dan player yang di-obfuscate —
mayoritas kasus yang selama ini lolos dari userscript selesai di layer ini.

**Layer B — DOM scanner** (porting + perluasan): `video/source/iframe/data-*` +
MutationObserver; ditambah **shadow DOM** (termasuk closed root via hook `attachShadow`
di MAIN world) dan **semua iframe** (`all_frames: true`, `match_about_blank: true`).

**Layer C — Runtime hooks di MAIN world**: porting hook fetch/XHR; ditambah hook
`MediaSource`/`SourceBuffer.appendBuffer` + `URL.createObjectURL` untuk membongkar video
`blob:` (menangkap init segment + media segment → bisa diputar/diunduh), dan hook EME
(`requestMediaKeySystemAccess`) untuk menandai konten DRM sebagai Protected.

**Layer D — Text/config mining**: porting regex scanner; ditambah parsing config player
populer (JW Player, Video.js, Plyr, Shaka), meta `og:video`, dan JSON-LD `VideoObject`.

**Layer E — Site adapters (bertahap)**: plugin per-situs untuk kasus khusus
(endpoint API, token), arsitektur mirip extractor yt-dlp. Opsional, ditambah sesuai kebutuhan.

## 6. Player & Download engine

- **Player**: halaman extension (`player/`) → tidak tunduk CSP situs, hls.js + dash.js bundled.
  Terima `videoId` via query param, ambil metadata dari background.
- **Direct download**: `chrome.downloads.download()` — progress & resume gratis dari browser.
- **HLS/DASH download**: segment fetcher di background (paralel, retry), tulis ke **OPFS**,
  mux TS→MP4 dengan `mux.js`/`mp4box.js`. `ffmpeg.wasm` opsional untuk kasus sulit
  (lazy-load, ~30 MB). Resume antar-sesi: porting mekanisme chunk-resume 