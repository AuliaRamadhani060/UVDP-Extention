# UVPD — Blueprint UI, Fitur & Stack (dokumen kerja)

> **Cakupan dokumen ini:** lapisan UI, katalog fitur, dan migrasi stack.
> **Bukan cakupan:** arsitektur backend 4-konteks & kontrak pesan — itu di
> `UVPD_Extension_Blueprint.md` (sudah final). Baca itu dulu.
> **Kondisi nyata repo:** lihat `CLAUDE.md` (audit — apa yang jalan vs stub).
> Prototipe visual acuan: `uvpd-manager-prototype.html`.

**Prinsip fase ini (arahan pemilik):** utamakan **keindahan & fitur**; performa dituning di
Milestone U6. Jangan menahan pilihan library demi bundle kecil sekarang.

---

## 1. Stack & migrasi

### 1.1 Target
| Lapisan | Pilihan | Kenapa |
|---|---|---|
| Framework | **React 18** (dari Preact) | Akses penuh ekosistem tanpa friksi (Radix, Framer Motion, TanStack, dll). Migrasi mulus lewat Vite yang sudah ada. |
| Build ekstensi | **Vite + CRXJS** | HMR untuk MV3, DX modern, multi-entry (side panel, tab manager, player, options, popup). |
| Komponen | **shadcn/ui** (Radix + Tailwind) | Standar de-facto UI cantik & aksesibel: Dialog, Menu, Tabs, Slider, Popover, Tooltip, Command, dll. |
| Styling | **Tailwind CSS** + CSS vars | Kecepatan, konsistensi, theming (dark/light + accent). |
| Motion | **Framer Motion** | Animasi kaya: layout animation, gesture, orchestration, shared-layout antar-view. |
| State | **Zustand** + **TanStack Query** | State ringkas & reaktif; async/cache untuk analisis manifest. |
| List panjang | **TanStack Virtual** | Ratusan media tetap mulus (60fps) — penting saat deteksi agresif. |
| **Player** | **Vidstack** (React media player) | Purpose-built untuk media: HLS/DASH, headless + skinnable, scrubber+preview+track. Fondasi player pro tanpa membangun dari nol. |
| Ikon | **lucide-react** | Set konsisten, tree-shakeable. |
| Data viz | **Tremor** / **Recharts** | Grafik kecepatan unduhan, statistik — cantik out-of-the-box. |
| Command palette | **cmdk** | Palet perintah kelas-atas (⌘K). |
| Toast | **sonner** | Notifikasi in-UI yang halus. |
| DnD | **dnd-kit** | Urutkan-ulang antrean unduhan dengan drag. |
| **Mux in-browser** | **ffmpeg.wasm** | Gabungkan audio+video sungguhan di dalam ekstensi (kemampuan yang script pun tak punya). |
& **TypeScript strict**.

### 1.2 Urutan migrasi (jangan sekaligus)
1. **Build:** ganti konfigurasi Vite ke **CRXJS** (`@crxjs/vite-plugin`) agar MV3 multi-entry + HMR. Manifest tetap di-generate dari `src/manifest.ts`.
2. **Framework:** Preact → React 18. Opsi aman: aktifkan `preact/compat` sementara supaya library React jalan, lalu pindahkan komponen per-surface. **Core (`src/core|background|injected|content`) tak menyentuh Preact → biarkan.**
3. **Styling:** pasang Tailwind; port `src/ui/theme/tokens.css` menjadi **CSS variables + preset Tailwind** (§4). Komponen pakai util Tailwind + token, bukan hex mentah.
4. **Komponen:** inisialisasi shadcn/ui; ganti komponen ad-hoc dengan primitive (Dialog, Popover, Tabs, Slider, Command, Tooltip, DropdownMenu, Toast/sonner).
5. **State:** angkat state UI ke **Zustand** (§5); background tetap sumber kebenaran media/unduhan, store UI adalah cache + view-state.

### 1.3 Aturan
- Setiap langkah: `npm run build` tetap hijau, `tsc --noEmit` bersih.
- Jangan pindahkan semua surface sekaligus — satu per milestone (§6).

---

## 2. Dua wujud UI (arsitektur surface)

Ekstensi punya **dua** UI yang berbagi komponen & store:

