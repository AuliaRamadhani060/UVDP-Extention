// Player engine — kelola backend media (native / hls.js / dash.js) di balik satu
// API kecil untuk UI. hls.js/dash.js dibundel lokal (dynamic import), bukan CDN.
import type { MediaItem } from '@/shared/types';
import { mediaKind } from '@/core/media-utils';

export interface QualityOption { index: number; label: string; height?: number; bitrate?: number }
export interface TrackOption { index: number; label: string; lang?: string }
export interface EngineStats { width: number; height: number; bitrate: number; bufferedAhead: number; dropped: number; decoded: number }

export interface PlayerEngine {
  backend: 'native' | 'hls' | 'dash';
  qualities: () => QualityOption[];
  currentQuality: () => number; // -1 = auto
  setQuality: (i: number) => void;
  audioTracks: () => TrackOption[];
  currentAudio: () => number;
  setAudio: (i: number) => void;
  subtitles: () => TrackOption[];
  currentSubtitle: () => number; // -1 = off
  setSubtitle: (i: number) => void;
  stats: () => EngineStats;
  destroy: () => void;
}

interface HlsLevel { height?: number; width?: number; bitrate?: number }
interface HlsTrack { id?: number; name?: string; lang?: string; language?: string }
interface HlsLike {
  levels: HlsLevel[]; currentLevel: number; startLevel: number;
  audioTracks: HlsTrack[]; audioTrack: number;
  subtitleTracks: HlsTrack[]; subtitleTrack: number; subtitleDisplay: boolean;
  loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void;
  on: (e: string, cb: () => void) => void; destroy: () => void;
}
interface DashLike {
  initialize: (v: HTMLVideoElement, src: string, autoplay: boolean) => void;
  getBitrateInfoListFor: (t: string) => Array<{ qualityIndex: number; bitrate: number; width?: number; height?: number }>;
  setQualityFor: (t: string, i: number) => void;
  updateSettings: (s: unknown) => void;
  getTracksFor: (t: string) => Array<{ index?: number; lang?: string; labels?: Array<{ text?: string }> }>;
  setCurrentTrack: (t: unknown) => void;
  setTextTrack: (i: number) => void;
  reset: () => void;
  on: (e: string, cb: () => void) => void;
}

function fmtRes(w?: number, h?: number): string {
  return h ? `${h}p` : w ? `${w}w` : 'Auto';
}

export async function attachEngine(
  video: HTMLVideoElement,
  media: MediaItem,
  onManifest?: () => void,
): Promise<PlayerEngine> {
  const bestUrl = media.bestVariant?.url || media.url;
  const kind = /^blob:/i.test(media.url) ? 'mse' : mediaKind(media);

  // ---- DIRECT / native ----
  if (kind === 'direct' || kind === 'mse') {
    const variants = (media.variants || []).filter((v) => v.url);
    let curIndex = variants.findIndex((v) => v.url === bestUrl);
    if (curIndex < 0) curIndex = variants.length ? variants.length - 1 : -1;
    video.src = bestUrl;
    queueMicrotask(() => onManifest?.());
    return {
      backend: 'native',
      qualities: () => variants.map((v, i) => ({ index: i, label: v.resolution || (v.height ? `${v.height}p` : `v${i + 1}`), height: v.height, bitrate: v.bandwidth })),
      currentQuality: () => curIndex,
      setQuality: (i) => {
        const v = variants[i];
        if (!v?.url) return;
        const t = video.currentTime; const playing = !video.paused;
        curIndex = i; video.src = v.url;
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = t; } catch { /* */ } if (playing) video.play().catch(() => {}); }, { once: true });
      },
      audioTracks: () => nativeAudio(video),
      currentAudio: () => nativeAudioCurrent(video),
      setAudio: (i) => nativeSetAudio(video, i),
      subtitles: () => nativeSubs(video),
      currentSubtitle: () => nativeSubCurrent(video),
      setSubtitle: (i) => nativeSetSub(video, i),
      stats: () => baseStats(video, variants[curIndex]?.bandwidth || 0),
      destroy: () => { video.removeAttribute('src'); video.load(); },
    };
  }

  // ---- HLS ----
  if (kind === 'hls') {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = media.url;
      queueMicrotask(() => onManifest?.());
      return nativeStreamEngine(video, 'hls');
    }
    const Hls = (await import('hls.js')).default;
    if (Hls.isSupported()) {
      const hls = new Hls({ startLevel: -1 }) as unknown as HlsLike;
      hls.loadSource(media.url);
      hls.attachMedia(video);
      const Events = (Hls as unknown as { Events: Record<string, string> }).Events;
      hls.on(Events.MANIFEST_PARSED, () => {
        const top = (hls.levels?.length || 0) - 1;
        if (top >= 0) hls.currentLevel = top; // U0: mulai kualitas tertinggi
        onManifest?.();
      });
      return {
        backend: 'hls',
        qualities: () => hls.levels.map((l, i) => ({ index: i, label: fmtRes(l.width, l.height), height: l.height, bitrate: l.bitrate })),
        currentQuality: () => hls.currentLevel,
        setQuality: (i) => { hls.currentLevel = i; },
        audioTracks: () => hls.audioTracks.map((a, i) => ({ index: i, label: a.name || a.lang || `Audio ${i + 1}`, lang: a.lang })),
        currentAudio: () => hls.audioTrack,
        setAudio: (i) => { hls.audioTrack = i; },
        subtitles: () => hls.subtitleTracks.map((s, i) => ({ index: i, label: s.name || s.lang || `Sub ${i + 1}`, lang: s.lang })),
        currentSubtitle: () => hls.subtitleTrack,
        setSubtitle: (i) => { hls.subtitleTrack = i; hls.subtitleDisplay = i >= 0; },
        stats: () => baseStats(video, hls.levels[hls.currentLevel]?.bitrate || 0),
        destroy: () => hls.destroy(),
      };
    }
    video.src = media.url;
    queueMicrotask(() => onManifest?.());
    return nativeStreamEngine(video, 'hls');
  }

  // ---- DASH ----
  const mod = (await import('dashjs')) as unknown as { MediaPlayer?: () => { create: () => DashLike }; default?: { MediaPlayer: () => { create: () => DashLike } } };
  const factory = mod.MediaPlayer || mod.default?.MediaPlayer;
  const player = factory!().create();
  player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
  player.initialize(video, media.url, false);
  const DashEvents = (mod as unknown as { MediaPlayer: { events?: Record<string, string> } }).MediaPlayer?.events;
  let done = false;
  const finish = () => { if (done) return; done = true;
    const list = player.getBitrateInfoListFor('video');
    if (list.length) player.setQualityFor('video', list.length - 1); // kualitas tertinggi
    onManifest?.();
  };
  if (DashEvents?.STREAM_INITIALIZED) player.on(DashEvents.STREAM_INITIALIZED, finish);
  setTimeout(finish, 1500);
  return {
    backend: 'dash',
    qualities: () => player.getBitrateInfoListFor('video').map((b) => ({ index: b.qualityIndex, label: fmtRes(b.width, b.height), height: b.height, bitrate: b.bitrate })),
    currentQuality: () => { try { return -1; } catch { return -1; } },
    setQuality: (i) => player.setQualityFor('video', i),
    audioTracks: () => (player.getTracksFor('audio') || []).map((tk, i) => ({ index: tk.index ?? i, label: tk.labels?.[0]?.text || tk.lang || `Audio ${i + 1}`, lang: tk.lang })),
    currentAudio: () => -1,
    setAudio: (i) => { const tk = (player.getTracksFor('audio') || [])[i]; if (tk) player.setCurrentTrack(tk); },
    subtitles: () => (player.getTracksFor('text') || []).map((tk, i) => ({ index: i, label: tk.labels?.[0]?.text || tk.lang || `Sub ${i + 1}`, lang: tk.lang })),
    currentSubtitle: () => -1,
    setSubtitle: (i) => player.setTextTrack(i),
    stats: () => baseStats(video, 0),
    destroy: () => { try { player.reset(); } catch { /* */ } },
  };
}

