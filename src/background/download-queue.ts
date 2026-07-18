// Antrean unduhan terpusat (U4) — SATU sumber kebenaran untuk semua unduhan.
// Menangani: file langsung resumable (chunk 8MB via engine IndexedDB di offscreen/
// bg), fallback native chrome.downloads, dan stream HLS/DASH/fragmen (engine
// tersegmentasi). Mengalirkan status ke UI lewat Port (streaming) + broadcast lama.
//
// Kontrol: pause/resume/cancel/retry/remove/reorder + batas konkurensi.
// Riwayat unduhan tersimpan agar bisa diunduh-ulang.
import { browser } from '@/platform/browser';
import { broadcast } from '@/shared/messaging';
import { buildDownloadFilename, mediaKind } from '@/core/media-utils';
import { runResumableDownload, isRangeUnsupported } from '@/core/resumable-download';
import { runSegmentedDownload } from '@/core/segmented-runner';
import { downloadSegments } from '@/core/segment-downloader';
import { vttToSrt, looksLikeVtt } from '@/core/subtitle';
import { getSettings, saveSettings } from '@/shared/store';
import { isOffscreenAvailable, ensureOffscreen } from './offscreen-manager';
import { getGroupSegments, getSiblingAudioId } from './fragment-grouper';
import { ensureRefererRule } from './referer-spoof';
import type { MediaItem, MediaKind, DownloadProgress } from '@/shared/types';
import type { DownloadStrategy, QueueJobView, QueueSnapshot, SegmentedResult, ResumableState, FfmpegState, FfmpegOp, MuxFile } from '@/shared/contract';

interface Job {
  id: string;
  mediaId: string;
  url: string;
  pageUrl?: string;
  filename: string;
  kind: MediaKind;
  strategy: DownloadStrategy;
  quality?: string;
  status: DownloadProgress['status'];
  loaded: number;
  total: number;
  order: number;
  createdAt: number;
  resumable: boolean;
  container?: string; // format target (M2): '' /'auto'/'original' = tanpa ffmpeg
  error?: string;
  // internal (tidak dipersist)
  downloadId?: number;
  blobUrl?: string;
  etag?: string;
  lastModified?: string;
  speed: number;
  lastBytes: number;
  lastTime: number;
  /** Berkas A/V terpisah menunggu digabung (blob URL hidup di offscreen/bg). */
  muxFiles?: MuxFile[];
  muxProgress?: number;
}

type Port = { name: string; postMessage: (m: unknown) => void; onDisconnect: { addListener: (cb: () => void) => void } };

const jobs = new Map<string, Job>();
let history: QueueJobView[] = [];
let concurrency = 3;
const ports = new Set<Port>();
const byDownloadId = new Map<number, string>();
// Kontrol engine resumable untuk jalur Firefox (bg langsung, tanpa offscreen).
const localResumableCtl = new Map<string, { paused: boolean; canceled: boolean }>();

const QUEUE_KEY = 'uvpd:queue';
const HISTORY_KEY = 'uvpd:dlhistory';

function notify(message: string): void {
  browser.notifications.create({ type: 'basic', iconUrl: browser.runtime.getURL('icons/icon-48.png'), title: 'UVPD', message }).catch(() => {});
}

// ---------- View / snapshot / ports ----------
function etaOf(j: Job): number | undefined {
  if (j.status !== 'downloading' || j.speed <= 0 || j.total <= 0) return undefined;
  return Math.max(0, Math.round((j.total - j.loaded) / j.speed));
}
function toView(j: Job): QueueJobView {
  return {
    id: j.id, mediaId: j.mediaId, filename: j.filename, url: j.url, kind: j.kind,
    strategy: j.strategy, status: j.status, loaded: j.loaded, total: j.total,
    speed: j.speed, etaSec: etaOf(j), order: j.order, createdAt: j.createdAt,
    resumable: j.resumable, quality: j.quality, error: j.error,
    canMerge: (j.muxFiles?.length || 0) >= 2, muxProgress: j.muxProgress,
  };
}
function snapshot(): QueueSnapshot {
  const list = Array.from(jobs.values()).sort((a, b) => a.order - b.order).map(toView);
  return { type: 'QUEUE', jobs: list, history: history.slice(0, 100), concurrency };
}
export function getSnapshot(): QueueSnapshot { return snapshot(); }

/** Kompatibilitas GET_DOWNLOADS lama (side panel): DownloadProgress[]. */
export function listDownloadsCompat(): DownloadProgress[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt).map((j) => ({
    id: j.id, url: j.url, filename: j.filename, loaded: j.loaded, total: j.total, status: j.status, error: j.error, resumable: j.resumable,
  }));
}

