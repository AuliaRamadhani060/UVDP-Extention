// Plan unduhan DASH — port dari parseMpd userscript (SegmentTemplate/Timeline/List).
// Memakai DOMParser → jalankan di offscreen (Chromium) / background page (Firefox).
import { normalizeURL } from './url-utils';

export interface DashSegment { url: string; range?: string | null; duration?: number; time?: number; number?: number }
export interface DashTrack {
  type: 'video' | 'audio';
  id: string;
  bandwidth: number;
  width: number;
  height: number;
  resolution: string;
  mimeType: string;
  codecs: string;
  initSegment: DashSegment | null;
  segments: DashSegment[];
  directUrl?: string;
}
export interface DashPlan {
  kind: 'dash' | 'dash-direct';
  videoTrack?: DashTrack | null;
  audioTrack?: DashTrack | null;
  url?: string; // untuk dash-direct
  mimeType: string;
  protected: boolean;
  protectionType: string;
  live: boolean;
  multiPeriod: boolean;
  duration: number | null;
}

function resolveUrl(raw: string, base: string): string {
  try {
    return normalizeURL(new URL(raw, base).href);
  } catch {
    return raw;
  }
}
function directChild(node: Element | null, name: string): Element | null {
  return node ? Array.from(node.children).find((c) => c.localName === name || c.tagName === name) || null : null;
}
function nodeBase(node: Element | null, parentBase: string): string {
  const b = directChild(node, 'BaseURL');
  return b && b.textContent ? resolveUrl(b.textContent.trim(), parentBase) : parentBase;
}

function expandTemplate(template: string, rep: Element | null, number: number, time: number): string {
  const marker = '__UVPD_DOLLAR__';
  return String(template || '')
    .replace(/\$\$/g, marker)
    .replace(/\$Number%0(\d+)d\$/g, (_m, pad) => String(number).padStart(parseInt(pad, 10), '0'))
    .replace(/\$Number\$/g, String(number))
    .replace(/\$Time\$/g, String(time))
    .replace(/\$RepresentationID\$/g, rep ? rep.getAttribute('id') || '' : '')
    .replace(/\$Bandwidth\$/g, rep ? rep.getAttribute('bandwidth') || '' : '')
    .replace(new RegExp(marker, 'g'), '$');
}