function baseStats(video: HTMLVideoElement, bitrate: number): EngineStats {
  let bufferedAhead = 0;
  try { const b = video.buffered; if (b.length) bufferedAhead = Math.max(0, b.end(b.length - 1) - video.currentTime); } catch { /* */ }
  const q = (video as unknown as { getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number } }).getVideoPlaybackQuality?.();
  return { width: video.videoWidth, height: video.videoHeight, bitrate, bufferedAhead, dropped: q?.droppedVideoFrames || 0, decoded: q?.totalVideoFrames || 0 };
}

function nativeStreamEngine(video: HTMLVideoElement, backend: 'hls' | 'dash'): PlayerEngine {
  return {
    backend,
    qualities: () => [], currentQuality: () => -1, setQuality: () => {},
    audioTracks: () => nativeAudio(video), currentAudio: () => nativeAudioCurrent(video), setAudio: (i) => nativeSetAudio(video, i),
    subtitles: () => nativeSubs(video), currentSubtitle: () => nativeSubCurrent(video), setSubtitle: (i) => nativeSetSub(video, i),
    stats: () => baseStats(video, 0), destroy: () => { video.removeAttribute('src'); video.load(); },
  };
}

// ---- native track helpers ----
interface AudioTrackList { length: number; [i: number]: { enabled: boolean; label?: string; language?: string } }
function nativeAudio(v: HTMLVideoElement): TrackOption[] {
  const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
  if (!list) return [];
  const out: TrackOption[] = [];
  for (let i = 0; i < list.length; i++) out.push({ index: i, label: list[i].label || list[i].language || `Audio ${i + 1}`, lang: list[i].language });
  return out;
}
function nativeAudioCurrent(v: HTMLVideoElement): number {
  const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
  if (!list) return -1;
  for (let i = 0; i < list.length; i++) if (list[i].enabled) return i;
  return -1;
}
function nativeSetAudio(v: HTMLVideoElement, i: number): void {
  const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
  if (!list) return;
  for (let j = 0; j < list.length; j++) list[j].enabled = j === i;
}
function nativeSubs(v: HTMLVideoElement): TrackOption[] {
  const out: TrackOption[] = [];
  const tt = v.textTracks;
  for (let i = 0; i < tt.length; i++) if (tt[i].kind === 'subtitles' || tt[i].kind === 'captions') out.push({ index: i, label: tt[i].label || tt[i].language || `Sub ${i + 1}`, lang: tt[i].language });
  return out;
}
function nativeSubCurrent(v: HTMLVideoElement): number {
  const tt = v.textTracks;
  for (let i = 0; i < tt.length; i++) if (tt[i].mode === 'showing') return i;
  return -1;
}
function nativeSetSub(v: HTMLVideoElement, i: number): void {
  const tt = v.textTracks;
  for (let j = 0; j < tt.length; j++) tt[j].mode = j === i ? 'showing' : 'disabled';
}
