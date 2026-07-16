import { useEffect, useRef, useState } from 'preact/hooks';
import { sendUi } from '@/shared/messaging';
import { t } from '@/i18n';
import { mediaKind, mediaDisplayName } from '@/core/media-utils';
import { Icon } from '@/ui/components/Icons';
import type { MediaItem } from '@/shared/types';
import './player.css';

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

interface DashPlayer {
  initialize: (view: HTMLVideoElement, source: string, autoplay: boolean) => void;
  reset: () => void;
}
interface HlsLevel { height?: number; width?: number; bitrate?: number }
interface HlsLike {
  levels: HlsLevel[];
  currentLevel: number;
  loadSource: (u: string) => void;
  attachMedia: (v: HTMLVideoElement) => void;
  on: (evt: string, cb: () => void) => void;
  destroy: () => void;
}

export function Player({ mediaId }: { mediaId?: string } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const engineRef = useRef<{ destroy: () => void } | null>(null);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(1);
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [hlsLevel, setHlsLevel] = useState(-1); // level HLS terpilih (-1 = auto)
  const [pip, setPip] = useState(false);

  useEffect(() => {
    const id = mediaId || new URLSearchParams(location.search).get('id') || '';
    if (!id) { setMedia(null); return; }
    setError('');
    sendUi<MediaItem | undefined>({ type: 'GET_MEDIA', payload: { id } }).then((m) => {
      if (!m) setError('Media tidak ditemukan');
      else setMedia(m);
    });
  }, [mediaId]);

  useEffect(() => {
    if (!media || !videoRef.current) return;
    const video = videoRef.current;
    let disposed = false;

    (async () => {
      try {
        engineRef.current?.destroy();
        engineRef.current = null;
        hlsRef.current = null;
        setLevels([]);
        setHlsLevel(-1);
        const kind = mediaKind(media);
        // Bug fix U0: muat kualitas TERBAIK (bestVariant), bukan media.url apa adanya.
        const bestUrl = media.bestVariant?.url || media.url;

        if (kind === 'direct') {
          video.src = bestUrl;
        } else if (kind === 'hls') {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = media.url; // Safari / native HLS
          } else {
            const Hls = (await import('hls.js')).default;
            if (Hls.isSupported()) {
              const hls = new Hls() as unknown as HlsLike;
              hls.loadSource(media.url);
              hls.attachMedia(video);
              hls.on((Hls as unknown as { Events: { MANIFEST_PARSED: string } }).Events.MANIFEST_PARSED, () => {
                if (disposed) return;
                setLevels(hls.levels || []);
                // Bug fix U0: mulai di level TERTINGGI (bukan ABR mulai rendah).
                const top = (hls.levels?.length || 0) - 1;
                if (top >= 0) { hls.currentLevel = top; setHlsLevel(top); }
              });
              hlsRef.current = hls;
              engineRef.current = { destroy: () => hls.destroy() };
            } else {
              video.src = media.url;
            }
          }
        } else if (kind === 'dash') {
          const mod = (await import('dashjs')) as unknown as {
            MediaPlayer?: () => { create: () => DashPlayer };
            default?: { MediaPlayer: () => { create: () => DashPlayer } };
          };
          const factory = mod.MediaPlayer || mod.default?.MediaPlayer;
          if (!factory) throw new Error('dashjs tidak tersedia');
          const player = factory().create();
          player.initialize(video, media.url, false);
          engineRef.current = { destroy: () => player.reset() };
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      engineRef.current?.destroy();
      engineRef.current = null;
      hlsRef.current = null;
    };
  }, [media]);

  function changeSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }
  function changeLevel(index: number) {
    setHlsLevel(index);
    if (hlsRef.current) hlsRef.current.currentLevel = index; // -1 = auto
  }
  // Pindah kualitas untuk file direct multi-varian: tukar src, pertahankan posisi.
  function switchVariant(url: string) {
    const v = videoRef.current;
    if (!v || !url) return;
    const t = v.currentTime;
    const wasPlaying = !v.paused;
    v.src = url;
    v.addEventListener('loadedmetadata', () => {
      try { v.currentTime = t; } catch { /* noop */ }
      if (wasPlaying) v.play().catch(() => {});
    }, { once: true });
  }
  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); setPip(false); }
      else { await video.requestPictureInPicture(); setPip(true); }
    } catch { /* tak didukung */ }
  }

  const subtitles = media?.subtitles || [];
  // Varian kualitas untuk file direct (mp4 per-kualitas). Untuk HLS pakai levels hls.js.
  const directVariants = media && mediaKind(media) === 'direct' ? (media.variants || []).filter((v) => v.url) : [];

  return (
    <div class="player">
      <div class="player__stage">
        <video ref={videoRef} controls autoplay playsinline crossorigin="anonymous">
          {subtitles.map((s, i) => (
            <track key={i} kind="subtitles" src={s.url} srclang={s.language || 'und'} label={s.label || s.language || `Sub ${i + 1}`} default={s.default} />
          ))}
        </video>
      </div>
      <div class="player__bar">
        <span class="player__title">{media ? mediaDisplayName(media) : t('media.play')}</span>
        <div class="player__controls">
          <label class="ctl">
            {t('sort.quality')}
            {levels.length > 0 ? (
              // HLS: ganti level via hls.js (default = tertinggi, lihat MANIFEST_PARSED).
              <select value={hlsLevel} onChange={(e) => changeLevel(Number((e.target as HTMLSelectElement).value))}>
                <option value={-1}>Auto</option>
                {levels.map((l, i) => (
                  <option key={i} value={i}>{l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)}k`}</option>
                ))}
              </select>
            ) : directVariants.length > 1 ? (
              // File direct per-kualitas: tukar sumber.
              <select value={media?.bestVariant?.url} onChange={(e) => switchVariant((e.target as HTMLSelectElement).value)}>
                {directVariants.slice().reverse().map((v, i) => (
                  <option key={i} value={v.url}>{v.resolution || `${v.height || ''}p`}</option>
                ))}
              </select>
            ) : (
              <select disabled><option>—</option></select>
            )}
          </label>
          <label class="ctl">
            {speed}×
            <select value={speed} onChange={(e) => changeSpeed(Number((e.target as HTMLSelectElement).value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <button class="pipbtn" onClick={togglePip} title="Picture-in-Picture" aria-pressed={pip}>PiP</button>
        </div>
      </div>
      {error && <div class="player__error"><Icon.shield size={14} /> {error}</div>}
    </div>
  );
}