| Wujud | Entry | Peran | Kapan |
|---|---|---|---|
| **Side panel ringkas** | `src/ui/sidepanel/` (`chrome.sidePanel`) | Akses cepat saat browsing: deteksi live, kartu, dock unduhan | Default saat menjelajah |
| **Media Manager (tab penuh)** | `src/ui/manager/` **(BARU)**, dibuka via `chrome.tabs.create` | Pengalaman utama: rail nav + Library, Player, Downloads, Settings, Command palette | Saat butuh kelola serius (isi prototipe) |
| Player | `src/ui/player/` | Player pro (Vidstack), bisa standalone window atau embedded di Manager | Putar |
| Popup | `src/ui/popup/` | Ringkasan 1-klik + jumlah temuan + tombol buka Manager/panel | Klik ikon |
| Options | `src/ui/options/` | Semua setting + export/import | Pengaturan |

Manager & side panel me-render **komponen yang sama** (`Library`, `MediaCard`, `DownloadDock`) dengan
layout berbeda (grid lebar vs list sempit).

---

## 3. Model interaksi & alur data UI

- UI **tidak** menyimpan state media/unduhan sendiri; ia **subscribe** ke background lewat kontrak
  `UiMessage`/broadcast (`GET_MEDIA_LIST` → `MEDIA_LIST_UPDATED`, `GET_DOWNLOADS` → progress).
- Store Zustand = cache hasil broadcast + view-state (filter, sort, tab aktif, tema, aksen).
- Progress unduhan streaming via **Port** (`chrome.runtime.connect`), bukan `sendMessage` sekali-jalan
  (biar mulus). Extend kontrak bila perlu, di `src/shared/contract.ts`.

---

## 4. Design System — "Ruang Sinyal"

Identitas: alat presisi menangkap **sinyal media**. Gelap-first, padat, keyboard-first, premium.
**Signature:** *provenance* tiap media (bagaimana ia tertangkap) sebagai elemen visual utama.

### 4.1 Token warna (implement sebagai CSS vars + preset Tailwind)
```css
/* dark (default) */
--bg:#080A0F; --surface:#0F131C; --panel:#12161F; --card:#141A25; --card-hi:#18202D;
--line:rgba(255,255,255,.07); --line-2:rgba(255,255,255,.11); --glass:rgba(18,23,33,.62);
--tx:#EAEEF5; --tx-2:#98A3B4; --tx-3:#5E6675;
--accent:#5B8DEF; --accent-2:#A374FF;              /* gradient azure→violet, dapat diganti */
/* SEMANTIK cara pengiriman — WAJIB dipakai konsisten (warna = informasi, bukan hiasan) */
--direct:#35D6A0; --hls:#5B8DEF; --dash:#A374FF; --mse:#F5B54A; --frag:#FF6FB3;
--ok:#35D6A0; --warn:#F5B54A; --danger:#FF5D6C;
```
Aksen dapat diganti (Azure/Emerald/Magenta/Amber) via `data-accent` di root. Tema terang via
`data-theme="light"` (lihat prototipe untuk nilai terang).

### 4.2 Tipografi (3 peran)
- **Display/brand:** `Space Grotesk` (600/700) — judul, angka statistik. Berkarakter, dipakai terukur.
- **Body/UI:** `Inter` (400–700).
- **Data teknis:** `JetBrains Mono` — **semua** URL, bitrate, ukuran, itag, durasi, perintah ffmpeg, jejak provenance. (Mono-untuk-data = jujur pada subjek.)
- Skala: 11/12/13.5/14 (UI), 19–32 (display). Tracking display `-0.02em`.

### 4.3 Spacing / bentuk / motion
- Radius: `10 / 16 / 22px`. Gap grid kartu `16px`. Padding konten `22–26px`.
- Shadow elevasi: `0 24px 60px -24px rgba(0,0,0,.85)`.
- Motion (Framer Motion): view transition (fade+slide 8px, 0.3s), stagger kartu masuk (40ms), hover-lift kartu (`translateY(-4px)`), progress animasi. `prefers-reduced-motion` → matikan.
- **Ambient glow** halus di latar (azure+violet blur) — atmosfer, bukan distraksi.

### 4.4 Signature: strip provenance
Tiap `MediaCard` menampilkan **bagaimana media tertangkap**, dengan:
- titik/ikon **equalizer mini bergerak** berwarna sesuai `MediaKind` (direct/hls/dash/mse/frag);
- jejak dalam monospace, contoh: `network · 3 frames`, `reassembled · 142 fragmen · itag 137`, `appendBuffer · live`, `DOM · <video>`, `network · iframe`.
Sumbernya: `MediaItem.source` + `MediaItem.kind` + `frameId`/`segmentCount`. Ini juga jadi **filter**
(§Library). Tak ada downloader lain menampilkan ini — jangan reduksi jadi badge biasa.

