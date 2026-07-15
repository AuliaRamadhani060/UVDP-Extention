# UVPD — Tujuan Akhir & Visi Proyek
### Dari userscript lahir, sampai naik kelas menjadi ekstensi

Dokumen ini bukan spesifikasi teknis (itu ada di *Blueprint*). Ini adalah **peta tujuan** — menjelaskan *mengapa* proyek ini ada, ke *mana* arahnya, dan seperti apa "berhasil" itu terlihat. Gunanya: menjaga setiap keputusan pengembangan tetap searah, dan menjaga ekspektasi tetap membumi sekaligus ambisius.

---

## 1. Visi (bintang penuntun)

> **Menjadi alat berbasis web paling lengkap dan paling andal untuk menemukan, memutar, dan mengunduh media apa pun — dalam format apa pun dan cara pengiriman apa pun — di situs mana pun.**

Kata kuncinya: **lengkap**, **andal**, **universal untuk yang non-DRM**. unuk "membuka apa pun tanpa kecuali".

---

## 2. Perjalanan proyek (busur dari awal sampai sekarang)

### Titik awal — cita-cita universalitas
UVPD lahir sebagai **userscript** dengan satu ambisi besar: mendeteksi, memutar, dan mengunduh video *dalam format apa pun dan bagaimanapun cara pengirimannya*, di *situs mana pun*. Ambisi ini benar sebagai arah — hanya perlu didefinisikan ulang batasnya seiring pemahaman bertambah.

### Yang berhasil dicapai — v0.6.1 sudah matang
Userscript ini tumbuh menjadi alat yang **feature-complete**:
- Deteksi otomatis lintas DOM, Shadow DOM, jaringan (fetch/XHR), iframe, dan teks halaman.
- Parser HLS & DASH lengkap dengan varian kualitas, audio, dan subtitle.
- Player kustom (hls.js/dash.js, PiP, subtitle, thumbnail scrubbing, pemilihan track).
- Download manager tangguh: segmented paralel, retry backoff, **dekripsi AES-128**, **resume berbasis IndexedDB**, dan **ekspor perintah ffmpeg**.
- Desain privacy-first (redaksi token) dan kontrol per-situs.

### Tembok yang ditemui — batas konteks halaman
Lalu muncul kasus YouTube dan sejenisnya, dan tersingkap batas nyata userscript:
- Userscript hidup **di dalam konteks JavaScript halaman**, jadi hanya melihat sebagian request.
- Media MSE dikirim sebagai handle `blob:` tanpa isi yang bisa diunduh.
- Fragmen `googlevideo`/segment yang sebenarnya justru **sengaja dibuang** oleh filter script sendiri.
- Navigasi SPA membuat deteksi tak ter-refresh.

### Momen pencerahan — pelajaran dari IDM
Perbandingan dengan IDM meluruskan miskonsepsi terbesar: **keunggulan IDM bukan karena ia membypass DRM**, melainkan karena ia bekerja **di luar sandbox halaman** — memakai `webRequest` lewat ekstensi native, sehingga melihat *semua* request di semua frame. URL yang "tak bisa kita temukan" itu sebenarnya URL biasa yang lewat di jalur tak terlihat oleh script konteks-halaman — bahkan URL yang filter kita buang. IDM pun berhenti di tembok yang sama persis dengan kita: blob MSE dan DRM.

### Keputusan — naik kelas ke ekstensi
Kesimpulannya jelas: batas terbesar bukan kepintaran kode, tapi **posisi berdiri kode**. Untuk mendapat jangkauan setara-IDM, jalannya adalah **ekstensi Manifest V3** dengan izin `webRequest` — memberi visibilitas jaringan menyeluruh, background persisten, kekebalan terhadap navigasi SPA, dan unduhan yang lebih kuat. Dan yang penting: **±80% logika inti userscript dipakai ulang**, bukan ditulis ulang.

---

## 3. Tujuan akhir yang jujur (mendefinisikan ulang "universal")

Kata "universal" harus dipecah menjadi tiga sumbu — karena di sinilah letak kejelasan yang selama ini kabur:

| Sumbu universalitas | Status tujuan |
|---|---|
| **Segala FORMAT** (mp4, webm, mkv, ts, m4s, dst.) | ✅ **Tercapai penuh** — sepanjang bytes-nya terjangkau |
| **Segala CARA PENGIRIMAN** (progressive, HLS, DASH, fragmen bertanda tangan, MSE) | ✅ **Tercapai untuk non-DRM** — inilah lompatan utama ekstensi |
| **Segala SITUS & FRAME** (top, iframe xorigin, service worker, SPA) | ✅ **Tercapai** — via `webRequest` |

Dan dua tembok yang **mendefinisikan plafon** — bukan kegagalan, melainkan hukum platform web yang berlaku untuk semua alat:

- 🧱 **Blob MediaSource tanpa URL** — isinya hanya ada di memori pemutar; tak ada yang bisa di-fetch. (Ekstensi menutup sebagian celah ini lewat penangkapan `appendBuffer` untuk konten non-DRM, tapi tetap ada sisa yang tak terjangkau.)
- 🧱 **Konten DRM/EME** (Widevine/FairPlay/PlayReady) — frame terdekripsi tak pernah ada di memori yang bisa diakses. Ini garis yang **tidak dilewati**, sesuai prinsip yang tertulis di header script sejak awal.

**Maka tujuan akhir yang benar berbunyi:** *cakupan penuh atas seluruh media non-DRM, di seluruh cara pengiriman dan seluruh situs — dengan kejujuran mutlak di dua tembok tersebut.* Ini ambisius **dan** bisa dicapai. "Membuka apa pun termasuk yang terproteksi" bukan tujuan kita, dan bukan sesuatu yang saya bisa bantu bangun.

