// Entry content script (isolated world) — BRIDGE + mata DOM (Blueprint §5.3).
// Deteksi DOM/teks/script, suntik & relay hook MAIN-world, kirim kandidat ke
// background lewat kontrak §7 (MEDIA_CANDIDATE). UI utama = side panel (bukan lagi
// panel in-page). Enrichment manifest kini digerakkan background (Blueprint §3.3).
import { browser } from '@/platform/browser';
import { sendBridge } from '@/shared/messaging';
import { scanDomForMedia, scanVideos, scanScripts, scanPageText, scanAttributes, smartTitle, observeDom } from './dom-scanner';
import { classifyFromUrl, toMediaItem } from './detect';
import { mseOpen, mseChunk, mseFinalize, findStreamIdByEntry } from './mse-capture';
import { getSettings, isHostEnabled, pushHistory } from '@/shared/store';
import { isListableMediaUrl } from '@/core/url-utils';
import type { MediaItem, MediaKind } from '@/shared/types';

const seen = new Set<string>();
let enabled = true;

function report(url: string, source: MediaItem['source'], extra: Partial<MediaItem> = {}): void {
  if (!enabled || seen.has(url)) return;
  // Manifest yang sudah dikenali dari ISI (kind hls/dash eksplisit) lolos filter
  // ekstensi — menangkap manifest bertoken tanpa .m3u8/.mpd.
  const explicitStream = extra.kind === 'hls' || extra.kind === 'dash';
  // Hanya media utuh; segmen & URL non-media dibuang (kecuali penanda DRM/stream).
  if (!extra.protected && !explicitStream && !isListableMediaUrl(url)) return;
  seen.add(url);
  const kind = (extra.kind as MediaKind) || classifyFromUrl(url);
  const item = toMediaItem(url, kind, source, { pageTitle: smartTitle(), ...extra });
  sendBridge({ type: 'MEDIA_CANDIDATE', payload: item });
  pushHistory({ url, time: Date.now(), type: source });
}

function scan(): void {
  if (!enabled) return;
  for (const v of scanVideos()) report(v.url, 'dom', { subtitles: v.subtitles, duration: v.duration, poster: v.poster });
  for (const url of scanDomForMedia()) report(url, 'dom');
  for (const url of scanAttributes()) report(url, 'dom');
  for (const url of scanScripts()) report(url, 'text-scan');
  for (const url of scanPageText()) report(url, 'text-scan');
}

async function boot(): Promise<void> {
  const settings = await getSettings();
  enabled = isHostEnabled(settings, location.hostname);
  if (!enabled) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  observeDom(scan);
  setInterval(scan, settings.autoDetectIntervalMs);
}

// Relay hook MAIN-world (hello/fetch/xhr/mse/eme) → background via kontrak §7.
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data;
  if (!data || data.__uvpd !== 'uvpd:page-hook') return;
  const p = data.payload || {};
  if (p.kind === 'hello') {
    sendBridge({ type: 'PING_CHAIN', payload: { reached: ['main', 'bridge'] } });
  } else if (p.kind === 'eme') {
    report(location.href, 'page-hook', { protected: true, title: `DRM: ${p.keySystem}`, kind: 'unknown' });
  } else if (p.kind === 'manifest' && p.url) {
    // Manifest dikenali dari isi respons (HLS/DASH) walau URL bertoken tanpa ekstensi.
    report(String(p.url), 'page-hook', { kind: p.format === 'dash' ? 'dash' : 'hls' });
  } else if (p.kind === 'mse-open') {
    mseOpen(String(p.streamId), String(p.mime || ''), !!p.protected);
  } else if (p.kind === 'mse-chunk') {
    if (p.bytes instanceof ArrayBuffer) mseChunk(String(p.streamId), p.bytes);
  } else if (p.url) {
    report(String(p.url), 'page-hook');
  }
});

// Perintah dari background: finalisasi capture MSE → rakit & unduh di sini
// (buffer besar ada di content, bukan background).
browser.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as { type?: string; id?: string };
  if (msg?.type === 'FINALIZE_MSE' && msg.id) {
    const streamId = findStreamIdByEntry(msg.id);
    if (streamId) mseFinalize(streamId);
  }
});

boot();
