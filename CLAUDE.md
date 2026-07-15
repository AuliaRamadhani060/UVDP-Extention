# CLAUDE.md — Konteks Proyek UVPD Extension

> File ini otomatis dibaca Claude Code tiap sesi. Isinya: apa proyek ini, **kondisi sebenarnya
> (hasil audit, bukan klaim)**, aturan keras, arsitektur, stack, dan cara bekerja. Baca penuh
> sebelum menyentuh kode.

## Apa ini
Ekstensi browser Manifest V3 untuk **mendeteksi, memutar, dan mengunduh media non-DRM** di situs
mana pun — port & upgrade dari userscript "UVPD v0.6.1". Tujuan: menyamai **lalu melampaui**
userscript untuk konten non-DRM, dengan UI kelas-atas.

## 📚 Baca dulu (urutan ini)
1. `docs/UVPD_Extension_Blueprint.md` — **arsitektur backend** (4 konteks, kontrak pesan, jebakan MV3). Sudah final & repo dibangun mengikutinya.
2. `docs/UI-FEATURE-BLUEPRINT.md` — **spesifikasi UI, fitur, & stack baru** (dokumen kerja utama untuk fase sekarang).
3. `docs/UVPD_Tujuan_Akhir.md` — visi & definisi "berhasil".
4. `src/shared/types.ts` & `src/shared/contract.ts` — **sumber kebenaran** tipe domain & protokol pesan. Jangan bikin tipe tandingan; extend yang ada.

---

## ⚠️ Kondisi SEBENARNYA (audit kode, per repo saat ini)

**JANGAN percaya `DOKUMENTASI.md` begitu saja.** Audit menemukan klaimnya menyesatkan. Fakta:

### Sudah benar di kode (tapi ⏳ BELUM diverifikasi di browser nyata)
- `tsc --noEmit` bersih; build sukses (Chrome + Firefox).
- Deteksi jaringan: `src/background/net-sniffer.ts` (`webRequest`, semua frame/SW/xorigin). **Kuat.**
- Persistensi SPA: `src/core/media-registry.ts` (write-through `storage.session` + rehydrate).
- Penyusunan ulang fragmen per-itag: `src/background/fragment-grouper.ts`.
- Capture MSE + penjaga DRM: `src/injected/hooks.ts` (hook `appendBuffer` + `requestMediaKeySystemAccess`).
- Dekripsi **AES-128 (AES-CBC)**: `src/core/segment-crypto.ts` (`crypto.subtle`). Parser HLS/DASH: `src/core/{hls,dash}-{parser,plan}.ts`.
- Unduh direct: `src/background/download-manager.ts` (`chrome.downloads`, antrean persisted `storage.local`).
- Ekspor ffmpeg, redaksi token (`url-utils.ts` `VOLATILE_QUERY`), per-site disable, i18n 6 bahasa, Options page.

### 🔴 STUB / RUSAK / HILANG — ini pekerjaan nyata
- **Resumable IndexedDB = STUB.** `DOWNLOAD_MEDIA.strategy: 'resumable'` ada di `contract.ts` tapi **tak pernah diimplementasi**; tak ada IndexedDB. → **Port dari userscript** (`Universal_..._More.js`, cari `indexedDB.open` ~baris 6224+).
- **Player = `<video controls>` polos** (`src/ui/player/Player.tsx`, `player.css` 15 baris). Tak ada scrubber kustom, hover-preview, hotkey, pilih audio track, fit/fill. → Rebuild (lihat UI blueprint).
- **Bug kualitas default**: Player memuat `video.src = media.url`, **bukan** `media.bestVariant.url`; HLS `new Hls()` tanpa `startLevel` → ABR mulai rendah. → Perbaiki: muat `bestVariant`, set start level tertinggi.
- **List UI**: tanpa thumbnail, tanpa tombol refresh manual. → Rebuild.
- **Options tipis** (±5 setting) vs userscript (±20). → Perkaya.
- **NOL TEST.** Klaim "8 validasi harness Node" di dokumentasi **palsu** — tak ada file test di repo. Jangan ulangi kebohongan ini; kalau menambah test, buat yang nyata.

### Belum diverifikasi sama sekali
Tidak ada satu pun jalur yang pernah dijalankan via **Load unpacked** di situs nyata. Semua "sudah benar" di atas = benar secara kode, belum terbukti runtime.

---

## 🚫 Aturan keras (non-negotiable)