function push(): void {
  const snap = snapshot();
  ports.forEach((p) => { try { p.postMessage(snap); } catch { /* port mati */ } });
  schedulePersist();
}
export function connectDownloadPort(port: Port): void {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  try { port.postMessage(snapshot()); } catch { /* */ }
}

// Broadcast lama agar kartu MediaCard (side panel) tetap menampilkan progres.
function emitLegacy(j: Job): void {
  if (j.status === 'complete') broadcast({ type: 'DOWNLOAD_DONE', payload: { id: j.id } });
  else if (j.status === 'error') broadcast({ type: 'DOWNLOAD_ERROR', payload: { id: j.id, error: j.error || 'error' } });
  else broadcast({ type: 'DOWNLOAD_PROGRESS', payload: { id: j.id, done: j.loaded, total: j.total, bytes: j.loaded, speed: j.speed } });
}

function setProgress(j: Job, loaded: number, total: number): void {
  const now = Date.now();
  const dt = (now - j.lastTime) / 1000;
  if (dt >= 0.35) {
    const inst = Math.max(0, (loaded - j.lastBytes) / dt);
    j.speed = j.speed > 0 ? j.speed * 0.6 + inst * 0.4 : inst; // EMA
    j.lastBytes = loaded; j.lastTime = now;
  }
  j.loaded = loaded; if (total > 0) j.total = total;
  push(); emitLegacy(j);
}
function setStatus(j: Job, status: Job['status'], error?: string): void {
  j.status = status; if (error) j.error = error;
  if (status !== 'downloading') j.speed = 0;
  push(); emitLegacy(j);
}

// ---------- Persistensi ----------
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const plain = Array.from(jobs.values()).map((j) => ({
      id: j.id, mediaId: j.mediaId, url: j.url, pageUrl: j.pageUrl, filename: j.filename, kind: j.kind,
      strategy: j.strategy, quality: j.quality, container: j.container, status: j.status, loaded: j.loaded, total: j.total,
      order: j.order, createdAt: j.createdAt, resumable: j.resumable, etag: j.etag, lastModified: j.lastModified,
    }));
    browser.storage.local.set({ [QUEUE_KEY]: plain, [HISTORY_KEY]: history.slice(0, 100) }).catch(() => {});
  }, 400);
}
async function hydrate(): Promise<void> {
  try {
    // Konkurensi = satu sumber kebenaran: Settings (diatur di Options).
    getSettings().then((s) => { concurrency = s.maxConcurrentDownloads; push(); pump(); }).catch(() => {});
    const res = await browser.storage.local.get([QUEUE_KEY, HISTORY_KEY]);
    history = (res[HISTORY_KEY] as QueueJobView[]) || [];
    for (const p of (res[QUEUE_KEY] as Partial<Job>[]) || []) {
      if (!p.id || !p.url) continue;
      // Sesi resumable → 'paused' (chunk tetap di IndexedDB, bisa dilanjut).
      // Native/segmented yang sempat jalan → 'error' (bisa retry).
      let status = p.status as Job['status'];
      if (status === 'downloading' || status === 'queued') status = p.resumable ? 'paused' : 'error';
      // Blob A/V & hasil ffmpeg tak dipersist → sesi mux/awaiting yang tersisa
      // tak bisa dilanjut setelah SW mati. Tandai error agar bisa di-retry.
      else if (status === 'muxing' || status === 'awaiting_mux') status = 'error';
      jobs.set(p.id, {
        id: p.id, mediaId: p.mediaId || p.id, url: p.url, pageUrl: p.pageUrl, filename: p.filename || 'video',
        kind: (p.kind as MediaKind) || 'file', strategy: (p.strategy as DownloadStrategy) || 'resumable',
        quality: p.quality, container: p.container, status, loaded: p.loaded || 0, total: p.total || 0, order: p.order || 0,
        createdAt: p.createdAt || Date.now(), resumable: !!p.resumable, etag: p.etag, lastModified: p.lastModified,
        speed: 0, lastBytes: p.loaded || 0, lastTime: Date.now(),
      });
    }
  } catch { /* abaikan */ }
}
hydrate();