### 4.5 Komponen inti (bangun sekali, pakai di semua surface)
`MediaCard`, `QualityLadder` (chip kualitas, terbaik ter-highlight), `ProvenanceStrip`,
`FilterChips`, `SearchBar`, `DownloadDock` (ringkas) & `DownloadQueue` (penuh), `PlayerShell`
(Vidstack), `CommandPalette` (cmdk), `Toaster` (sonner), `StatCard`, `TrackList`, `RailNav`.

---

## 5. Store (Zustand) — bentuk yang disarankan
```ts
interface UvpdStore {
  // cache dari background (via broadcast)
  media: Record<string, MediaItem>;         // key = MediaItem.id
  downloads: Record<string, DownloadProgress>;
  activeTabHost: string;
  // view-state
  view: 'library'|'player'|'downloads'|'settings';
  filter: MediaKind|'all'|'favorites';
  query: string;
  sort: 'recent'|'quality'|'kind';
  selectedMediaId?: string;
  theme: 'dark'|'light'|'system';
  accent: 'azure'|'emerald'|'magenta'|'amber';
  density: 'comfortable'|'compact';
  // actions (kirim UiMessage ke background)
  play(id): void; download(id, opts): void; cancel(id): void; retry(id): void;
  rescan(): void; setFilter(f): void; /* … */
}
```
Selectors turunan (mis. daftar terfilter+tersortir) di store, bukan di komponen.

---

## 6. Milestone UI (bangun berurutan; tiap milestone punya kriteria lulus)

> Ini melanjutkan Fase backend di `UVPD_Extension_Blueprint.md`. Backend Fase 0–1 & engine sebagian
> besar sudah ada; milestone di bawah fokus UI/fitur + menutup stub.

### U0 — Migrasi kerangka + perbaikan cepat
- Migrasi build ke CRXJS + React + Tailwind + shadcn (§1). Port core apa adanya.
- **Fix bug kualitas default** (Player muat `bestVariant`; HLS start level tertinggi).
- **Tambah tombol refresh** manual di panel (kirim `GET_MEDIA_LIST`).
- **Verifikasi runtime**: Load unpacked, konfirmasi deteksi→list muncul di ≥3 situs non-DRM nyata.
- ✅ *Lulus:* build hijau di React/Tailwind; panel lama tampil dgn shadcn; kualitas terbaik termuat; refresh bekerja; deteksi terbukti jalan runtime.

### U1 — Design system + Library kaya
- Implement token (§4) + ThemeProvider (tema+aksen+densitas). Bangun `MediaCard`, `ProvenanceStrip`, `QualityLadder`, `FilterChips`, `SearchBar`, `StatCard`, `Toaster`.
- **Thumbnail**: poster dari frame `<video>` (via content) atau track thumbnail HLS/DASH; fallback gradien.
- **Judul pintar** dari `<title>`/`og:title` (isi `MediaItem.title` di enricher).
- Empty/loading/error state berarah (skeleton saat rescan).
- Virtualisasi list (TanStack Virtual) untuk ratusan item.
- ✅ *Lulus:* Library tampak seperti prototipe; kartu punya thumbnail+provenance+ladder; filter/sort/search jalan; 300 item tetap mulus.

### U2 — Media Manager (tab penuh) + Command palette
- Buat `src/ui/manager/` dengan `RailNav` + view Library/Player/Downloads/Settings; dibuka via `chrome.tabs.create`. Share komponen dgn side panel.
- **Command palette (cmdk, ⌘K/Ctrl+K):** cari media + aksi (buka view, rescan, unduh semua direct, salin URL, ekspor ffmpeg, ambil frame).
- Transisi antar-view (Framer Motion), aksen switcher, toasts.
- ✅ *Lulus:* Manager berfungsi penuh seperti prototipe; ⌘K membuka palet, panah+Enter jalan; navigasi mulus.

