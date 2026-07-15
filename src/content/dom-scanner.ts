// Pemindai DOM (isolated world) — port dari scanElementForMediaCandidates,
// scanInitialVideos, scanPageTextForM3U8Candidates, dan collectMediaTracks.
import { normalizeURL, isSafeMediaUrl, MEDIA_URL_REGEX } from '@/core/url-utils';
import type { Track } from '@/shared/types';

const SELECTOR =
  'video,source,iframe,embed,object,[data-src],[data-video],[data-video-url],[data-file],[data-hls],[data-m3u8],[data-mpd],[data-url],[data-stream],[data-player-url]';

const ATTRS = [
  'src', 'data', 'data-src', 'data-video', 'data-video-url', 'data-file',
  'data-hls', 'data-m3u8', 'data-mpd', 'data-url', 'data-stream', 'data-player-url',
];

export interface VideoDetail {
  url: string;
  duration?: number;
  subtitles: Track[];
}

/** URL media dari atribut elemen. */
export function scanDomForMedia(root: ParentNode = document): string[] {
  const found = new Set<string>();
  root.querySelectorAll(SELECTOR).forEach((el) => {
    for (const attr of ATTRS) {
      const raw = el.getAttribute(attr);
      if (!raw) continue;
      const url = normalizeURL(raw);
      if (isSafeMediaUrl(url)) found.add(url);
    }
  });
  return Array.from(found);
}

/** Video HTML5 beserta trek subtitle & durasi. */
export function scanVideos(root: ParentNode = document): VideoDetail[] {
  const out: VideoDetail[] = [];
  root.querySelectorAll('video').forEach((v) => {
    const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    if (!src || !isSafeMediaUrl(src)) return;
    const subtitles: Track[] = [];
    v.querySelectorAll('track[kind="subtitles"],track[kind="captions"]').forEach((tr) => {
      const s = tr.getAttribute('src');
      if (!s) return;
      subtitles.push({
        url: normalizeURL(s),
        label: tr.getAttribute('label') || tr.getAttribute('srclang') || 'subtitle',
        language: tr.getAttribute('srclang') || '',
        default: tr.hasAttribute('default'),
      });
    });
    out.push({
      url: normalizeURL(src),
      duration: Number.isFinite(v.duration) ? v.duration : undefined,
      subtitles,
    });
  });
  return out;
}

// Elemen player yang sering menyimpan URL media di atribut konfigurasi
// (video.js data-setup, JW Player, dsb.) — dipindai walau video belum diputar.
const PLAYER_SELECTOR =
  'video,source,[data-setup],[data-config],[data-options],[data-sources],[data-plyr],.video-js,[class*="jwplayer"],[id*="player"],[class*="player"]';

/** Pindai nilai atribut elemen player untuk URL media (mis. JSON di data-setup). */
export function scanAttributes(root: ParentNode = document): string[] {
  const found = new Set<string>();
  root.querySelectorAll(PLAYER_SELECTOR).forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const v = attr.value;
      if (!v || v.length > 8000 || v.indexOf('.') === -1) continue;
      for (const m of v.matchAll(MEDIA_URL_REGEX)) {
        const url = normalizeURL(m[0]);
        if (isSafeMediaUrl(url)) found.add(url);
      }
    }
  });
  return Array.from(found);
}

/** Pindai script inline (dibatasi ukuran) untuk URL media. */
export function scanScripts(root: ParentNode = document): string[] {
  const found = new Set<string>();
  root.querySelectorAll('script').forEach((s) => {
    const txt = s.textContent || '';
    if (!txt || txt.length > 50000) return;
    for (const m of txt.matchAll(MEDIA_URL_REGEX)) found.add(normalizeURL(m[0]));
  });
  return Array.from(found);
}

/** Pindai teks halaman untuk kandidat m3u8/mpd (dibatasi ukuran). */
export function scanPageText(root: ParentNode = document.body || document.documentElement): string[] {
  const found = new Set<string>();
  const text = (root as HTMLElement)?.textContent || '';
  const scanText = text.length > 2 * 1024 * 1024 ? text.slice(0, 2 * 1024 * 1024) : text;
  for (const m of scanText.matchAll(MEDIA_URL_REGEX)) found.add(normalizeURL(m[0]));
  return Array.from(found);
}

export function observeDom(onChange: () => void): MutationObserver {
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
  return observer;
}