// ---------- Enqueue & strategi ----------
function pickUrl(media: MediaItem, quality?: string): string {
  if (quality && media.variants) {
    const v = media.variants.find((x) => x.resolution === quality || (x.height && `${x.height}p` === quality));
    if (v?.url) return v.url;
  }
  return media.bestVariant?.url || media.url;
}
function chooseStrategy(media: MediaItem, requested?: DownloadStrategy): DownloadStrategy {
  if (requested) return requested;
  if (media.kind === 'fragmented' || media.kind === 'mse') return 'segmented';
  const k = mediaKind(media);
  return k === 'direct' ? 'resumable' : 'segmented';
}
let orderSeq = 0;

function sanitizeName(name: string): string {
  return String(name || 'video').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 150) || 'video';
}

export function enqueue(media: MediaItem, opts: { strategy?: DownloadStrategy; quality?: string; filename?: string; container?: string } = {}): void {
  if (media.protected) { notify('Media terproteksi/DRM — tidak diproses.'); return; }

  // Sudah ada job aktif untuk media ini → jangan gandakan.
  const existing = jobs.get(media.id);
  if (existing && (existing.status === 'downloading' || existing.status === 'queued' || existing.status === 'paused')) return;

  // Capture MSE (§8.2): buffer di content → finalisasi & unduh di sana (di luar antrean chunk).
  if (media.kind === 'mse' && /^mse:\/\//.test(media.url)) {
    if (media.tabId != null) browser.tabs.sendMessage(media.tabId, { type: 'FINALIZE_MSE', id: media.id }).catch(() => {});
    else notify('Tab capture tidak ditemukan.');
    return;
  }

  let strategy = chooseStrategy(media, opts.strategy);
  // Direct + butuh ffmpeg (remux/audio/transcode) → wajib lewat resumable agar
  // menghasilkan Blob (native chrome.downloads menyimpan langsung, tak bisa di-ffmpeg).
  const ffmpegTarget = !!opts.container && !['', 'auto', 'original'].includes(opts.container);
  if (ffmpegTarget && strategy === 'direct') strategy = 'resumable';
  const isStream = strategy === 'segmented';
  // URL: direct → varian per-kualitas; HLS → URL playlist varian bila kualitas
  // dipilih (runner mengunduh kualitas itu langsung); DASH → master (best).
  let url: string;
  if (!isStream) url = pickUrl(media, opts.quality);
  else if (media.kind === 'hls' && opts.quality) url = pickUrl(media, opts.quality);
  else url = media.url;

  const computed = isStream
    ? (buildDownloadFilename(media.pageUrl || media.url).replace(/\.[^./\\]+$/, '') || 'video') + '.mp4'
    : buildDownloadFilename(url);
  const filename = opts.filename ? sanitizeName(opts.filename) : (computed || 'video');
  const job: Job = {
    id: media.id, mediaId: media.id, url, pageUrl: media.pageUrl, filename: filename || 'video',
    kind: media.kind, strategy, quality: opts.quality, container: opts.container, status: 'queued', loaded: 0, total: media.sizeBytes || 0,
    order: orderSeq++, createdAt: Date.now(), resumable: strategy === 'resumable', speed: 0, lastBytes: 0, lastTime: Date.now(),
  };
  jobs.set(job.id, job);
  push();
  pump();
}

function activeCount(): number {
  let n = 0;
  for (const j of jobs.values()) if (j.status === 'downloading') n++;
  return n;
}
function pump(): void {
  const queued = Array.from(jobs.values()).filter((j) => j.status === 'queued').sort((a, b) => a.order - b.order);
  for (const job of queued) {
    if (activeCount() >= concurrency) break;
    void startJob(job);
  }
}

async function startJob(job: Job): Promise<void> {
  setStatus(job, 'downloading');
  if (/^https?:/.test(job.url) && job.pageUrl) await ensureRefererRule(job.url, job.pageUrl);
  try {
    if (job.strategy === 'resumable') await runResumable(job);
    else if (job.strategy === 'direct') await runNative(job);
    else await runStream(job);
  } catch (e) {
    setStatus(job, 'error', String((e as Error)?.message || e));
    pump();
  }
}

// ---------- Simpan ke disk (chrome.downloads) ----------
async function saveToDisk(job: Job, url: string, filename: string, blobUrl?: string): Promise<void> {
  try {
    const downloadId = (await browser.downloads.download({ url, filename, saveAs: false })) as number;
    job.downloadId = downloadId;
    if (blobUrl) job.blobUrl = blobUrl;
    byDownloadId.set(downloadId, job.id);
  } catch (e) {
    setStatus(job, 'error', String(e));
    if (blobUrl) revokeBlob(blobUrl);
    pump();
  }
}
function revokeBlob(blobUrl: string): void {
  const u = (globalThis as { URL?: { revokeObjectURL?: (u: string) => void } }).URL;
  if (typeof u?.revokeObjectURL === 'function') u.revokeObjectURL(blobUrl);
  else browser.runtime.sendMessage({ type: 'REVOKE_BLOBS', payload: { urls: [blobUrl] } }).catch(() => {});
}

