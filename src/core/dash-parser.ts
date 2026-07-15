// Parser DASH (MPD) — port penuh dari processDashManifest userscript.
// Mengekstrak varian video, trek audio, subtitle, dan deteksi ContentProtection.
import type { QualityVariant, Track } from '@/shared/types';
import { normalizeURL } from './url-utils';
import { parseFrameRate, parseResolutionLabel } from './quality';

export interface DashResult {
  variants: QualityVariant[];
  audioTracks: Track[];
  subtitles: Track[];
  protected: boolean;
  protectionType: string;
  baseUrl: string;
}

function directChild(el: Element, tag: string): Element | undefined {
  return Array.from(el.children).find((n) => n.tagName === tag);
}

function resolveBase(el: Element, parentBase: string): string {
  const node = directChild(el, 'BaseURL');
  const text = node?.textContent?.trim();
  return text ? normalizeURL(new URL(text, parentBase).href) : parentBase;
}

export function parseDash(xmlText: string, manifestUrl: string): DashResult {
  const url = normalizeURL(manifestUrl);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid MPD XML');

  const baseUrl = resolveBase(doc.documentElement, url);
  const contentProtection = doc.querySelector('ContentProtection');

  const variants: QualityVariant[] = [];
  const audioTracks: Track[] = [];
  const subtitles: Track[] = [];
  const seen = new Set<string>();

  doc.querySelectorAll('AdaptationSet').forEach((set) => {
    const setBase = resolveBase(set, baseUrl);
    const setMime = (set.getAttribute('mimeType') || '').toLowerCase();
    const setCodecs = set.getAttribute('codecs') || '';
    const setLang = set.getAttribute('lang') || set.getAttribute('language') || '';
    const setId = set.getAttribute('id') || '';
    const contentType = (set.getAttribute('contentType') || '').toLowerCase();
    const roles = Array.from(set.querySelectorAll(':scope > Role')).map((r) =>
      (r.getAttribute('value') || '').toLowerCase(),
    );
    const label = set.getAttribute('label') || setLang || setId || '';

    const isVideo = contentType === 'video' || setMime.startsWith('video/') || /avc|h26|hevc|vp8|vp9|av1/.test(setCodecs.toLowerCase());
    const isAudio = contentType === 'audio' || setMime.startsWith('audio/');
    const isText = contentType === 'text' || setMime.startsWith('text/') || roles.some((v) => /subtitle|caption|text/.test(v));

    if (isVideo) {
      Array.from(set.children)
        .filter((n) => n.tagName === 'Representation')
        .forEach((rep) => {
          const repBase = resolveBase(rep, setBase);
          const bandwidth = rep.getAttribute('bandwidth');
          const avgBandwidth = rep.getAttribute('averageBandwidth') || rep.getAttribute('avgBandwidth');
          const width = rep.getAttribute('width');
          const height = rep.getAttribute('height');
          const repCodecs = rep.getAttribute('codecs') || setCodecs;
          const key = [repBase, bandwidth || '', width || '', height || '', repCodecs].join('|');
          if (seen.has(key)) return;
          seen.add(key);
          variants.push({
            url: repBase,
            bandwidth: bandwidth ? parseInt(bandwidth, 10) : avgBandwidth ? parseInt(avgBandwidth, 10) : undefined,
            averageBandwidth: avgBandwidth ? parseInt(avgBandwidth, 10) : undefined,
            width: width ? parseInt(width, 10) : undefined,
            height: height ? parseInt(height, 10) : undefined,
            resolution: parseResolutionLabel(
              width ? parseInt(width, 10) : undefined,
              height ? parseInt(height, 10) : undefined,
            ),
            codecs: repCodecs,
            codecLabel: repCodecs,
            frameRate: parseFrameRate(rep.getAttribute('frameRate') || set.getAttribute('frameRate') || undefined),
            mimeType: (rep.getAttribute('mimeType') || setMime).toLowerCase(),
            dash: true,
          });
        });
    } else if (isAudio) {
      const rep = directChild(set, 'Representation');
      audioTracks.push({
        url: rep ? resolveBase(rep, setBase) : setBase,
        label: label || `Audio ${audioTracks.length + 1}`,
        language: setLang,
        codecs: (rep?.getAttribute('codecs')) || setCodecs,
        mimeType: setMime || 'audio/*',
        default: set.hasAttribute('default') || roles.includes('main'),
      });
    } else if (isText) {
      const rep = directChild(set, 'Representation');
      subtitles.push({
        url: rep ? resolveBase(rep, setBase) : setBase,
        label: label || `Subtitle ${subtitles.length + 1}`,
        language: setLang,
        codecs: (rep?.getAttribute('codecs')) || setCodecs,
        mimeType: setMime || 'text/*',
        default: set.hasAttribute('default') || roles.includes('subtitle'),
      });
    }
  });

  return {
    variants,
    audioTracks,
    subtitles,
    protected: !!contentProtection,
    protectionType: contentProtection ? contentProtection.getAttribute('schemeIdUri') || 'ContentProtection' : '',
    baseUrl,
  };
}
