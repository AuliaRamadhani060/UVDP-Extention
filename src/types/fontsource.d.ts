// Deklarasi eksplisit untuk impor efek-samping paket font @fontsource-variable/*
// (mis. `import '@fontsource-variable/inter'`).
//
// Catatan (M4): `npx tsc --noEmit` sebenarnya SUDAH bersih tanpa berkas ini —
// `vite/client` (dirujuk di src/vite-env.d.ts) mendeklarasikan modul `*.css`,
// dan dengan `moduleResolution: "bundler"` impor di atas ter-resolve ke
// `index.css` paket. Deklarasi ini "belt-and-suspenders": menjaga typecheck
// tetap hijau bila referensi vite/client berubah di masa depan.
declare module '@fontsource-variable/*';
