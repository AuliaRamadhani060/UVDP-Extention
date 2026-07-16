// Entry background (service worker / event page) — OTAK (Blueprint §5.4).
// Observasi jaringan, enrichment manifest (background fetch + parse HLS SW /
// DASH offscreen), registry persisted, router kontrak §7, unduhan, offscreen.
import { browser } from '@/platform/browser';
import { MediaRegistry } from '@/core/media-registry';
import { installNetSniffer } from './net-sniffer';
import { connectDownloadPort } from './download-queue';
import { enrichManifest } from './enricher';
import { registerRouter, patchDiagnostics } from './router';
import { DOWNLOAD_PORT } from '@/shared/contract';
import { noteFragment, clearFragmentsForTab } from './fragment-grouper';
import { noteQualityFile, clearQualityForTab } from './quality-grouper';
import { ensureRefererRule, probeSize } from './referer-spoof';
import { ensureOffscreen, pingOffscreen } from './offscreen-manager';
import { broadcast } from '@/shared/messaging';
import type { MediaItem } from '@/shared/types';

const registry = new MediaRegistry();
const enrichRequested = new Set<string>();
const sizeProbed = new Set<string>();

// Router kontrak §7 (top-level & sinkron — jebakan §9).
registerRouter({
  registry,
  registerCandidate: (entry, tabId) => registerAndEnrich(entry, tabId),
  openPlayer,
  analyzeUrl,
});

// Port streaming antrean unduhan (UI ⇄ background).
browser.runtime.onConnect.addListener((port: { name: string; postMessage: (m: unknown) => void; onDisconnect: { addListener: (cb: () => void) => void } }) => {
  if (port.name === DOWNLOAD_PORT) connectDownloadPort(port);
});

// Offscreen (Chromium) & diagnostik konteks ke-4.
initOffscreenDiagnostics();

// Observer jaringan → kandidat media + pengelompokan fragmen (§8.1).
installNetSniffer(
  registry,
  (cand) => registerAndEnrich(cand, cand.tabId),
  (frag) => {
    const entry = noteFragment(frag);
    if (entry) registerAndEnrich(entry, entry.tabId);
  },
);

// Registry hidup lintas tidur-SW & navigasi.
registry.ready.catch(() => {});
// Badge selalu cerminkan tab yang sedang aktif (mis. setelah SW bangun kembali).
browser.tabs.onActivated.addListener((info: { tabId: number }) => {
  registry.ready.then(() => updateBadge(info.tabId)).catch(() => {});
});
browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string; url?: string }) => {
  // Reload/navigasi dokumen nyata → bersihkan media tab (SPA soft-nav tidak memicu ini).
  if (changeInfo.status === 'loading' && changeInfo.url) {
    registry.removeByTab(tabId);
    clearFragmentsForTab(tabId);
    clearQualityForTab(tabId);
    updateBadge(tabId);
    broadcast({ type: 'MEDIA_LIST_UPDATED', payload: { tabId, entries: [] } });
  }
});

function registerAndEnrich(partial: Partial<MediaItem> & { url: string }, tabId?: number): MediaItem {
  // File per-kualitas (video_720m.mp4, _480m.mp4, …) → satu entri multi-resolusi.
  let toRegister: Partial<MediaItem> & { url: string } = partial;
  if (partial.kind === 'file' && !partial.protected) {
    const grouped = noteQualityFile({ ...partial, tabId: tabId ?? partial.tabId });
    if (grouped) toRegister = grouped;
  }

  const item = registry.upsert({ ...toRegister, tabId: tabId ?? toRegister.tabId });
  updateBadge(item.tabId);
  broadcast({ type: 'MEDIA_LIST_UPDATED', payload: { tabId: item.tabId, entries: registry.list(item.tabId) } });

  // Pasang Referer situs untuk host media → player/unduh lolos hotlink protection.
  if (/^https?:/.test(item.url) && item.pageUrl) ensureRefererRule(item.url, item.pageUrl);

  // Ambil ukuran file langsung SEBELUM diputar (setara userscript yang in-page).
  if (item.kind === 'file' && !item.sizeBytes && /^https?:/.test(item.url) && !sizeProbed.has(item.url)) {
    sizeProbed.add(item.url);
    ensureRefererRule(item.url, item.pageUrl).then(() => probeSize(item.url)).then((size) => {
      if (!size) return;
      const updated = registry.upsert({ id: item.id, url: item.url, tabId: item.tabId, sizeBytes: size });
      broadcast({ type: 'MEDIA_LIST_UPDATED', payload: { tabId: updated.tabId, entries: registry.list(updated.tabId) } });
    });
  }

  const needsEnrich = (item.kind === 'hls' || item.kind === 'dash') && !item.variants && !item.protected;
  if (needsEnrich && !enrichRequested.has(item.url)) {
    enrichRequested.add(item.url);
    enrichManifest(item.url, item.kind as 'hls' | 'dash').then((patch) => {
      if (!patch) return;
      const updated = registry.upsert({ id: item.id, url: item.url, tabId: item.tabId, ...patch });
      updateBadge(updated.tabId);
      broadcast({ type: 'MEDIA_LIST_UPDATED', payload: { tabId: updated.tabId, entries: registry.list(updated.tabId) } });
    });
  }
  return item;
}

/**
 * Analisis cepat URL yang di-paste/drop user (U5). Deteksi jenis dari URL lalu
 * daftarkan sebagai kandidat → enrichment/ukuran mengalir seperti media biasa.
 */
function analyzeUrl(rawUrl: string, tabId?: number): void {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return;
  const kind: MediaItem['kind'] = /\.m3u8(\?|$)/i.test(url) ? 'hls' : /\.mpd(\?|$)/i.test(url) ? 'dash' : 'file';
  registerAndEnrich({ url, kind, source: 'text-scan', pageUrl: url, protected: false }, tabId);
}

function openPlayer(id: string): void {
  const m = registry.get(id);
  if (m && /^https?:/.test(m.url) && m.pageUrl) ensureRefererRule(m.url, m.pageUrl); // pastikan bisa diputar
  const url = browser.runtime.getURL('src/ui/player/player.html') + '?id=' + encodeURIComponent(id);
  browser.tabs.create({ url });
}

function updateBadge(tabId?: number): void {
  if (tabId === undefined) return;
  const count = registry.list(tabId).length;
  browser.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  browser.action.setBadgeBackgroundColor({ tabId, color: '#e11d48' });
}

async function initOffscreenDiagnostics(): Promise<void> {
  const ok = await ensureOffscreen();
  if (!ok) {
    await patchDiagnostics({ offscreen: null });
    return;
  }
  await patchDiagnostics({ offscreen: await pingOffscreen() });
}

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: 'uvpd-open', title: 'UVPD', contexts: ['all'] });
});