1. **DRM tak pernah disentuh.** Jika stream membawa sinyal proteksi (EME / `encrypted` / `ContentProtection` non-clear / HLS `SAMPLE-AES` / keyformat non-identity) → set `protected=true`, **hentikan pemrosesan**, jangan simpan buffer. Ini garis prinsip, bukan keterbatasan.
2. **Privacy-first.** Redaksi token/signature (`VOLATILE_QUERY`) dipertahankan & diperluas. Observasi jaringan **tak pernah** dieksfiltrasi ke mana pun.
3. **Verifikasi sebelum klaim.** Jangan tulis "berjalan"/"berfungsi"/"tervalidasi" untuk apa pun yang belum diuji di browser nyata. Gunakan bahasa jujur ("diimplementasi, belum diuji runtime").
4. **Jangan buat test palsu / klaim validasi kosong.** Test harus benar-benar mengeksekusi kode.
5. **Hormati model 4-konteks.** Kode harus di konteks yang benar (lihat blueprint §3). Kegagalan port hampir selalu = kode di konteks salah. Ingat: SW ephemeral (state ke storage), hook MSE wajib MAIN world, `DOMParser` tak ada di SW (pakai offscreen), `webRequest` tak beri body (re-fetch manifest).
6. **Evolusi, bukan revolusi.** ~80% core (`src/core/*`, `src/background/*` engine, `src/injected/*`) sudah matang & framework-agnostik — **pakai ulang**, jangan tulis ulang. Yang di-rebuild hanya lapisan UI + resumable downloader.
7. **Bangun bertahap.** Satu milestone per waktu (lihat UI blueprint §Milestone). Jangan generate semuanya sekaligus.

---

## 🏗️ Arsitektur (ringkas — detail di `docs/UVPD_Extension_Blueprint.md`)

Empat konteks eksekusi:
- **① MAIN world** (`src/injected/hooks.ts`) — hook `fetch`/`XHR`/`MediaSource.appendBuffer` + penjaga EME.
- **② Content bridge** (`src/content/`) — jembatan page⇄background, scan DOM/Shadow DOM.
- **③ Background SW** (`src/background/`) — otak: `webRequest`, registry, router, engine unduh, parser HLS, AES, IndexedDB.
- **④ Offscreen** (`src/offscreen/`) — `DOMParser` untuk DASH & tugas berat.

State hidup **hanya** di `chrome.storage`/IndexedDB (SW bisa mati kapan saja). Manifest di-generate dari `src/manifest.ts`.

---

## 🧰 Stack

**Sekarang:** Preact + Vite + TypeScript + CSS (tokens.css).
**Target (arahan pemilik — utamakan fitur/UI, performa dituning nanti):** migrasi ke
**React 18 + Vite + CRXJS + Tailwind + shadcn/ui + Framer Motion + Vidstack (player) + ffmpeg.wasm +
cmdk + Zustand + TanStack Virtual + dnd-kit + sonner + lucide-react + Tremor/Recharts.**
Detail & urutan migrasi: `docs/UI-FEATURE-BLUEPRINT.md §Stack`. **Core `src/core|background|injected|content`
tidak bergantung Preact → port apa adanya.**

## 🗂️ Peta repo
```
src/
  shared/     types.ts · contract.ts · messaging.ts · store.ts   ← SUMBER KEBENARAN
  injected/   hooks.ts                                            ← ① MAIN world
  content/    index.ts · detect.ts · dom-scanner.ts · mse-capture.ts  ← ② bridge
  background/ index.ts · net-sniffer.ts · router.ts · download-manager.ts
              segmented.ts · fragment-grouper.ts · quality-grouper.ts
              enricher.ts · referer-spoof.ts · offscreen-manager.ts   ← ③ otak
  offscreen/  offscreen.ts/html                                   ← ④ DOMParser
  core/       hls-parser · hls-plan · dash-parser · dash-plan
              segment-crypto (AES) · segment-downloader · segmented-runner
              media-registry · media-utils · quality · url-utils   ← engine (REUSE)
  platform/   browser.ts (abstraksi chrome/firefox)
  i18n/       index.ts + locales/{en,id,es,ja,zh,ar}.json
  ui/         sidepanel/ · player/ · popup/ · options/ · theme/ · components/
  manifest.ts
```

## 📇 Data & pesan (jangan bikin tandingan)
Tipe inti di `src/shared/types.ts`: `MediaItem`, `QualityVariant`, `Track`, `DownloadProgress`,
`MediaKind = 'file'|'hls'|'dash'|'mse'|'fragmented'|'unknown'`.
Kontrak pesan di `src/shared/contract.ts`: `HookMessage` (①→②), `BridgeMessage` (②→③),
`UiMessage` (UI→③, mis. `GET_MEDIA_LIST`, `DOWNLOAD_MEDIA`, `GET_DOWNLOADS`).
Perluas union yang ada; jangan bikin protokol paralel.

## ⚙️ Perintah
```bash
npm install
npm run build        # → dist/chrome & dist/firefox (verifikasi ini tetap hijau tiap perubahan)
npx tsc --noEmit     # wajib bersih sebelum selesai
# Uji nyata: Load unpacked dist/chrome di chrome://extensions
```

## ✍️ Konvensi
- **TypeScript strict.** `tsc --noEmit` harus bersih sebelum menyatakan selesai.
- **i18n:** teks UI lewat `src/i18n` (6 locale). Jangan hardcode string tampilan; tambah key ke semua locale.
- **Tema:** warna via CSS variables/token (lihat UI blueprint §Design). Jangan hardcode hex di komponen.
- **A11y:** fokus keyboard terlihat, `prefers-reduced-motion` dihormati, komponen interaktif punya peran/label.
- **Komit kecil & terarah** per milestone; jangan campur refactor besar dengan fitur.
