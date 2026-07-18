# Blueprint — Halaman Download, Popup List & Dropdown In-Page

> Lanjutan dari `UI-FEATURE-BLUEPRINT.md`. Fokus: tiga permukaan utama yang masih hilang/mentah,
> mengacu userscript (Gambar 1 = target halaman Download; Gambar 2 = library kaya).
> **Strategi (arahan pemilik): selesaikan SEMUA sistem & fitur dulu, baru tampilan.**
> Kondisi nyata & aturan: lihat `CLAUDE.md`. Prinsip: tanpa menahan diri, hasil akhir terbaik.

---

## 0. Kondisi saat ini (terverifikasi di repo)
- Tombol **Unduh** kartu → `DOWNLOAD_MEDIA` = **unduh langsung, tanpa konfigurasi**. Tak ada entry downloader.
- **Popup** (`src/ui/popup/`) ada tapi list polos (belum pakai `MediaCard`).
- **Dropdown in-page**: tidak ada (UI in-page sudah dihapus).
- `DownloadsView` (Manager) = monitor antrean, **bukan** konfigurator.
- Tertunda dari fase lalu: `typecheck` belum bersih (6 error `@fontsource-variable/*`), U0–U4 belum diverifikasi runtime.

---

## 1. Tiga permukaan (definisi & target UX)

### A. Halaman Download (tab baru) — *jantung fitur yang hilang*
Alur "analyze-first" seperti script, tapi lebih baik:
1. URL terisi otomatis (dari kartu/player) atau manual → **Analyze source**.
2. Tampilkan **rencana**: jenis media, jumlah segmen, kualitas tersedia, batasan, keamanan.
3. Pengguna memilih: **kualitas** (terbaik pra-terpilih), **format/container output** (lihat §2 format matrix), **nama file** (default pintar dari judul), **opsi lanjutan** (strategi fast/resumable, paralel, retry, start segment).
4. Progress: ring + bar, completed/downloaded/speed/ETA, cancel, **activity log**, salin ffmpeg.
- **Dicapai dari:** tombol Unduh kartu (buka halaman **pre-filled**, bukan unduh langsung), "Buka URL" manual, dan dari player.
- **Lebih baik dari script:** matriks format dengan **ketersediaan nyata** (mp4/mkv/webm/audio), ETA, ingat preferensi, integrasi antrean resumable.

### B. Popup list (toolbar) — *permukaan cepat utama*
- Kaya tapi ringkas: jumlah temuan, mini-`MediaCard` (thumbnail, judul, badge jenis, kualitas terbaik), aksi cepat (Putar, **Unduh→buka Halaman Download**, Salin).
- Filter (Semua/Video/HLS/DASH) + pencarian. Tombol: buka side panel, buka Media Manager, pindai ulang.
- **Dropdown kualitas cepat** per item (unduh langsung kualitas X tanpa buka halaman, untuk power-user).

### C. Dropdown list in-page (floating, injected) — *akses tercepat*
- **Floating button** (seperti script) di halaman → **dropdown** daftar media yang terdeteksi di halaman itu.
- Aksi cepat per item (Putar/Unduh/Salin), badge jumlah di tombol, update live saat deteksi.
- **Wajib Shadow DOM** (isolasi CSS dari situs). Hormati per-site disable. Bisa digeser & ditutup.
- *(Interpretasi "dropdown list" = quick-list in-page. Bila yang dimaksud lain, penyesuaian kecil.)*

---

## 2. Sistem yang harus dibangun (BAGIAN 1 — dulu)

### 2.1 Sistem Halaman Download
- **Analyze service** (background): perluas `hls-plan`/`dash-plan` + baru `download-plan.ts` yang menghitung: jenis, varian kualitas, **format output yang tersedia**, jumlah item, batasan, status protected.
- **Entry baru** `src/ui/downloader/` (`downloader.html`) — daftarkan di `manifest.ts`/vite.
- **Kontrak pesan** (tambah di `src/shared/contract.ts`):
  - `ANALYZE_SOURCE { url } → SourcePlan`
  - `OPEN_DOWNLOADER { mediaId? , url? }` (buka tab downloader pre-filled)
  - Perluas `DOWNLOAD_MEDIA` → `{ id, quality?, container?, filename?, strategy? }`
- **Wiring:** tombol Unduh kartu → `OPEN_DOWNLOADER` (bukan `DOWNLOAD_MEDIA` langsung), kecuali "quick-download" eksplisit.

### 2.2 Sistem Export Format (ffmpeg.wasm) — *(= U5 lama, diserap ke sini)*
- Integrasi `@ffmpeg/ffmpeg` (wasm) di **offscreen**, dimuat **lazy/on-demand**.
- **Format matrix** nyata: MP4 (remux), MKV, WebM, audio-only (M4A/MP3), "asli/original".
- Untuk audio+video DASH terpisah → **mux** jadi satu file. HLS/TS → MP4. Fallback: ekspor perintah ffmpeg (sudah ada) bila sumber tak layak dirakit in-browser (live/multi-period).
- DRM tetap **tak disentuh**.

