import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import { buildManifest } from './src/manifest';

// TARGET dipilih lewat env (lihat script npm): 'chrome' | 'firefox'.
const target = (process.env.TARGET as 'chrome' | 'firefox') || 'chrome';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // React 18 lewat preact/compat (U0, blueprint §1.2 — "opsi aman"). Library
      // React (shadcn/Radix) mengimpor 'react'/'react-dom' → dialihkan ke Preact.
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  // JSX otomatis diarahkan ke Preact (tanpa Babel — ringan).
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  plugins: [
    // @crxjs menangani bundling entrypoint MV3 (background, content, injected)
    // dan menulis manifest.json final ke folder output.
    crx({ manifest: buildManifest(target), browser: target === 'firefox' ? 'firefox' : 'chrome' }),
  ],
  build: {
    // MV3 melarang remote code; semua di-bundle lokal.
    rollupOptions: {
      input: {
        // Halaman popup & options diproses via manifest oleh @crxjs.
        // Player (web-accessible) & offscreen (dibuat runtime) tidak dikenali
        // @crxjs sebagai entry → daftarkan manual agar .tsx-nya diproses.
        player: resolve(__dirname, 'src/ui/player/player.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        manager: resolve(__dirname, 'src/ui/manager/manager.html'),
        onboarding: resolve(__dirname, 'src/ui/onboarding/onboarding.html'),
        // @crxjs mengenali `side_panel` (Chromium) tapi TIDAK `sidebar_action`
        // (Firefox) → tanpa entry manual, panel.html tak ikut ke dist/firefox
        // dan sidebar Firefox rusak. Didaftarkan untuk kedua target.
        panel: resolve(__dirname, 'src/ui/sidepanel/panel.html'),
      },
    },
    target: 'es2022',
    // Sourcemap hanya untuk build pengembangan. Paket store dibangun dengan
    // STORE=1 → tanpa .map (paket jauh lebih kecil & tak membocorkan sumber).
    sourcemap: process.env.STORE !== '1',
  },
});
