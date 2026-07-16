// Player pro (U3) — kontrol kustom di atas <video> + engine native/hls.js/dash.js.
// Fitur: scrubber+buffer+hover-preview, pilih kualitas/audio/subtitle, kecepatan,
// PiP, fit/fill, hotkey penuh + help, auto-hide, ambil frame→PNG, A–B loop,
// frame-step, overlay statistik, ingat volume/kecepatan/posisi per-situs.
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Rewind, FastForward, Volume2, Volume1, VolumeX,
  Settings2, AudioLines, Subtitles, Camera, Repeat, StepBack, StepForward,
  Activity, Keyboard, PictureInPicture2, Scan, Maximize, Minimize, ShieldAlert, Check,
} from 'lucide-react';
import { sendUi } from '@/shared/messaging';
import { t } from '@/i18n';
import { smartName, viewKind, kindLabel, kindColorVar } from '@/ui/lib/media-view';
import { attachEngine, type PlayerEngine, type QualityOption, type TrackOption, type EngineStats } from './engine';
import { hostOf, getHostPref, getPosition, saveHostPref, savePosition } from './player-persist';
import type { MediaItem } from '@/shared/types';
import './player.css';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
type MenuKind = '' | 'quality' | 'audio' | 'subs' | 'speed';

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
}

