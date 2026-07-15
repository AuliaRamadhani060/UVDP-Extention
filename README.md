# UVPD — Universal Video Player & Downloader (Extension)

Migrasi userscript UVPD 0.6.1 menjadi extension resmi Manifest V3, lintas-browser
(Chrome / Edge / Brave / Opera / Firefox), dengan mesin deteksi yang jauh lebih kuat.

## Batas kemampuan (penting)

- **Bukan** alat pembobol DRM. Konten Widevine/FairPlay/PlayReady (EME) terdeteksi,
  ditandai `protected`, dan **tidak** diproses/diunduh.
- Unduhan hanya untuk media yang tidak dilindungi. Batasan ini disengaja demi
  kepatuhan hukum & kebijakan toko extension.

## Arsitektur

Tiga konteks eksekusi:

| Konteks | Folder | Tugas |
|---|---|---|
| Background (service worker) | `src/background` | Sniffing jaringan (`webRequest`), fetch cross-origin, download, storage, routing pesan |
| Content script (isolated) | `src/content` | Pemindai DOM, UI panel (Shadow DOM), relay hook |
| Injected (MAIN world) | `src/injected` | Hook `fetch`/`XHR`/`MediaSource`/`EME` halaman |

Logika netral-browser (parser, registry, util) ada di `src/core`.
Abstraksi lintas-browser & pengganti API `GM_*` ada di `src/platform`.

## Deteksi berlapis (peningkatan atas userscript)

1. `webRequest.onHeadersReceived` — tangkap media dari header di semua frame/worker.
2. Hook `fetch`/`XHR` MAIN-world — URL playlist/segmen yang di-fetch aplikasi.
3. Hook `MediaSource.addSourceBuffer` — stream `blob:`/MSE.
4. Hook EME — tandai konten ber-DRM.
5. DOM scanner + MutationObserver — media tertanam di atribut.

Semua bermuara di `MediaRegistry` dengan dedup identitas kanonik.

## Peta pengganti API GM

Lihat `src/platform/gm-compat.ts`. Ringkas:
`GM_xmlhttpRequest`→fetch(background), `GM_download`→`chrome.downloads`,
`GM_setValue/getValue`→`chrome.storage`, `GM_notification`→`chrome.notifications`,
`GM_setClipboard`→Clipboard API, `GM_registerMenuCommand`→`chrome.contextMenus`.

## Pengembangan

```bash
npm install
npm run dev              # Chromium, hot-reload
npm run dev:firefox      # Firefox
npm run build            # build kedua target ke dist/
npm run typecheck
```

Muat unpacked:
- Chromium: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`
- Firefox: `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`

## Stack UI

- **Preact + @preact/signals** — komponen reaktif ringan (~5KB) untuk popup/options/panel/player.
- **i18n reaktif** (`src/i18n`) — ganti bahasa tanpa reload, deteksi otomatis, dukungan RTL.
  Bahasa saat ini: id, en, es, ar (RTL), ja, zh. Tambah bahasa = 1 file JSON + 1 baris di `LOCALES`.
- **Design tokens** (`src/ui/theme/tokens.css`) — tema gelap/terang/sistem, warna & spasi konsisten.

## Roadmap fitur

**Fase 1 — Fondasi UI & i18n** ✅ (Preact, signals, i18n 6 bahasa, design tokens).

**Fase 2 — Downloader universal** ✅
- Parser HLS (master/media, variants, audio, subtitle, deteksi EXT-X-KEY) — `src/core/hls-parser.ts`
- Parser DASH (variants, audio, subtitle, ContentProtection) — `src/core/dash-parser.ts`
- Unduhan file langsung via `chrome.downloads` **native** (pause/resume bawaan browser) + progress real-time
- Stream HLS/DASH → perintah ffmpeg ke clipboard (paritas userscript)
- Batch download (multi-select) di panel

**Fase 3 — Player universal** ✅
- Tab player: HTML5 native + **hls.js & dash.js dibundel lokal** (lazy-load) — `src/ui/player`
- Kontrol kecepatan & pemilihan varian kualitas

**Fase 4 — Panel & pengalaman** ✅
- Panel in-page (Preact di Shadow DOM): filter (kind), sort (baru/kualitas), pencarian, multi-select, favorites, history, progress unduhan

**Berikutnya (fitur baru, di luar paritas):**
- [ ] Ikon PNG asli di `public/icons` (kini placeholder)
- [ ] Unduhan HLS/DASH tersegmentasi in-browser (via offscreen document) tanpa ffmpeg
- [ ] Subtitle/PiP di player, per-site enable/disable UI, ekspor/impor pengaturan

## Catatan arsitektur penting

- **DOMParser tidak ada di service worker MV3** → parsing manifest DASH (dan HLS) dilakukan di content script; teks manifest diambil background (bebas CORS). Alurnya: net-sniffer (background) mendeteksi → minta content script fetch+parse → hasil dikirim balik ke registry.
- **createObjectURL tidak ada di service worker** → unduhan file langsung memakai `chrome.downloads` native (lebih andal dari chunking manual userscript; resume lintas-reload otomatis).
- Setiap frame punya content script yang bisa `sendMessage` ke background langsung → tidak perlu "frame bridge" postMessage seperti userscript.