---

## 4. Tujuan konkret ekstensi (apa yang ingin dicapai, terukur)

Diterjemahkan menjadi sasaran yang bisa dinilai selesai/belum:

**A. Deteksi — sekelas IDM**
1. Melihat **seluruh** request media di semua frame, service worker, dan lintas-origin.
2. Kebal navigasi SPA (deteksi tak reset saat pindah halaman internal).
3. **Menangkap** stream fragmen/segment yang dulu dibuang, lalu **menyusunnya kembali** per representasi (itag/kualitas).
4. Menangkap buffer **MSE non-DRM** langsung dari pemutar (`appendBuffer`), dengan penjaga DRM yang tegas.

**B. Pemutaran — universal**
5. Memutar apa pun yang terdeteksi via player kustom (native/hls.js/dash.js), lengkap dengan subtitle, audio track, thumbnail, dan kontrol penuh — bebas dari CSP situs karena berjalan di halaman ekstensi.

**C. Unduhan — tangguh & nyaman**
6. Unduh langsung, segmented paralel, dan **resumable** yang tervalidasi.
7. **Tulis langsung ke disk** (`chrome.downloads`) tanpa batasan browser tab.
8. Dekripsi AES-128 standar; audio/video terpisah → arahkan mux ffmpeg.
9. Antrean unduhan global yang bertahan lintas-sesi.
10. Ekspor perintah **ffmpeg** untuk kasus yang sengaja tak diselesaikan in-browser (live, multi-period, SegmentBase).

**D. Platform — mandiri, aman, layak edar**
11. Berdiri sendiri (tak butuh Tampermonkey), pustaka di-bundle lokal.
12. Privacy-first: redaksi token dipertahankan; observasi jaringan tidak pernah dieksfiltrasi.
13. Siap didistribusikan & diperbarui otomatis.

---

## 5. Prinsip yang dibawa dari awal (tidak berubah)

Naik kelas ke ekstensi tidak boleh menggerus jati diri proyek:

- **Menghormati proteksi.** DRM tetap tidak disentuh. Ini bukan keterbatasan yang disesali, melainkan garis prinsip.
- **Privacy-first.** Token/signature diredaksi sebelum disimpan; kemampuan mengamati jaringan tidak disalahgunakan.
- **Jujur soal batas.** Alat ini menyatakan dengan jelas di mana kemampuannya berhenti, alih-alih berpura-pura serba bisa.
- **Hemat & berkelanjutan.** Bangun di atas ±80% kode matang yang sudah ada; evolusi, bukan revolusi.

---

## 6. Seperti apa "berhasil" itu terlihat (definisi sukses)

Ekstensi dianggap **mencapai tujuannya** ketika:

- ✅ Di situs non-DRM apa pun, ia mendeteksi **sama banyak atau lebih** dari userscript — termasuk stream yang dulu tak terlihat.
- ✅ Media di iframe lintas-origin & di balik navigasi SPA tetap tertangkap.
- ✅ Stream fragmen (mis. googlevideo non-DRM) bisa disusun ulang dan diunduh menjadi file utuh.
- ✅ Semua kemampuan userscript (player, segmented, AES-128, resume, ffmpeg) berjalan di ekstensi tanpa regresi.
- ✅ Konten DRM secara konsisten ditandai `protected` dan **tidak** diproses — tembok dihormati.
- ✅ Berjalan mandiri, privasi terjaga, siap dipakai orang lain.

Saat semua kotak ini tercentang, proyek telah menjadi apa yang diimpikan sejak awal — **seuniversal yang mungkin secara sah** — bukan lebih, bukan kurang.

---

## 7. Posisi terhadap IDM (di mana kita menyamai, di mana kita berbeda)

| Aspek | IDM | UVPD Ekstensi (tujuan) |
|---|---|---|
| Visibilitas jaringan | Penuh (ekstensi + native) | **Penuh** (webRequest) — setara |
| Tulis ke disk / multi-koneksi | Ya (native) | Ya (`chrome.downloads` + segmented) |
| Bebas CORS untuk unduh | Ya | Ya (host permission) |
| Butuh aplikasi native terpasang | **Ya** | **Tidak** — sepenuhnya di browser |
| Parsing HLS/DASH + player bawaan | Terbatas | **Lebih kaya** (player kustom, track, thumbnail) |
| Privacy-first & transparan soal batas | Tidak menonjol | **Nilai inti** |
| Konten DRM | Tidak bisa | Tidak bisa (dan tak dikejar) — sama |

Tujuan kita bukan menjadi klon IDM, melainkan **menyamai jangkauannya sambil tetap murni-web, lebih kaya fitur pemutaran, dan lebih jujur soal privasi dan batas.**

---

## 8. Ringkasan satu paragraf

Proyek ini berangkat dari cita-cita sebuah userscript untuk membuka video apa pun di mana pun; ia tumbuh matang, lalu menabrak batas nyata konteks-halaman pada kasus seperti YouTube. Pelajaran dari IDM menyingkap bahwa batas itu soal *posisi*, bukan *kepintaran* — dan solusinya adalah naik kelas ke ekstensi ber-`webRequest` yang melihat seluruh jaringan sambil memakai ulang ±80% kode yang sudah ada. **Tujuan akhirnya**, yang kini terdefinisi jujur: menjadi alat murni-web paling lengkap dan andal untuk seluruh media **non-DRM** — segala format, segala cara pengiriman, segala situs dan frame — yang menulis ke disk, memutar apa saja, menyusun ulang stream yang dulu tak terjangkau, dan tetap berhenti dengan hormat di dua tembok yang tak bisa dilewati siapa pun: blob MediaSource tanpa URL, dan konten ber-DRM. Universal sejauh yang sah — itulah garis akhir kita.
