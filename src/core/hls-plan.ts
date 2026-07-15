// Plan unduhan HLS media playlist — port dari parseMediaPlaylist userscript.
import { normalizeURL } from './url-utils';
import { parseAttributeList } from './hls-parser';
import type { HlsKeyInfo } from './segment-crypto';

export interface HlsSegment {
  url: string;
  duration: number | null;
  range: string | null; // 'start-end'
  sequence: number;
  discontinuity: boolean;
  key: HlsKeyInfo | null;
}

export interface HlsMediaPlan {
  kind: 'media';
  segments: HlsSegment[];
  initSegment: { url: string; range: string | null; key: HlsKeyInfo | null } | null;
  mediaSequence: number;
  live: boolean;
  encrypted: boolean;
  protected: boolean;
  protectionType: string;
  playlistUrl: string;
  container: 'mp4' | 'aac' | 'ts';
  duration: number;
}

export function parseHlsMediaPlan(text: string, manifestUrl: string): HlsMediaPlan {
  const baseUrl = normalizeURL(manifestUrl);
  const lines = text.split(/\r?\n/);
  const segments: HlsSegment[] = [];
  let pendingDuration: number | null = null;
  let initSegment: HlsMediaPlan['initSegment'] = null;
  let byteRange: string | null = null;
  let currentKey: HlsKeyInfo | null = null;
  let mediaSequence = 0;
  let sequence = 0;
  let discontinuity = false;
  const nextOffsets = new Map<string, number>();

  const resolveRange = (rawRange: string | null, resourceUrl: string): string | null => {
    if (!rawRange) return null;
    const m = String(rawRange).trim().match(/^(\d+)(?:@(\d+))?$/);
    if (!m) throw new Error('EXT-X-BYTERANGE invalid: ' + rawRange);
    const length = parseInt(m[1], 10);
    const start = m[2] !== undefined ? parseInt(m[2], 10) : nextOffsets.get(resourceUrl) || 0;
    const end = start + length - 1;
    nextOffsets.set(resourceUrl, end + 1);
    return start + '-' + end;
  };

  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw === '#EXTM3U') continue;
    if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(raw)) {
      mediaSequence = parseInt(raw.slice(raw.indexOf(':') + 1), 10) || 0;
      sequence = mediaSequence;
      continue;
    }
    if (/^#EXT-X-KEY:/i.test(raw)) {
      const attrs = parseAttributeList(raw.slice(raw.indexOf(':') + 1));
      const method = String(attrs.METHOD || 'NONE').toUpperCase();
      currentKey = method === 'NONE' ? null : {
        method,
        url: attrs.URI ? normalizeURL(new URL(attrs.URI, baseUrl).href) : '',
        iv: attrs.IV || '',
        keyFormat: attrs.KEYFORMAT || 'identity',
      };
      continue;
    }
    if (/^#EXT-X-MAP:/i.test(raw)) {
      const attrs = parseAttributeList(raw.slice(raw.indexOf(':') + 1));
      if (attrs.URI) {
        const mapUrl = normalizeURL(new URL(attrs.URI, baseUrl).href);
        initSegment = {
          url: mapUrl,
          range: resolveRange(attrs.BYTERANGE || null, mapUrl),
          key: currentKey ? { ...currentKey, sequence } : null,
        };
      }
      continue;
    }
    if (/^#EXT-X-BYTERANGE:/i.test(raw)) { byteRange = raw.split(':', 2)[1] || ''; continue; }
    if (/^#EXTINF:/i.test(raw)) { pendingDuration = parseFloat((raw.split(':', 2)[1] || '0').split(',')[0]) || null; continue; }
    if (/^#EXT-X-DISCONTINUITY/i.test(raw)) { discontinuity = true; continue; }
    if (raw.startsWith('#')) continue;

    const segmentUrl = normalizeURL(new URL(raw, baseUrl).href);
    segments.push({
      url: segmentUrl,
      duration: pendingDuration,
      range: resolveRange(byteRange, segmentUrl),
      sequence,
      discontinuity,
      key: currentKey ? { ...currentKey, sequence } : null,
    });
    sequence++;
    pendingDuration = null;
    byteRange = null;
    discontinuity = false;
  }

  const protectedKey = segments
    .map((s) => s.key)
    .filter((k): k is HlsKeyInfo => !!k)
    .find((k) => k.method !== 'AES-128' || (k.keyFormat && k.keyFormat !== 'identity'));

  const container: HlsMediaPlan['container'] =
    initSegment || segments.some((s) => /\.(?:m4s|mp4)(?:$|[?#])/i.test(s.url))
      ? 'mp4'
      : segments.every((s) => /\.aac(?:$|[?#])/i.test(s.url))
        ? 'aac'
        : 'ts';

  return {
    kind: 'media',
    segments,
    initSegment,
    mediaSequence,
    live: !lines.some((l) => /^#EXT-X-ENDLIST/i.test(l)),
    encrypted: segments.some((s) => !!s.key),
    protected: !!protectedKey,
    protectionType: protectedKey ? protectedKey.method || protectedKey.keyFormat || '' : '',
    playlistUrl: baseUrl,
    container,
    duration: segments.reduce((sum, s) => sum + (Number(s.duration) || 0), 0),
  };
}