// ---------- Native (chrome.downloads, resume bawaan) ----------
async function runNative(job: Job): Promise<void> {
  await saveToDisk(job, job.url, job.filename);
  startNativePolling();
}

// ---------- Resumable (chunk IndexedDB) ----------
async function runResumable(job: Job): Promise<void> {
  if (isOffscreenAvailable()) {
    await ensureOffscreen();
    await browser.runtime.sendMessage({
      type: 'RUN_RESUMABLE',
      payload: { id: job.id, url: job.url, filename: job.filename, parallel: 4, priorEtag: job.etag, priorLastModified: job.lastModified },
    }).catch(() => {});
    // Progres via DOWNLOAD_PROGRESS; hasil via RESUMABLE_STATE (lihat handleRuntime).
  } else {
    // Firefox: jalankan engine di background page langsung.
    const ctl = { paused: false, canceled: false };
    localResumableCtl.set(job.id, ctl);
    try {
      const out = await runResumableDownload(job.url, job.filename, {
        priorEtag: job.etag, priorLastModified: job.lastModified, parallel: 4,
        isPaused: () => ctl.paused, isCancelled: () => ctl.canceled,
        onInfo: (info) => { job.etag = info.etag; job.lastModified = info.lastModified; if (info.totalBytes) job.total = info.totalBytes; },
        onProgress: (loaded, total) => setProgress(job, loaded, total),
      });
      onResumableResult(job, out.status, out.status === 'complete' ? URL.createObjectURL(out.blob) : undefined);
    } catch (e) {
      if (isRangeUnsupported(e)) { job.resumable = false; job.strategy = 'direct'; setStatus(job, 'queued'); pump(); }
      else { setStatus(job, 'error', String((e as Error)?.message || e)); pump(); }
    } finally { localResumableCtl.delete(job.id); }
  }
}

function onResumableResult(job: Job, status: 'complete' | 'paused' | 'canceled' | 'error', blobUrl?: string, meta?: { rangeUnsupported?: boolean; error?: string; totalBytes?: number; etag?: string; lastModified?: string }): void {
  if (meta?.totalBytes) job.total = meta.totalBytes;
  if (meta?.etag) job.etag = meta.etag;
  if (meta?.lastModified) job.lastModified = meta.lastModified;
  if (status === 'complete' && blobUrl) {
    // M2: format target butuh ffmpeg (remux/audio/transcode) → proses dulu.
    if (wantsFfmpeg(job.container)) void runExport(job, [{ blobUrl, filename: job.filename }], job.container!);
    else saveToDisk(job, blobUrl, job.filename, blobUrl);
    return;
  }
  if (status === 'paused') { setStatus(job, 'paused'); pump(); return; }
  if (status === 'canceled') { setStatus(job, 'canceled'); pump(); return; }
  // error
  if (meta?.rangeUnsupported) { job.resumable = false; job.strategy = 'direct'; setStatus(job, 'queued'); pump(); return; }
  setStatus(job, 'error', meta?.error || 'error'); pump();
}