export function Player({ mediaId }: { mediaId?: string } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const abRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const scrubbingRef = useRef(false);
  const hideTimerRef = useRef<number>(0);
  const lastSaveRef = useRef(0);
  const resumeRef = useRef<number | null>(null);
  const resumedRef = useRef(false);
  const previewReadyRef = useRef(false);

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [backend, setBackend] = useState<'native' | 'hls' | 'dash' | ''>('');

  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [pip, setPip] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [menu, setMenu] = useState<MenuKind>('');
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [curQuality, setCurQuality] = useState(-1);
  const [audios, setAudios] = useState<TrackOption[]>([]);
  const [curAudio, setCurAudio] = useState(-1);
  const [subs, setSubs] = useState<TrackOption[]>([]);
  const [curSub, setCurSub] = useState(-1);

  const [ab, setAb] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [preview, setPreview] = useState<{ show: boolean; x: number; time: number }>({ show: false, x: 0, time: 0 });

  useEffect(() => { abRef.current = ab; }, [ab]);

  const flashMsg = useCallback((m: string) => { setFlash(m); window.setTimeout(() => setFlash((f) => (f === m ? '' : f)), 1400); }, []);

  const refreshTracks = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    setQualities(eng.qualities());
    setCurQuality(eng.currentQuality());
    setAudios(eng.audioTracks());
    setCurAudio(eng.currentAudio());
    setSubs(eng.subtitles());
    setCurSub(eng.currentSubtitle());
  }, []);

  // ---- muat media ----
  useEffect(() => {
    const id = mediaId || new URLSearchParams(location.search).get('id') || '';
    if (!id) { setMedia(null); setError(t('empty.none')); return; }
    setError('');
    sendUi<MediaItem | undefined>({ type: 'GET_MEDIA', payload: { id } }).then((m) => {
      if (!m) setError(t('empty.none')); else setMedia(m);
    });
  }, [mediaId]);

  // ---- pasang engine + wiring event ----
  useEffect(() => {
    const video = videoRef.current;
    if (!media || !video) return;
    if (media.protected) { setError(t('media.protected')); return; } // DRM: tak pernah diputar

    let disposed = false;
    resumedRef.current = false;
    previewReadyRef.current = false;
    setBackend('');
    setQualities([]); setAudios([]); setSubs([]);
    setAb({ a: null, b: null });
    setCurTime(0); setDuration(0); setBufferedEnd(0);

    const host = hostOf(media.pageUrl || media.url);

    const maybeResume = () => {
      if (resumedRef.current) return;
      if (video.readyState < 1) return; // tunggu metadata sebelum seek
      const d = video.duration;
      const pos = resumeRef.current;
      if (pos != null && pos > 5 && (!isFinite(d) || pos < d - 10)) { try { video.currentTime = pos; } catch { /* */ } }
      resumedRef.current = true;
    };

    const onTime = () => {
      if (!scrubbingRef.current) setCurTime(video.currentTime);
      const { a, b } = abRef.current;
      if (a != null && b != null && video.currentTime >= b) { try { video.currentTime = a; } catch { /* */ } }
      const now = Date.now();
      if (now - lastSaveRef.current > 5000) { lastSaveRef.current = now; savePosition(media.id, video.currentTime); }
    };
    const onDur = () => setDuration(video.duration || 0);
    const onProg = () => { try { const bf = video.buffered; setBufferedEnd(bf.length ? bf.end(bf.length - 1) : 0); } catch { /* */ } };
    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); savePosition(media.id, video.currentTime); };
    const onVol = () => { setVolume(video.volume); setMuted(video.muted); };
    const onRate = () => setSpeed(video.playbackRate);
    const onLoaded = () => { setDuration(video.duration || 0); refreshTracks(); maybeResume(); };
    const onEnterPip = () => setPip(true);
    const onLeavePip = () => setPip(false);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDur);
    video.addEventListener('progress', onProg);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVol);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);

    (async () => {
      try {
        // pulihkan preferensi per-situs + posisi tonton
        const [pref, pos] = await Promise.all([getHostPref(host), getPosition(media.id)]);
        resumeRef.current = pos ?? null;
        if (pref) {
          video.volume = pref.volume; video.muted = pref.muted; video.playbackRate = pref.speed;
          setVolume(pref.volume); setMuted(pref.muted); setSpeed(pref.speed);
        }
        if (disposed) return;
        // Dipanggil saat manifest siap. Untuk direct/native ini terpicu via microtask
        // SEBELUM `eng` di-assign — jadi baca dari engineRef, jangan dari `eng`.
        const onManifestReady = () => {
          if (disposed || !engineRef.current) return;
          setBackend(engineRef.current.backend);
          refreshTracks();
          maybeResume();
          video.playbackRate = pref?.speed ?? 1;
        };
        const eng = await attachEngine(video, media, onManifestReady);
        if (disposed) { eng.destroy(); return; }
        engineRef.current = eng;
        setBackend(eng.backend);
        refreshTracks();
        maybeResume();
        if (pref) video.playbackRate = pref.speed;
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      savePosition(media.id, video.currentTime);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDur);
      video.removeEventListener('progress', onProg);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVol);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [media, refreshTracks]);

  // ---- overlay statistik ----
  useEffect(() => {
    if (!showStats) return;
    const tick = () => { if (engineRef.current) setStats(engineRef.current.stats()); };
    tick();
    const iv = window.setInterval(tick, 700);
    return () => window.clearInterval(iv);
  }, [showStats]);

  // ---- fullscreen sinkron ----
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---- simpan posisi saat keluar ----
  useEffect(() => {
    const onUnload = () => { const v = videoRef.current; if (media && v) savePosition(media.id, v.currentTime); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [media]);

  // ---- kontrol ----
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);
  const seekBy = useCallback((d: number) => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime + d); }, []);
  const setVol = useCallback((val: number) => {
    const v = videoRef.current; if (!v) return;
    v.volume = Math.min(1, Math.max(0, val)); v.muted = v.volume === 0;
  }, []);
  const toggleMute = useCallback(() => { const v = videoRef.current; if (v) v.muted = !v.muted; }, []);
  const changeSpeed = useCallback((s: number) => { const v = videoRef.current; if (v) v.playbackRate = s; setMenu(''); }, []);
  const frameStep = useCallback((dir: number) => { const v = videoRef.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, v.currentTime + dir / 30); }, []);

  // persist preferensi per-situs saat volume/kecepatan berubah
  useEffect(() => {
    if (!media) return;
    const id = window.setTimeout(() => { saveHostPref(hostOf(media.pageUrl || media.url), { volume, muted, speed }); }, 400);
    return () => window.clearTimeout(id);
  }, [media, volume, muted, speed]);

  const togglePip = useCallback(async () => {
    const v = videoRef.current; if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* tak didukung */ }
  }, []);
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current; if (!el) return;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); } catch { /* */ }
  }, []);

  const screenshot = useCallback(() => {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d'); if (!ctx) return;
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        const base = media ? smartName(media).replace(/[^\w.-]+/g, '_').slice(0, 60) : 'frame';
        a.download = `${base}_${Math.floor(v.currentTime)}s.png`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
      flashMsg(t('player.screenshotOk'));
    } catch { flashMsg(t('player.screenshotBlocked')); }
  }, [media, flashMsg]);

  const cycleLoop = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    setAb((cur) => {
      if (cur.a == null) { flashMsg(t('player.loopA')); return { a: v.currentTime, b: null }; }
      if (cur.b == null) {
        if (v.currentTime <= cur.a) { flashMsg(t('player.loopA')); return { a: v.currentTime, b: null }; }
        flashMsg(t('player.loopB')); return { a: cur.a, b: v.currentTime };
      }
      flashMsg(t('player.loopClear')); return { a: null, b: null };
    });
  }, [flashMsg]);
  const setLoopPoint = useCallback((which: 'a' | 'b') => {
    const v = videoRef.current; if (!v) return;
    setAb((cur) => {
      if (which === 'a') { flashMsg(t('player.loopA')); return { a: v.currentTime, b: cur.b != null && cur.b > v.currentTime ? cur.b : null }; }
      if (cur.a == null || v.currentTime <= cur.a) { flashMsg(t('player.loopA')); return { a: v.currentTime, b: null }; }
      flashMsg(t('player.loopB')); return { a: cur.a, b: v.currentTime };
    });
  }, [flashMsg]);

  const cycleSubtitle = useCallback(() => {
    const eng = engineRef.current; if (!eng) return;
    const list = eng.subtitles(); if (!list.length) return;
    const cur = eng.currentSubtitle();
    const next = cur < 0 ? list[0].index : (list.findIndex((s) => s.index === cur) + 1 >= list.length ? -1 : list[list.findIndex((s) => s.index === cur) + 1].index);
    eng.setSubtitle(next); setCurSub(next);
  }, []);

  // ---- hotkey ----
  useEffect(() => {
    if (!media || media.protected) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      let handled = true;
      switch (e.key) {
        case ' ': case 'k': togglePlay(); break;
        case 'ArrowLeft': seekBy(-5); break;
        case 'ArrowRight': seekBy(5); break;
        case 'j': seekBy(-10); break;
        case 'l': seekBy(10); break;
        case 'ArrowUp': setVol((videoRef.current?.volume ?? 1) + 0.05); break;
        case 'ArrowDown': setVol((videoRef.current?.volume ?? 1) - 0.05); break;
        case 'm': toggleMute(); break;
        case 'f': toggleFullscreen(); break;
        case 'p': togglePip(); break;
        case 'c': cycleSubtitle(); break;
        case ',': frameStep(-1); break;
        case '.': frameStep(1); break;
        case '<': changeSpeed(Math.max(0.25, (videoRef.current?.playbackRate ?? 1) - 0.25)); break;
        case '>': changeSpeed(Math.min(2, (videoRef.current?.playbackRate ?? 1) + 0.25)); break;
        case 'a': setLoopPoint('a'); break;
        case 'b': setLoopPoint('b'); break;
        case 'u': setAb({ a: null, b: null }); flashMsg(t('player.loopClear')); break;
        case 's': screenshot(); break;
        case 'd': setShowStats((s) => !s); break;
        case '?': setShowHelp((s) => !s); break;
        case 'Escape': setShowHelp(false); setMenu(''); break;
        default:
          if (/^[0-9]$/.test(e.key)) { const v = videoRef.current; if (v && isFinite(v.duration)) v.currentTime = (Number(e.key) / 10) * v.duration; }
          else handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media, togglePlay, seekBy, setVol, toggleMute, toggleFullscreen, togglePip, cycleSubtitle, frameStep, changeSpeed, setLoopPoint, screenshot, flashMsg]);

  // ---- auto-hide kontrol ----
  const nudge = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !menu && !showHelp) setControlsVisible(false);
    }, 2600);
  }, [menu, showHelp]);
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  // ---- scrubber ----
  const ratioAt = (clientX: number): number => {
    const el = seekRef.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const seekToClient = (clientX: number) => { const v = videoRef.current; if (!v || !isFinite(v.duration) || !v.duration) return; const time = ratioAt(clientX) * v.duration; v.currentTime = time; setCurTime(time); };
  const onSeekDown = (e: { clientX: number }) => {
    if (!isFinite(duration) || !duration) return;
    scrubbingRef.current = true;
    seekToClient(e.clientX);
    const move = (ev: PointerEvent) => seekToClient(ev.clientX);
    const up = () => { scrubbingRef.current = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const drawPreview = (time: number) => {
    const pv = previewVideoRef.current, cv = previewCanvasRef.current;
    if (!pv || !cv || !previewReadyRef.current) return;
    const draw = () => { const ctx = cv.getContext('2d'); if (ctx) { try { ctx.drawImage(pv, 0, 0, cv.width, cv.height); } catch { /* */ } } };
    pv.addEventListener('seeked', draw, { once: true });
    try { pv.currentTime = time; } catch { /* */ }
  };
  const onSeekHover = (e: { clientX: number }) => {
    const el = seekRef.current; if (!el || !isFinite(duration) || !duration) return;
    const r = el.getBoundingClientRect();
    const ratio = ratioAt(e.clientX);
    const time = ratio * duration;
    setPreview({ show: true, x: ratio * r.width, time });
    drawPreview(time);
  };

  const openMenu = (k: MenuKind) => { refreshTracks(); setMenu((cur) => (cur === k ? '' : k)); };
  const pickQuality = (i: number) => { engineRef.current?.setQuality(i); setCurQuality(i); setMenu(''); window.setTimeout(refreshTracks, 300); };
  const pickAudio = (i: number) => { engineRef.current?.setAudio(i); setCurAudio(i); setMenu(''); };
  const pickSub = (i: number) => { engineRef.current?.setSubtitle(i); setCurSub(i); setMenu(''); };

  // ---- turunan render ----
  const durOk = isFinite(duration) && duration > 0;
  const pct = durOk ? (curTime / duration) * 100 : 0;
  const bufPct = durOk ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const title = media ? smartName(media) : t('media.play');
  const kind = media ? viewKind(media) : 'direct';
  const previewSrc = backend === 'native' && media?.bestVariant?.url && !/^blob:/i.test(media.url) ? (media.bestVariant.url || media.url) : '';
  const curQualityLabel = (() => {
    if (backend === 'native') { const q = qualities[curQuality]; return q ? q.label : '—'; }
    if (curQuality < 0) return t('player.auto');
    const q = qualities.find((x) => x.index === curQuality); return q ? q.label : t('player.auto');
  })();

  if (error) {
    return (
      <div class="pp" ref={containerRef} data-fit={fit}>
        <div class="pp__error"><div><ShieldAlert size={16} /> {error}</div></div>
      </div>
    );
  }

  return (
    <div
      class={`pp${controlsVisible ? '' : ' pp--hide'}`}
      ref={containerRef}
      data-fit={fit}
      data-cursor={controlsVisible ? 'shown' : 'hidden'}
      onMouseMove={nudge}
      onMouseLeave={() => { if (videoRef.current && !videoRef.current.paused && !menu && !showHelp) setControlsVisible(false); }}
    >
      <div class="pp__stage" onClick={togglePlay} onDblClick={toggleFullscreen}>
        <video ref={videoRef} autoplay playsinline crossorigin="anonymous" />
        {previewSrc && (
          <video ref={previewVideoRef} src={previewSrc} muted preload="auto" crossorigin="anonymous"
            style={{ display: 'none' }} onLoadedMetadata={() => { previewReadyRef.current = true; }} />
        )}
      </div>

      {/* judul atas */}
      <div class="pp__top">
        <span class="pp__badge" style={{ color: kindColorVar(kind) }}>{kindLabel(kind)}</span>
        <span class="pp__title">{title}</span>
      </div>

      {/* tombol play tengah saat jeda */}
      {!playing && (
        <div class="pp__center">
          <button onClick={togglePlay} aria-label={t('media.play')}><Play size={30} fill="currentColor" /></button>
        </div>
      )}

      {/* overlay statistik */}
      {showStats && stats && (
        <div class="pp__stats">
          <div>{t('player.stResolution')}: <b>{stats.width}×{stats.height}</b></div>
          <div>{t('player.stBitrate')}: <b>{stats.bitrate ? `${Math.round(stats.bitrate / 1000)} kbps` : '—'}</b></div>
          <div>{t('player.stBuffer')}: <b>{stats.bufferedAhead.toFixed(1)}s</b></div>
          <div>{t('player.stDropped')}: <b>{stats.dropped}/{stats.decoded}</b></div>
          <div>{t('player.stBackend')}: <b>{backend || '—'}</b></div>
        </div>
      )}

      {/* help overlay */}
      {showHelp && (
        <div class="pp__help" onClick={() => setShowHelp(false)}>
          <div class="pp__help-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('player.shortcuts')}</h3>
            <div class="pp__help-grid">
              <div><kbd>Space</kbd><kbd>K</kbd>{t('player.scPlay')}</div>
              <div><kbd>←</kbd><kbd>→</kbd>{t('player.scSeek5')}</div>
              <div><kbd>J</kbd><kbd>L</kbd>{t('player.scSeek10')}</div>
              <div><kbd>↑</kbd><kbd>↓</kbd>{t('player.scVolume')}</div>
              <div><kbd>M</kbd>{t('player.scMute')}</div>
              <div><kbd>F</kbd>{t('player.scFullscreen')}</div>
              <div><kbd>P</kbd>{t('player.scPip')}</div>
              <div><kbd>C</kbd>{t('player.scSubtitle')}</div>
              <div><kbd>{'<'}</kbd><kbd>{'>'}</kbd>{t('player.scSpeed')}</div>
              <div><kbd>,</kbd><kbd>.</kbd>{t('player.scFrame')}</div>
              <div><kbd>A</kbd><kbd>B</kbd>{t('player.scLoop')}</div>
              <div><kbd>U</kbd>{t('player.scLoopClear')}</div>
              <div><kbd>S</kbd>{t('player.scScreenshot')}</div>
              <div><kbd>D</kbd>{t('player.scStats')}</div>
              <div><kbd>0</kbd>–<kbd>9</kbd>{t('player.scPercent')}</div>
              <div><kbd>?</kbd>{t('player.scHelp')}</div>
            </div>
          </div>
        </div>
      )}

      {flash && <div class="pp__flash">{flash}</div>}

      {/* bar kontrol */}
      <div class="pp__controls" onClick={(e) => e.stopPropagation()}>
        <div
          class="pp__seek"
          ref={seekRef}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekHover}
          onPointerLeave={() => setPreview((p) => ({ ...p, show: false }))}
          role="slider"
          aria-label={t('player.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration) || 0}
          aria-valuenow={Math.floor(curTime)}
        >
          <div class="pp__seek-track">
            <div class="pp__buffered" style={{ width: `${bufPct}%` }} />
            {ab.a != null && ab.b != null && durOk && (
              <div class="pp__region" style={{ left: `${(ab.a / duration) * 100}%`, width: `${((ab.b - ab.a) / duration) * 100}%` }} />
            )}
            <div class="pp__played" style={{ width: `${pct}%` }} />
            {ab.a != null && durOk && <div class="pp__ab" style={{ left: `${(ab.a / duration) * 100}%` }} />}
            {ab.b != null && durOk && <div class="pp__ab" style={{ left: `${(ab.b / duration) * 100}%` }} />}
            <div class="pp__thumb" style={{ left: `${pct}%` }} />
          </div>
          {preview.show && (
            <div class="pp__preview" style={{ left: `${preview.x}px` }}>
              {previewSrc && <canvas ref={previewCanvasRef} width={150} height={84} />}
              <span>{fmtTime(preview.time)}</span>
            </div>
          )}
        </div>

        <div class="pp__row">
          <button class="pp__btn" onClick={togglePlay} aria-label={t('media.play')}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button class="pp__btn" onClick={() => seekBy(-10)} aria-label={t('player.scSeek10')}><Rewind size={17} /></button>
          <button class="pp__btn" onClick={() => seekBy(10)} aria-label={t('player.scSeek10')}><FastForward size={17} /></button>

          <div class="pp__vol">
            <button class="pp__btn" onClick={toggleMute} aria-label={t('player.scMute')}><VolIcon size={18} /></button>
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume}
              onInput={(e) => setVol(Number((e.target as HTMLInputElement).value))} aria-label={t('player.scVolume')} />
          </div>

          <span class="pp__time">{fmtTime(curTime)} {durOk ? `/ ${fmtTime(duration)}` : '· LIVE'}</span>

          <div class="pp__spacer" />

          {/* kualitas */}
          <div class="pp__menu-wrap">
            <button class={`pp__btn${menu === 'quality' ? ' on' : ''}`} onClick={() => openMenu('quality')} aria-label={t('player.quality')}>
              <Settings2 size={17} /><span style={{ fontSize: '11px' }}>{curQualityLabel}</span>
            </button>
            {menu === 'quality' && (
              <div class="pp__menu">
                <h4>{t('player.quality')}</h4>
                {backend !== 'native' && (
                  <button class={`pp__opt${curQuality < 0 ? ' sel' : ''}`} onClick={() => pickQuality(-1)}>
                    <span>{t('player.auto')}</span>{curQuality < 0 && <Check size={14} />}
                  </button>
                )}
                {qualities.length === 0 && <button class="pp__opt" disabled>—</button>}
                {qualities.slice().reverse().map((q) => (
                  <button key={q.index} class={`pp__opt${curQuality === q.index ? ' sel' : ''}`} onClick={() => pickQuality(q.index)}>
                    <span>{q.label}</span>
                    <span class="mono">{q.bitrate ? `${Math.round(q.bitrate / 1000)}k` : ''}{curQuality === q.index ? ' ✓' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* audio */}
          {audios.length > 1 && (
            <div class="pp__menu-wrap">
              <button class={`pp__btn${menu === 'audio' ? ' on' : ''}`} onClick={() => openMenu('audio')} aria-label={t('player.audio')}><AudioLines size={17} /></button>
              {menu === 'audio' && (
                <div class="pp__menu">
                  <h4>{t('player.audio')}</h4>
                  {audios.map((aTrk) => (
                    <button key={aTrk.index} class={`pp__opt${curAudio === aTrk.index ? ' sel' : ''}`} onClick={() => pickAudio(aTrk.index)}>
                      <span>{aTrk.label}</span>{curAudio === aTrk.index && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* subtitle */}
          {subs.length > 0 && (
            <div class="pp__menu-wrap">
              <button class={`pp__btn${menu === 'subs' ? ' on' : ''}${curSub >= 0 ? ' on' : ''}`} onClick={() => openMenu('subs')} aria-label={t('player.subtitle')}><Subtitles size={17} /></button>
              {menu === 'subs' && (
                <div class="pp__menu">
                  <h4>{t('player.subtitle')}</h4>
                  <button class={`pp__opt${curSub < 0 ? ' sel' : ''}`} onClick={() => pickSub(-1)}><span>{t('player.off')}</span>{curSub < 0 && <Check size={14} />}</button>
                  {subs.map((s) => (
                    <button key={s.index} class={`pp__opt${curSub === s.index ? ' sel' : ''}`} onClick={() => pickSub(s.index)}>
                      <span>{s.label}</span>{curSub === s.index && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* kecepatan */}
          <div class="pp__menu-wrap">
            <button class={`pp__btn${menu === 'speed' ? ' on' : ''}`} onClick={() => openMenu('speed')} aria-label={t('player.speed')}><span style={{ fontSize: '12px', fontWeight: 600 }}>{speed}×</span></button>
            {menu === 'speed' && (
              <div class="pp__menu">
                <h4>{t('player.speed')}</h4>
                {SPEEDS.map((s) => (
                  <button key={s} class={`pp__opt${speed === s ? ' sel' : ''}`} onClick={() => changeSpeed(s)}><span>{s}×</span>{speed === s && <Check size={14} />}</button>
                ))}
              </div>
            )}
          </div>

          <button class="pp__btn" onClick={() => frameStep(-1)} aria-label={t('player.scFrame')}><StepBack size={17} /></button>
          <button class="pp__btn" onClick={() => frameStep(1)} aria-label={t('player.scFrame')}><StepForward size={17} /></button>
          <button class={`pp__btn${ab.a != null ? ' on' : ''}`} onClick={cycleLoop} aria-label={t('player.loop')}><Repeat size={17} /></button>
          <button class="pp__btn" onClick={screenshot} aria-label={t('player.screenshot')}><Camera size={17} /></button>
          <button class={`pp__btn${showStats ? ' on' : ''}`} onClick={() => setShowStats((s) => !s)} aria-label={t('player.stats')}><Activity size={17} /></button>
          <button class={`pp__btn${fit === 'cover' ? ' on' : ''}`} onClick={() => setFit((f) => (f === 'contain' ? 'cover' : 'contain'))} aria-label={t('player.fit')}><Scan size={17} /></button>
          <button class={`pp__btn${pip ? ' on' : ''}`} onClick={togglePip} aria-label="Picture-in-Picture"><PictureInPicture2 size={17} /></button>
          <button class="pp__btn" onClick={() => setShowHelp((s) => !s)} aria-label={t('player.help')}><Keyboard size={17} /></button>
          <button class="pp__btn" onClick={toggleFullscreen} aria-label={t('player.scFullscreen')}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
        </div>
      </div>
    </div>
  );
}