### 2.3 Sistem Popup & Dropdown
- **Popup:** wiring aksi penuh (Putar/Unduh→`OPEN_DOWNLOADER`/Salin/buka panel/manager), filter, quick-quality dropdown. (Data sudah ada via `GET_MEDIA_LIST`.)
- **Dropdown in-page:** kembalikan **content-script UI** via **Shadow DOM host** — floating button + panel list; bridge pesan (list live dari registry broadcast, aksi ke background). Hormati `disabledHosts`.

---

## 3. Tampilan (BAGIAN 2 — setelah semua sistem beres)
Terapkan design system "ruang sinyal" (UI-FEATURE-BLUEPRINT §4) ke ketiga surface:
- **Halaman Download**: layout seperti Gambar 1 tapi lebih rapi — header status, kartu Source/Save-as, panel Source analysis (dengan chip kualitas + matriks format + batasan), panel Download (ring progress, metrik, activity log). Monospace untuk URL/bytes/kecepatan; warna semantik per jenis.
- **Popup**: mini-`MediaCard` konsisten, padat, cepat; ≤ ~400px lebar.
- **Dropdown in-page**: kartu ringkas melayang, glass, badge jumlah, animasi masuk halus.
- Konsistensi lintas surface (side panel, manager, popup, dropdown, downloader) — komponen dipakai ulang.

---

## 4. Milestone (sistem dulu → tampilan)

> Melanjutkan track U. U5(ffmpeg)→**M2**, U6(perf/packaging)→**M7**. Tiap milestone: build hijau,
> `tsc` bersih, dan **diuji Load unpacked di situs nyata** sebelum lanjut. UI di fase sistem cukup
> **fungsional minimal** (belum cantik) — keindahan ditunda ke M5–M7.

### BAGIAN 1 — SISTEM & FITUR
- **M1 — Sistem Halaman Download.** `download-plan.ts` + `ANALYZE_SOURCE`/`OPEN_DOWNLOADER` + entry `downloader.html` + eksekusi via jalur direct/resumable/segmented + wiring tombol Unduh kartu → buka downloader pre-filled. *UI fungsional minimal.*
  ✅ *Lulus:* klik Unduh membuka halaman downloader terisi; Analyze menampilkan rencana benar; unduh berjalan dari halaman ini; teruji runtime.
- **M2 — Sistem Export Format (ffmpeg.wasm).** Remux/transcode ke mp4/mkv/webm/audio, on-demand di offscreen; format matrix jadi nyata; mux audio+video DASH.
  ✅ *Lulus:* pilih format → file output valid & bisa diputar; WASM hanya dimuat saat dipakai; DRM tetap ditolak.
- **M3 — Sistem Popup & Dropdown.** Popup: aksi penuh + filter + quick-quality. Dropdown in-page: Shadow DOM host + floating button + list live + aksi + per-site disable. *UI fungsional minimal.*
  ✅ *Lulus:* popup & dropdown menampilkan media tab aktif dan aksinya bekerja (Unduh membuka downloader); teruji runtime di situs nyata.
- **M4 — Perbaikan tertunda + verifikasi menyeluruh.** Shim `.d.ts` untuk `@fontsource-variable/*` (typecheck bersih); pastikan tak ada "unduh langsung tanpa konfigurasi" yang tak disengaja; **verifikasi runtime U0–U4 + M1–M3** di 3–4 situs non-DRM (bukti konkret, termasuk resume unduhan setelah putus).
  ✅ *Lulus:* `tsc` bersih; checklist runtime hijau dengan bukti.

### BAGIAN 2 — TAMPILAN
- **M5 — UI Halaman Download** (mengacu Gambar 1, lebih baik).
  ✅ *Lulus:* halaman tampak profesional & jelas; matriks format + kualitas + filename + advanced + progress lengkap; konsisten "ruang sinyal".
- **M6 — UI Popup list (utama) + UI Dropdown in-page.**
  ✅ *Lulus:* popup & dropdown tampak seperti kelas satu, reuse `MediaCard`; aksi mulus; a11y + reduced-motion.
- **M7 — Poles lintas-surface + performa/packaging** (= U6).
  ✅ *Lulus:* konsistensi visual semua surface; Definition of Done (UI-FEATURE-BLUEPRINT §7) hijau; bundle di-split; ter-package.

---

## 5. Guardrail (tetap)
DRM tak disentuh (protected → stop). Privacy-first (redaksi token). Verifikasi sebelum klaim.
Hormati 4-konteks (Shadow DOM untuk dropdown, ffmpeg.wasm di offscreen). Perluas kontrak `src/shared/contract.ts`, jangan bikin protokol paralel. Evolusi, bukan revolusi.