// ---------- Stream (HLS/DASH/fragmen) ----------
async function runStream(job: Job): Promise<void> {
  if (job.kind === 'fragmented') { await runFragmented(job); return; }
  // Pakai kind hasil deteksi (manifest bisa bertoken tanpa ekstensi → mediaKind(url) keliru).
  const kind: 'hls' | 'dash' = job.kind === 'dash' ? 'dash' : 'hls';
  if (isOffscreenAvailable()) {
    await ensureOffscreen();
    const res = (await browser.runtime.sendMessage({ type: 'RUN_SEGMENTED', payload: { id: job.id, url: job.url, kind, filename: job.filename } })) as { payload: SegmentedResult } | undefined;
    if (res?.payload) handleStreamResult(job, res.payload);
    else { setStatus(job, 'error', 'Unduhan gagal'); pump(); }
  } else {
    try {
      const result = await runSegmentedDownload(job.url, kind, job.filename, {
        fetchText: (u) => fetch(u, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
        fetchBuffer: (u, range) => { const h: Record<string, string> = {}; if (range) h.Range = 'bytes=' + range; return fetch(u, { credentials: 'include', headers: h }).then((r) => { if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }); },
        onProgress: (p) => setProgress(job, p.completed, p.total),
      });
      handleStreamResult(job, { files: result.files.map((f) => ({ blobUrl: URL.createObjectURL(f.blob), filename: f.filename })), directDownloads: result.directDownloads, muxHint: result.muxHint });
    } catch (e) { reportStreamError(job, String((e as Error)?.message || e)); pump(); }
  }
}

async function runFragmented(job: Job): Promise<void> {
  const videoSegs = getGroupSegments(job.mediaId).map((url) => ({ url }));
  if (!videoSegs.length) { setStatus(job, 'error', 'Fragmen belum cukup terkumpul.'); notify('Belum ada cukup fragmen. Putar video sejenak lalu coba lagi.'); pump(); return; }
  const base = job.filename.replace(/\.[^./\\]+$/, '') || 'video';
  const audioId = getSiblingAudioId(job.mediaId);
  const audioSegs = audioId ? getGroupSegments(audioId).map((url) => ({ url })) : [];
  const partsJobs = [{ segments: videoSegs, filename: `${base}${audioSegs.length ? '.video' : ''}.mp4`, mime: 'video/mp4' }];
  if (audioSegs.length) partsJobs.push({ segments: audioSegs, filename: `${base}.audio.m4a`, mime: 'audio/mp4' });

  try {
    const produced: MuxFile[] = [];
    for (const part of partsJobs) {
      if (isOffscreenAvailable()) {
        await ensureOffscreen();
        const res = (await browser.runtime.sendMessage({ type: 'RUN_FRAGMENTS', payload: { id: job.id, segments: part.segments, filename: part.filename, mime: part.mime } })) as { payload: SegmentedResult } | undefined;
        if (res?.payload?.files?.[0]) produced.push({ blobUrl: res.payload.files[0].blobUrl, filename: res.payload.files[0].filename });
        else throw new Error(res?.payload?.error || 'Perakitan fragmen gagal');
      } else {
        const blob = await downloadSegments(part.segments, null, { fetchBuffer: (u, range) => { const h: Record<string, string> = {}; if (range) h.Range = 'bytes=' + range; return fetch(u, { credentials: 'include', headers: h }).then((r) => { if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }); }, mimeType: part.mime, onProgress: (p) => setProgress(job, p.completed, p.total) });
        produced.push({ blobUrl: URL.createObjectURL(blob), filename: part.filename });
      }
    }
    // M2: format target dipilih → rakit → ffmpeg.
    if (wantsFfmpeg(job.container)) { void runExport(job, produced, job.container!); return; }
    // 'auto': video+audio fragmen terpisah → tawarkan gabung (U5).
    if (produced.length >= 2) {
      job.muxFiles = produced;
      setStatus(job, 'awaiting_mux');
      notify('Video & audio fragmen terpisah — pilih "Gabungkan" / "Simpan terpisah".');
      pump();
      return;
    }
    for (const f of produced) await saveToDisk(job, f.blobUrl, f.filename, f.blobUrl);
  } catch (e) { reportStreamError(job, String((e as Error)?.message || e)); pump(); }
}

function handleStreamResult(job: Job, result: SegmentedResult): void {
  if (result.error) { reportStreamError(job, result.error); pump(); return; }
  for (const d of result.directDownloads) saveToDisk(job, d.url, d.filename);
  const files = result.files.map((f) => ({ blobUrl: f.blobUrl, filename: f.filename }));
  if (!files.length) { if (!result.directDownloads.length) { setStatus(job, 'error', 'Tak ada berkas terbentuk'); pump(); } return; }

  // M2: format target dipilih (mp4/mkv/webm/m4a/mp3) → rakit → ffmpeg → satu berkas.
  if (wantsFfmpeg(job.container)) { void runExport(job, files, job.container!); return; }

  // 'auto': audio & video terpisah → tahan & tawarkan Gabungkan / Simpan terpisah (U5).
  if (result.muxHint && files.length >= 2) {
    job.muxFiles = files;
    setStatus(job, 'awaiting_mux');
    notify('Audio & video terunduh terpisah — pilih "Gabungkan" / "Simpan terpisah" di antrean.');
    pump();
    return;
  }
  for (const f of files) saveToDisk(job, f.blobUrl, f.filename, f.blobUrl);
}
function reportStreamError(job: Job, message: string): void {
  if (/^PROTECTED:/.test(message) || /protect|drm/i.test(message)) { setStatus(job, 'error', 'Terproteksi/DRM'); notify('Media terproteksi/DRM — tidak diproses.'); }
  else if (/^FFMPEG:|live|multi-period/i.test(message)) { setStatus(job, 'error', 'Live/multi-period — pakai ffmpeg'); notify('Stream live/multi-period tak dirakit di browser. Pakai tombol "Salin ffmpeg".'); }
  else setStatus(job, 'error', message);
}

// ---------- Kontrol ----------
export function pauseJob(id: string): void {
  const j = jobs.get(id); if (!j || j.status !== 'downloading') return;
  if (j.strategy === 'resumable') {
    if (isOffscreenAvailable()) browser.runtime.sendMessage({ type: 'CONTROL_RESUMABLE', payload: { id, action: 'pause' } }).catch(() => {});
    else { const c = localResumableCtl.get(id); if (c) c.paused = true; }
    // status akhir 'paused' ditetapkan saat RESUMABLE_STATE/hasil lokal masuk.
  } else if (j.strategy === 'direct' && j.downloadId != null) {
    browser.downloads.pause(j.downloadId).catch(() => {});
    setStatus(j, 'paused');
  }
}
export function resumeJob(id: string): void {
  const j = jobs.get(id); if (!j) return;
  if (j.strategy === 'direct' && j.downloadId != null && j.status === 'paused') {
    browser.downloads.resume(j.downloadId).catch(() => {});
    setStatus(j, 'downloading'); startNativePolling();
    return;
  }
  if (j.status === 'paused' || j.status === 'error' || j.status === 'canceled') { j.order = orderSeq++; setStatus(j, 'queued'); pump(); }
}
export function cancelJob(id: string): void {
  const j = jobs.get(id); if (!j) return;
  if (j.strategy === 'resumable') {
    if (isOffscreenAvailable()) browser.runtime.sendMessage({ type: 'CONTROL_RESUMABLE', payload: { id, action: 'cancel' } }).catch(() => {});
    else { const c = localResumableCtl.get(id); if (c) c.canceled = true; }
  }
  if (j.downloadId != null) browser.downloads.cancel(j.downloadId).catch(() => {});
  setStatus(j, 'canceled'); pump();
}
export function retryJob(id: string): void {
  const j = jobs.get(id);
  if (!j) { redownload(id); return; } // dari riwayat (job aktif sudah hilang)
  j.loaded = 0; j.error = undefined; j.order = orderSeq++;
  setStatus(j, 'queued'); pump();
}
export function removeJob(id: string): void {
  const j = jobs.get(id); if (!j) return;
  if (j.status === 'downloading') cancelJob(id);
  jobs.delete(id); push();
}
export function reorder(ids: string[]): void {
  ids.forEach((id, i) => { const j = jobs.get(id); if (j) j.order = i; });
  orderSeq = ids.length;
  push(); pump();
}
export function setConcurrency(n: number): void {
  concurrency = Math.max(1, Math.min(8, Math.floor(n) || 1));
  // Simpan ke Settings (sumber kebenaran) agar Options & antrean selalu sinkron.
  getSettings().then((s) => saveSettings({ ...s, maxConcurrentDownloads: concurrency })).catch(() => {});
  push(); pump();
}

// ---------- Ekspor format ffmpeg.wasm (U5 mux → diperluas M2) ----------
function isAudioName(n: string): boolean { return /\.(m4a|aac|mp3|opus|ogg|audio\.\w+)$/i.test(n) || /\.audio\./i.test(n); }

/** Perlu ffmpeg? '' / 'auto' / 'original' = simpan apa adanya. */
export function wantsFfmpeg(container?: string): boolean {
  return !!container && !['', 'auto', 'original'].includes(container);
}
function chooseOp(inputCount: number, container: string): FfmpegOp {
  if (container === 'm4a' || container === 'mp3') return 'audio';
  if (container === 'webm') return 'transcode';
  return inputCount >= 2 ? 'mux' : 'remux';
}
function selectInputs(files: MuxFile[], op: FfmpegOp): MuxFile[] {
  if (op === 'audio' && files.length >= 2) {
    return [files.find((f) => isAudioName(f.filename)) || files[files.length - 1]];
  }
  if ((op === 'mux' || op === 'transcode') && files.length >= 2) {
    const audio = files.find((f) => isAudioName(f.filename));
    const video = files.find((f) => f !== audio) || files[0];
    return audio ? [video, audio] : files;
  }
  return files.slice(0, 1);
}
function outNameFor(job: Job, container: string): string {
  const base = job.filename.replace(/\.[^./\\]+$/, '').replace(/\.(video|audio)$/i, '') || 'video';
  const ext = container === 'm4a' ? 'm4a' : container === 'mp3' ? 'mp3' : container === 'mkv' ? 'mkv' : container === 'webm' ? 'webm' : 'mp4';
  return `${base}.${ext}`;
}

/** Jalankan ekspor ffmpeg atas berkas hasil unduh. WASM baru dimuat di titik ini. */
async function runExport(job: Job, files: MuxFile[], container: string): Promise<void> {
  const op = chooseOp(files.length, container);
  const inputs = selectInputs(files, op);
  job.muxFiles = files; // simpan semua sumber untuk revoke nanti
  job.container = container;
  job.muxProgress = 0;
  setStatus(job, 'muxing');
  if (isOffscreenAvailable()) {
    await ensureOffscreen();
    // Hasil datang lewat FFMPEG_STATE (lihat handleRuntime).
    browser.runtime.sendMessage({ type: 'FFMPEG_RUN', payload: { id: job.id, inputs, container, op } }).catch(() => {});
    return;
  }
  // Firefox: jalankan ffmpeg.wasm di background page (import dinamis → lazy).
  try {
    const { runFfmpegExport } = await import('@/core/ffmpeg-mux');
    const ins = await Promise.all(inputs.map(async (f) => ({ data: new Uint8Array(await (await fetch(f.blobUrl)).arrayBuffer()), filename: f.filename })));
    const blob = await runFfmpegExport(ins, container, op, (r) => { job.muxProgress = r; push(); });
    onFfmpegResult(job, 'complete', URL.createObjectURL(blob));
  } catch (e) {
    onFfmpegResult(job, 'error', undefined, String((e as Error)?.message || e));
  }
}

function onFfmpegResult(job: Job, status: 'complete' | 'error', blobUrl?: string, error?: string): void {
  if (status === 'error') {
    job.muxProgress = undefined;
    const files = job.muxFiles || [];
    if (files.length >= 2) { // A/V terpisah → biarkan user "Simpan terpisah"
      setStatus(job, 'awaiting_mux', error);
      notify('Ekspor/gabung ffmpeg gagal — Anda bisa "Simpan terpisah".');
      pump(); return;
    }
    if (files.length === 1) { // satu input → jangan buang unduhan: simpan berkas asli
      job.muxFiles = undefined;
      notify('Ekspor ffmpeg gagal — menyimpan berkas asli.');
      saveToDisk(job, files[0].blobUrl, job.filename, files[0].blobUrl);
      return;
    }
    setStatus(job, 'error', error || 'ffmpeg gagal'); pump(); return;
  }
  // Sukses: buang blob sumber, simpan hasil.
  const container = job.container || 'mp4';
  for (const f of job.muxFiles || []) revokeBlob(f.blobUrl);
  job.muxFiles = undefined;
  job.muxProgress = undefined;
  if (blobUrl) saveToDisk(job, blobUrl, outNameFor(job, container), blobUrl);
}

/** Gabungkan A/V terpisah (jalur "auto → Gabungkan" dari antrean) → satu MP4. */
export function mergeJob(id: string): void {
  const j = jobs.get(id);
  if (!j || !j.muxFiles || j.muxFiles.length < 2) return;
  void runExport(j, j.muxFiles, 'mp4');
}

/** Fallback: simpan A/V apa adanya (tanpa mux) + tetap ada ekspor perintah ffmpeg. */
export function saveSeparate(id: string): void {
  const j = jobs.get(id);
  if (!j || !j.muxFiles) return;
  const files = j.muxFiles;
  j.muxFiles = undefined;
  setStatus(j, 'downloading');
  for (const f of files) saveToDisk(j, f.blobUrl, f.filename, f.blobUrl);
}

// Unduh-ulang dari riwayat: bangun job dari entri riwayat tersimpan.
export function redownload(id: string): void {
  const h = history.find((x) => x.id === id) || (jobs.get(id) ? toView(jobs.get(id)!) : undefined);
  if (!h) return;
  const job: Job = {
    id: h.mediaId + ':' + Date.now(), mediaId: h.mediaId, url: h.url, filename: h.filename, kind: h.kind,
    strategy: h.strategy, quality: h.quality, status: 'queued', loaded: 0, total: h.total, order: orderSeq++,
    createdAt: Date.now(), resumable: h.resumable, speed: 0, lastBytes: 0, lastTime: Date.now(),
  };
  jobs.set(job.id, job); push(); pump();
}

// ---------- Subtitle (VTT→SRT) ----------
export async function downloadSubtitle(media: MediaItem, trackIndex: number): Promise<void> {
  const track = (media.subtitles || [])[trackIndex];
  if (!track?.url) { notify('Subtitle tidak punya URL.'); return; }
  try {
    if (/^https?:/.test(track.url) && media.pageUrl) await ensureRefererRule(track.url, media.pageUrl);
    const res = await fetch(track.url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const base = (buildDownloadFilename(media.pageUrl || media.url).replace(/\.[^./\\]+$/, '') || 'subtitle') + (track.language ? `.${track.language}` : '');
    const isVtt = looksLikeVtt(text) || /\.vtt(\?|$)/i.test(track.url);
    const out = isVtt ? vttToSrt(text) : text;
    const filename = `${base}.${isVtt ? 'srt' : 'vtt'}`;
    const blob = new Blob([out], { type: 'text/plain' });
    const blobUrl = (globalThis as { URL?: { createObjectURL?: (b: Blob) => string } }).URL?.createObjectURL?.(blob);
    if (blobUrl) { await browser.downloads.download({ url: blobUrl, filename, saveAs: false }); setTimeout(() => revokeBlob(blobUrl), 5000); }
    else notify('Konteks tak bisa membuat blob subtitle.');
  } catch (e) { notify('Unduh subtitle gagal: ' + String((e as Error)?.message || e)); }
}

// ---------- Listener runtime (offscreen → bg) ----------
function handleRuntime(raw: unknown): void {
  const msg = raw as { type?: string; payload?: unknown };
  if (msg?.type === 'DOWNLOAD_PROGRESS') {
    const p = msg.payload as { id: string; done: number; total: number };
    const j = jobs.get(p.id);
    if (j && j.status === 'downloading') setProgress(j, p.done, p.total);
  } else if (msg?.type === 'RESUMABLE_STATE') {
    const p = (msg as ResumableState).payload;
    const j = jobs.get(p.id);
    if (j) onResumableResult(j, p.status, p.blobUrl, { rangeUnsupported: p.rangeUnsupported, error: p.error, totalBytes: p.totalBytes, etag: p.etag, lastModified: p.lastModified });
  } else if (msg?.type === 'FFMPEG_STATE') {
    const p = (msg as FfmpegState).payload;
    const j = jobs.get(p.id);
    if (!j) return;
    if (p.status === 'processing') { j.muxProgress = p.progress ?? 0; push(); return; }
    onFfmpegResult(j, p.status === 'complete' ? 'complete' : 'error', p.blobUrl, p.error);
  }
}
browser.runtime.onMessage.addListener((raw: unknown) => { handleRuntime(raw); return false; });

// ---------- Penyelesaian chrome.downloads ----------
browser.downloads.onChanged.addListener((delta: { id: number; state?: { current?: string } }) => {
  const jobId = byDownloadId.get(delta.id);
  if (!jobId) return;
  const j = jobs.get(jobId);
  if (!j) return;
  const state = delta.state?.current;
  if (state === 'complete') {
    if (j.blobUrl) { revokeBlob(j.blobUrl); j.blobUrl = undefined; }
    byDownloadId.delete(delta.id);
    if (j.total > 0) j.loaded = j.total;
    setStatus(j, 'complete'); // emit DONE + snapshot
    history.unshift({ ...toView(j), status: 'complete' });
    history = history.slice(0, 100);
    jobs.delete(j.id); // pindah dari antrean aktif → riwayat
    push(); pump();
  } else if (state === 'interrupted') {
    if (j.blobUrl) { revokeBlob(j.blobUrl); j.blobUrl = undefined; }
    byDownloadId.delete(delta.id);
    setStatus(j, 'error', 'interrupted');
    pump();
  }
});

// Polling byte untuk unduhan native (chrome.downloads tak selalu kirim delta byte).
let nativePoll: ReturnType<typeof setInterval> | null = null;
function startNativePolling(): void {
  if (nativePoll) return;
  nativePoll = setInterval(async () => {
    const natives = Array.from(jobs.values()).filter((j) => j.strategy === 'direct' && j.downloadId != null && (j.status === 'downloading' || j.status === 'paused'));
    if (!natives.length) { if (nativePoll) clearInterval(nativePoll); nativePoll = null; return; }
    for (const j of natives) {
      try {
        const [item] = (await browser.downloads.search({ id: j.downloadId })) as Array<{ bytesReceived: number; totalBytes: number; paused: boolean }>;
        if (item) { if (item.totalBytes > 0) setProgress(j, item.bytesReceived, item.totalBytes); if (item.paused && j.status !== 'paused') setStatus(j, 'paused'); }
      } catch { /* abaikan */ }
    }
  }, 700);
}
