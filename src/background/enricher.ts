// Enrichment manifest DIGERAKKAN BACKGROUND (Blueprint §3.3, §5.4).
// webRequest hanya memberi URL → background fetch ulang sendiri (bebas CORS
// dengan host permission), lalu parse: HLS di SW (teks murni), DASH di offscreen
// (Chromium) atau langsung (Firefox punya DOMParser di background).
import { parseHls } from '@/core/hls-parser';
import { parseDash, type DashResult } from '@/core/dash-parser';
import { pickBestQualityVariant } from '@/core/quality';
import { isOffscreenAvailable, parseDashViaOffscreen } from './offscreen-manager';
import type { MediaItem } from '@/shared/types';

async function fetchText(url: string): Promise<string> {
  try {
    // credentials:'include' → kirim cookie sesi (setara GM_xmlhttpRequest userscript)
    // agar manifest yang butuh auth (non-DRM) tetap bisa diambil. Bebas CORS karena
    // host permission. (Blueprint §3.3)
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function parseDashBest(text: string, url: string): Promise<DashResult | null> {
  if (isOffscreenAvailable()) return parseDashViaOffscreen(text, url);
  try {
    return parseDash(text, url); // Firefox: DOMParser tersedia di background
  } catch {
    return null;
  }
}

/** Ambil & parse manifest; kembalikan field yang memperkaya MediaItem, atau null. */
export async function enrichManifest(url: string, kind: 'hls' | 'dash'): Promise<Partial<MediaItem> | null> {
  const text = await fetchText(url);
  if (!text) return null;

  const patch: Partial<MediaItem> = {};
  if (kind === 'hls') {
    const r = parseHls(text, url);
    patch.playlistType = r.playlistType;
    patch.variants = r.variants;
    patch.audioTracks = r.audioTracks;
    patch.subtitles = r.subtitles;
    patch.encrypted = r.encrypted;
    patch.protected = r.protected;
    patch.protectionType = r.protectionType;
  } else {
    const r = await parseDashBest(text, url);
    if (!r) return null;
    patch.playlistType = 'mpd';
    patch.variants = r.variants;
    patch.audioTracks = r.audioTracks;
    patch.subtitles = r.subtitles;
    patch.protected = r.protected;
    patch.protectionType = r.protectionType;
  }
  const best = pickBestQualityVariant(patch.variants || []);
  if (best) patch.bestVariant = best;
  return patch;
}
