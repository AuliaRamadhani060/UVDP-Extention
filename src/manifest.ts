// Generator manifest lintas-browser.
// Chromium (Chrome/Edge/Brave/Opera) dan Firefox berbagi basis MV3 yang sama,
// dengan sedikit perbedaan yang di-branch di bawah.

import type { ManifestV3Export } from '@crxjs/vite-plugin';

type Target = 'chrome' | 'firefox';

const VERSION = '0.1.0';

export function buildManifest(target: Target): ManifestV3Export {
  const base = {
    manifest_version: 3,
    name: 'Universal Video Player & Downloader',
    short_name: 'UVPD',
    version: VERSION,
    description:
      'Deteksi, inspeksi, pemutaran, dan unduhan media HTML5/HLS/DASH yang tidak dilindungi DRM.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'UVPD — media terdeteksi',
      default_popup: 'src/ui/popup/popup.html',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
    options_ui: {
      page: 'src/ui/options/options.html',
      open_in_tab: true,
    },
    permissions: [
      'storage', // ganti GM_setValue/getValue
      'downloads', // ganti GM_download
      'notifications', // ganti GM_notification
      'contextMenus', // ganti GM_registerMenuCommand
      'webRequest', // sniffer jaringan (deteksi universal)
      'declarativeNetRequest', // spoof Referer agar player/unduh lolos hotlink protection
      'scripting', // injeksi MAIN world dinamis bila perlu
      'tabs',
      // Chromium: offscreen (DOMParser DASH) & sidePanel (UI utama). Firefox tak
      // mengenal keduanya → hanya ditambahkan untuk target chrome.
      ...(target === 'chrome' ? ['offscreen', 'sidePanel'] : []),
    ],
    host_permissions: ['<all_urls>'],
    background:
      target === 'firefox'
        ? // Firefox MV3 lebih andal dengan background scripts non-persisten.
          { scripts: ['src/background/index.ts'], type: 'module' as const }
        : { service_worker: 'src/background/index.ts', type: 'module' as const },
    content_scripts: [
      {
        // Content script "isolated world": UI + DOM scanner.
        matches: ['<all_urls>'],
        all_frames: true,
        run_at: 'document_start',
        js: ['src/content/index.ts'],
      },
      {
        // Hook API halaman di "MAIN world": fetch/XHR/MediaSource/EME.
        matches: ['<all_urls>'],
        all_frames: true,
        run_at: 'document_start',
        js: ['src/injected/hooks.ts'],
        world: 'MAIN',
      },
    ],
    web_accessible_resources: [
      {
        // Tambahkan 'vendor/*' di sini setelah hls.js/dash.js dibundel ke public/vendor.
        resources: ['src/ui/player/player.html'],
        matches: ['<all_urls>'],
      },
    ],
  };

  if (target === 'chrome') {
    // Chromium: side panel sebagai UI utama (persisten lintas navigasi SPA).
    (base as Record<string, unknown>).side_panel = { default_path: 'src/ui/sidepanel/panel.html' };
  } else {
    // Firefox: sidebar sebagai padanan side panel + ID untuk signing/AMO.
    (base as Record<string, unknown>).sidebar_action = {
      default_panel: 'src/ui/sidepanel/panel.html',
      default_title: 'UVPD',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    };
    (base as Record<string, unknown>).browser_specific_settings = {
      gecko: {
        id: 'uvpd@uvpd.local',
        strict_min_version: '128.0', // 'world: MAIN' content scripts didukung sejak 128.
      },
    };
  }

  return base as unknown as ManifestV3Export;
}
