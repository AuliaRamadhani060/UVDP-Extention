// Parser HLS (m3u8) — port penuh dari processPlaylist userscript.
import type { QualityVariant, Track } from '@/shared/types';
import { normalizeURL } from './url-utils';
import { parseFrameRate, parseResolutionLabel } from './quality';

export interface HlsResult {
  isMaster: boolean;
  playlistType: 'master' | 'media';
  variants: QualityVariant[];
  audioTracks: Track[];
  subtitles: Track[];
  encrypted: boolean;
  protected: boolean;
  protectionType: string;
}

export function isM3U8Content(text: string): boolean {
  return String(text ?? '').trimStart().startsWith('#EXTM3U');
}

/** Parse attribute-list HLS: KEY=VALUE,KEY="VALUE". */
export function parseAttributeList(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  String(text ?? '')
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .forEach((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return;
      const key = part.slice(0, index).trim();
      let value = part.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      attrs[key] = value;
    });
  return attrs;
}

export function parseHls(text: string, manifestUrl: string): HlsResult {
  const url = normalizeURL(manifestUrl);
  const lines = text.split(/\r?\n/);
  const isMaster = lines.some((l) => /^#EXT-X-STREAM-INF/i.test(l));

  const keyLines = lines.filter((l) => /^#EXT-X-KEY:/i.test(l));
  const keyAttrs = keyLines.map((line) => parseAttributeList(line.slice(line.indexOf(':') + 1)));
  const protection = keyAttrs.find(
    (a) => /SAMPLE-AES/i.test(a.METHOD || '') || (a.KEYFORMAT && a.KEYFORMAT !== 'identity'),
  );
  const encrypted = keyAttrs.some((a) => a.METHOD && a.METHOD !== 'NONE');
  const protectionType = protection ? protection.METHOD || protection.KEYFORMAT || 'SAMPLE-AES' : '';

  const variants: QualityVariant[] = [];
  const audioTracks: Track[] = [];
  const subtitles: Track[] = [];

  if (isMaster) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#EXT-X-STREAM-INF/i.test(line)) {
        const info = parseAttributeList(line.slice(line.indexOf(':') + 1));
        let uri: string | null = null;
        for (let next = i + 1; next < lines.length; next++) {
          const candidate = lines[next].trim();
          if (!candidate) continue;
          if (!candidate.startsWith('#')) uri = candidate;
          break;
        }
        if (uri) {
          const [wRaw, hRaw] = (info.RESOLUTION || '').split('x');
          const width = wRaw && hRaw ? parseInt(wRaw, 10) : undefined;
          const height = wRaw && hRaw ? parseInt(hRaw, 10) : undefined;
          variants.push({
            url: normalizeURL(new URL(uri, url).href),
            bandwidth: info.BANDWIDTH
              ? parseInt(info.BANDWIDTH, 10)
              : info['AVERAGE-BANDWIDTH']
                ? parseInt(info['AVERAGE-BANDWIDTH'], 10)
                : undefined,
            averageBandwidth: info['AVERAGE-BANDWIDTH']
              ? parseInt(info['AVERAGE-BANDWIDTH'], 10)
              : undefined,
            width,
            height,
            resolution: info.RESOLUTION || parseResolutionLabel(width, height),
            codecs: info.CODECS || '',
            codecLabel: info.CODECS || '',
            frameRate: parseFrameRate(info['FRAME-RATE']),
          });
        }
      } else if (/^#EXT-X-MEDIA:/i.test(line)) {
        const info = parseAttributeList(line.slice(line.indexOf(':') + 1));
        if (!info.URI) continue;
        const track: Track = {
          url: normalizeURL(new URL(info.URI, url).href),
          label: info.NAME || info.LANGUAGE || info.TYPE || 'track',
          language: info.LANGUAGE || '',
          groupId: info['GROUP-ID'] || '',
          default: String(info.DEFAULT || '').toUpperCase() === 'YES',
        };
        if (String(info.TYPE || '').toUpperCase() === 'AUDIO') audioTracks.push(track);
        if (/SUBTITLES|CLOSED-CAPTIONS/i.test(info.TYPE || '')) subtitles.push(track);
      }
    }
  }

  return {
    isMaster,
    playlistType: isMaster ? 'master' : 'media',
    variants,
    audioTracks,
    subtitles,
    encrypted,
    protected: !!protection,
    protectionType,
  };
}

/** Ambil daftar URL segmen absolut dari media playlist (untuk unduhan tersegmentasi). */
export function parseHlsSegments(text: string, manifestUrl: string): { segments: string[]; encrypted: boolean } {
  const url = normalizeURL(manifestUrl);
  const segments: string[] = [];
  let encrypted = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXT-X-KEY:/i.test(line)) {
      const a = parseAttributeList(line.slice(line.indexOf(':') + 1));
      if (a.METHOD && a.METHOD.toUpperCase() !== 'NONE') encrypted = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push(normalizeURL(new URL(line, url).href));
  }
  return { segments, encrypted };
}