export function parseDashPlan(xmlText: string, manifestUrl: string): DashPlan {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('MPD XML invalid');
  const mpd = xml.querySelector('MPD');
  if (!mpd) throw new Error('Elemen MPD tidak ditemukan');

  const durationRaw = mpd.getAttribute('mediaPresentationDuration');
  const dm = durationRaw && durationRaw.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  const totalDuration = dm ? parseInt(dm[1] || '0', 10) * 3600 + parseInt(dm[2] || '0', 10) * 60 + parseFloat(dm[3] || '0') : null;

  const manifestBase = nodeBase(mpd, normalizeURL(manifestUrl));
  const periods = Array.from(mpd.children).filter((n) => n.localName === 'Period' || n.tagName === 'Period');
  const period = periods[0];
  if (!period) throw new Error('Period DASH tidak ditemukan');
  const periodBase = nodeBase(period, manifestBase);
  const adaptationSets = Array.from(period.children).filter((n) => n.localName === 'AdaptationSet' || n.tagName === 'AdaptationSet');

  const setType = (set: Element): 'audio' | 'video' | 'other' => {
    const mime = (set.getAttribute('mimeType') || '').toLowerCase();
    const ct = (set.getAttribute('contentType') || '').toLowerCase();
    const codecs = (set.getAttribute('codecs') || '').toLowerCase();
    if (ct === 'audio' || mime.startsWith('audio/') || /mp4a|aac|opus|vorbis/.test(codecs)) return 'audio';
    if (ct === 'video' || mime.startsWith('video/') || /avc|h26|hevc|vp9|av1/.test(codecs)) return 'video';
    return 'other';
  };
  const pickRep = (set: Element): Element | null => {
    const reps = Array.from(set.children).filter((n) => n.localName === 'Representation' || n.tagName === 'Representation');
    return reps.slice().sort((a, b) => (parseInt(a.getAttribute('bandwidth') || '0', 10) || 0) - (parseInt(b.getAttribute('bandwidth') || '0', 10) || 0)).pop() || reps[0] || null;
  };

  const buildTrack = (set: Element | undefined, type: 'video' | 'audio'): DashTrack | null => {
    if (!set) return null;
    const rep = pickRep(set);
    if (!rep) return null;
    const setBase = nodeBase(set, periodBase);
    const repBase = nodeBase(rep, setBase);
    const track: DashTrack = {
      type,
      id: rep.getAttribute('id') || type,
      bandwidth: parseInt(rep.getAttribute('bandwidth') || '0', 10) || 0,
      width: parseInt(rep.getAttribute('width') || set.getAttribute('width') || '0', 10) || 0,
      height: parseInt(rep.getAttribute('height') || set.getAttribute('height') || '0', 10) || 0,
      resolution: rep.getAttribute('width') && rep.getAttribute('height') ? `${rep.getAttribute('width')}x${rep.getAttribute('height')}` : '',
      mimeType: rep.getAttribute('mimeType') || set.getAttribute('mimeType') || (type === 'audio' ? 'audio/mp4' : 'video/mp4'),
      codecs: rep.getAttribute('codecs') || set.getAttribute('codecs') || '',
      initSegment: null,
      segments: [],
    };

    const template = directChild(rep, 'SegmentTemplate') || directChild(set, 'SegmentTemplate');
    const list = directChild(rep, 'SegmentList') || directChild(set, 'SegmentList');

    if (list) {
      const init = directChild(list, 'Initialization');
      if (init?.getAttribute('sourceURL')) track.initSegment = { url: resolveUrl(init.getAttribute('sourceURL')!, repBase), range: init.getAttribute('range') };
      Array.from(list.children).filter((n) => n.localName === 'SegmentURL' || n.tagName === 'SegmentURL').forEach((n) => {
        if (n.getAttribute('media')) track.segments.push({ url: resolveUrl(n.getAttribute('media')!, repBase), range: n.getAttribute('mediaRange') });
      });
      return track;
    }
    if (!template) { track.directUrl = repBase; return track; }

    const media = template.getAttribute('media') || '';
    const initialization = template.getAttribute('initialization') || '';
    const startNumber = parseInt(template.getAttribute('startNumber') || '1', 10) || 1;
    const timescale = parseInt(template.getAttribute('timescale') || '1', 10) || 1;
    const fixedDuration = parseInt(template.getAttribute('duration') || '0', 10) || 0;
    if (initialization) track.initSegment = { url: resolveUrl(expandTemplate(initialization, rep, startNumber, 0), repBase) };

    const timeline = directChild(template, 'SegmentTimeline');
    let number = startNumber;
    let currentTime = 0;
    if (timeline) {
      const entries = Array.from(timeline.children).filter((n) => n.localName === 'S' || n.tagName === 'S');
      entries.forEach((node, index) => {
        const duration = parseInt(node.getAttribute('d') || '0', 10);
        if (!duration) return;
        if (node.hasAttribute('t')) currentTime = parseInt(node.getAttribute('t')!, 10) || 0;
        let repeat = parseInt(node.getAttribute('r') || '0', 10);
        if (repeat < 0) {
          const next = entries[index + 1];
          const nextTime = next && next.hasAttribute('t') ? parseInt(next.getAttribute('t')!, 10) : NaN;
          if (Number.isFinite(nextTime)) repeat = Math.max(0, Math.ceil((nextTime - currentTime) / duration) - 1);
          else if (totalDuration) repeat = Math.max(0, Math.ceil((totalDuration * timescale - currentTime) / duration) - 1);
          else throw new Error('SegmentTimeline r=-1 tanpa batas durasi');
        }
        for (let k = 0; k <= repeat; k++) {
          track.segments.push({ url: resolveUrl(expandTemplate(media, rep, number, currentTime), repBase), duration: duration / timescale, time: currentTime, number });
          number++;
          currentTime += duration;
          if (track.segments.length > 200000) throw new Error('Jumlah segment DASH melewati batas keamanan');
        }
      });
    } else if (fixedDuration && totalDuration) {
      const count = Math.max(1, Math.ceil(totalDuration / (fixedDuration / timescale)));
      for (let k = 0; k < count; k++) {
        track.segments.push({ url: resolveUrl(expandTemplate(media, rep, number, currentTime), repBase), duration: fixedDuration / timescale, time: currentTime, number });
        number++;
        currentTime += fixedDuration;
      }
    }
    return track;
  };

  const videoTrack = buildTrack(adaptationSets.find((s) => setType(s) === 'video'), 'video');
  const audioTrack = buildTrack(adaptationSets.find((s) => setType(s) === 'audio'), 'audio');
  if (!videoTrack && !audioTrack) throw new Error('Track audio/video DASH tidak ditemukan');

  const contentProtection = xml.querySelector('ContentProtection');
  const live = String(mpd.getAttribute('type') || '').toLowerCase() === 'dynamic';

  if (videoTrack && videoTrack.directUrl && !audioTrack) {
    return { kind: 'dash-direct', url: videoTrack.directUrl, mimeType: videoTrack.mimeType, protected: !!contentProtection, protectionType: '', live, multiPeriod: periods.length > 1, duration: totalDuration };
  }
  return {
    kind: 'dash',
    videoTrack,
    audioTrack,
    mimeType: videoTrack ? videoTrack.mimeType : audioTrack ? audioTrack.mimeType : 'application/octet-stream',
    protected: !!contentProtection,
    protectionType: contentProtection ? contentProtection.getAttribute('schemeIdUri') || 'ContentProtection' : '',
    live,
    multiPeriod: periods.length > 1,
    duration: totalDuration,
  };
}