### U3 — Player pro (Vidstack)
- Ganti `<video controls>` dengan **Vidstack**: scrubber+buffer+**chapters**+**hover-preview** (VTT/sprite atau frame), pilih **kualitas/audio/subtitle**, kecepatan, PiP, **fit/fill**, hotkey penuh + help overlay, auto-hide controls.
- **Ambil frame → PNG**, **A–B loop**, **frame-step**, overlay statistik (res/bitrate/buffer/dropped).
- Ingat volume/kecepatan/**posisi per-situs** (storage).
- Integrasikan hls.js/dash.js yang sudah dibundel lokal (jangan CDN).
- ✅ *Lulus:* semua kontrol di prototipe Player berfungsi; kualitas terbaik default; frame-grab menghasilkan PNG; A-B loop & stats jalan.

### U4 — Unduhan: tutup stub + queue UI
- **Port resumable IndexedDB** dari userscript (`indexedDB.open`, chunk 8MB, range paralel ≤8, `Content-Range`/`ETag`/`If-Range`, resume session) ke `src/core` + wiring `strategy:'resumable'` di `download-manager.ts`. **Ini menutup satu-satunya fitur yang benar-benar hilang.**
- **Queue UI** (Downloads view + DownloadDock): ring+bar progress, **grafik kecepatan (Recharts)**, ETA, pause/resume/cancel/retry, **drag reorder (dnd-kit)**, kontrol konkurensi.
- Pilih kualitas per-unduhan; **riwayat** + unduh-ulang; unduh subtitle (VTT→SRT).
- ✅ *Lulus:* unduh resumable benar-benar melanjutkan setelah putus (uji nyata); queue UI mengontrol unduhan; sparkline & ETA akurat.

### U5 — Fitur pro & mux
- **ffmpeg.wasm (on-demand):** gabungkan audio+video terpisah → satu file di offscreen. Muat WASM lazy hanya saat user memilih "gabungkan". Tetap sediakan ekspor perintah ffmpeg sebagai fallback.
- **Provenance filters** (hanya iframe / hanya fragmen disusun-ulang / setelah SPA nav).
- Badge angka di ikon toolbar (jumlah media tab aktif); drag-drop/paste URL untuk analisis cepat.
- **UX MSE capture** jujur: karena real-time (harus diputar penuh) + butuh remux — tampilkan progress & penjelasan, bukan "unduh instan".
- ✅ *Lulus:* mux ffmpeg.wasm menghasilkan file gabungan valid; filter provenance jalan; badge akurat.

### U6 — Edar + performa
- Onboarding first-run; Options lengkap (autoplay, loop, kecepatan awal, keybind, konkurensi, interval deteksi, redaksi token, per-site rules, **export/import config**).
- **Tuning performa** (baru sekarang): code-split per surface, lazy-load ffmpeg.wasm & dash.js, audit bundle. Bila perlu, evaluasi `preact/compat` sebagai swap akhir.
- Packaging & signing (Chrome Web Store / AMO), auto-update.
- ✅ *Lulus:* checklist §7 hijau; ekstensi ter-package & jalan dari store build.

---

## 7. Definition of Done (checklist lapisan UI/fitur)
- [ ] `tsc --noEmit` bersih; `npm run build` hijau (Chrome+Firefox).
- [ ] **Diuji Load unpacked di situs nyata** — bukan hanya build. (Setiap milestone.)
- [ ] Kualitas **terbaik** termuat default (bukan resolusi kecil).
- [ ] Kartu punya thumbnail + strip provenance; list bisa di-refresh manual.
- [ ] Player: scrubber+preview, pilih kualitas/audio/subtitle, hotkey, frame-grab, A-B loop, stats.
- [ ] Unduh **resumable** benar-benar melanjutkan setelah koneksi putus.
- [ ] Queue UI: progress/kecepatan/ETA, pause/resume/cancel/retry, drag reorder.
- [ ] ffmpeg.wasm mux menghasilkan file gabungan valid (audio+video).
- [ ] Konten DRM → `protected`, **tidak** diproses (regresi = bug kritis).
- [ ] Token diredaksi; tak ada eksfiltrasi jaringan.
- [ ] i18n: semua teks baru ada di 6 locale.
- [ ] A11y: fokus keyboard terlihat; `prefers-reduced-motion` dihormati.
- [ ] Tak ada klaim "tervalidasi" tanpa test/uji nyata yang benar.

---

## 8. Referensi cepat file
- Tipe & pesan: `src/shared/types.ts`, `src/shared/contract.ts`.
- Deteksi: `src/background/net-sniffer.ts`, `src/content/dom-scanner.ts`, `src/injected/hooks.ts`.
- Unduh/parse/kripto: `src/background/{download-manager,segmented,fragment-grouper}.ts`, `src/core/{hls,dash}-*,segment-crypto,segmented-runner}.ts`.
- Sumber port userscript: `Universal_Video_Player___Downloader__UVPD__-_More.js` (player ~4173+, resumable IndexedDB ~6224+).
- Acuan visual: `uvpd-manager-prototype.html` (+ `uvpd-ui-prototype.html`).

### Ringkas
Migrasi ke stack kelas-atas, bangun **Media Manager + side panel** yang berbagi komponen, terapkan
design system "ruang sinyal" dengan *provenance* sebagai bintang, lalu tutup dua kekurangan nyata
(resumable IndexedDB + player) dan tambah fitur pro (command palette, ffmpeg.wasm mux). Urutan
U0→U6; tiap milestone diverifikasi di browser nyata sebelum lanjut. Fitur & keindahan dulu, performa
di U6 — sesuai arahan.
