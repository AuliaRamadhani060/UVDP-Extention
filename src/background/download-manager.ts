// Manajer unduhan berbasis chrome.downloads (native, resume/pause bawaan).
// Untuk file langsung. Stream HLS/DASH ditangani lewat perintah ffmpeg (lihat media-utils).
import { browser } from '@/platform/browser';
import { broadcast } from '@/shared/messaging';
import type { DownloadProgress } from '@/shared/types';

interface Tracked {
  downloadId: number;
  id: string; // media id
  url: string;
  filename: string;
  blobUrl?: string; // objectURL yang harus di-revoke setelah selesai
}

const byDownloadId = new Map<number, Tracked>();
const progressById = new Map<string, DownloadProgress>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

// --- Persistensi antrean lintas-sesi (Fase 3, §9) ---
const STORE_KEY = 'uvpd:downloads';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    browser.storage.local.set({ [STORE_KEY]: Array.from(progressById.values()) }).catch(() => {});
  }, 300);
}
async function hydrateDownloads(): Promise<void> {
  try {
    const res = await browser.storage.local.get(STORE_KEY);
    for (const p of (res[STORE_KEY] as DownloadProgress[]) || []) {
      // Blob URL tak valid lagi setelah restart; sesi aktif hilang → tandai selesai/gagal.
      if ((p.status === 'downloading' || p.status === 'paused') && /^blob:/i.test(p.url)) p.status = 'error';
      progressById.set(p.id, p);
    }
  } catch {
    /* abaikan */
  }
}
hydrateDownloads();

export function listDownloads(): DownloadProgress[] {
  return Array.from(progressById.values()).sort((a, b) => (b.id > a.id ? 1 : -1));
}

/** Ulangi unduhan (untuk URL http; blob URL tak bisa diulang setelah restart). */
export function retryDownload(id: string): void {
  const p = progressById.get(id);
  if (p && /^https?:/i.test(p.url)) startDownload(p.url, p.filename, p.id);
}

// Revoke blob URL setelah unduhan selesai. Di background page (Firefox) revoke
// langsung; di service worker (Chromium) minta offscreen yang membuatnya.
function revokeBlob(blobUrl: string): void {
  const u = (globalThis as { URL?: { revokeObjectURL?: (u: string) => void } }).URL;
  if (typeof u?.revokeObjectURL === 'function') u.revokeObjectURL(blobUrl);
  else browser.runtime.sendMessage({ type: 'REVOKE_BLOBS', payload: { urls: [blobUrl] } }).catch(() => {});
}

export async function startDownload(url: string, filename: string, mediaId?: string, blobUrl?: string): Promise<string> {
  const id = mediaId || url;
  const progress: DownloadProgress = { id, url, filename, loaded: 0, total: 0, status: 'downloading' };
  progressById.set(id, progress);
  emit(progress);
  try {
    const downloadId = (await browser.downloads.download({ url, filename, saveAs: false })) as number;
    byDownloadId.set(downloadId, { downloadId, id, url, filename, blobUrl });
    startPolling();
    return id;
  } catch (e) {
    progress.status = 'error';
    progress.error = String(e);
    emit(progress);
    if (blobUrl) revokeBlob(blobUrl);
    return id;
  }
}

export async function cancelDownload(id: string): Promise<void> {
  for (const [downloadId, t] of byDownloadId) {
    if (t.id === id) {
      try {
        await browser.downloads.cancel(downloadId);
      } catch {
        /* mungkin sudah selesai */
      }
      const p = progressById.get(id);
      if (p) {
        p.status = 'canceled';
        emit(p);
      }
    }
  }
}

function emit(progress: DownloadProgress): void {
  schedulePersist();
  // Kontrak §7: DOWNLOAD_PROGRESS untuk update byte; DONE/ERROR untuk akhir.
  if (progress.status === 'complete') {
    broadcast({ type: 'DOWNLOAD_DONE', payload: { id: progress.id } });
  } else if (progress.status === 'error') {
    broadcast({ type: 'DOWNLOAD_ERROR', payload: { id: progress.id, error: progress.error || 'error' } });
  } else {
    broadcast({
      type: 'DOWNLOAD_PROGRESS',
      payload: { id: progress.id, done: progress.loaded, total: progress.total, bytes: progress.loaded },
    });
  }
}

// chrome.downloads.onChanged menandai perubahan state; byte terkini diambil via search().
browser.downloads.onChanged.addListener((delta: { id: number; state?: { current?: string } }) => {
  const t = byDownloadId.get(delta.id);
  if (!t) return;
  const p = progressById.get(t.id);
  if (!p) return;
  const state = delta.state?.current;
  if (state === 'complete' || state === 'interrupted') {
    p.status = state === 'complete' ? 'complete' : 'error';
    byDownloadId.delete(delta.id);
    emit(p);
    if (t.blobUrl) revokeBlob(t.blobUrl);
  }
});

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (byDownloadId.size === 0) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    for (const t of byDownloadId.values()) {
      try {
        const [item] = (await browser.downloads.search({ id: t.downloadId })) as Array<{
          bytesReceived: number;
          totalBytes: number;
          paused: boolean;
        }>;
        const p = progressById.get(t.id);
        if (item && p) {
          p.loaded = item.bytesReceived;
          p.total = item.totalBytes;
          p.status = item.paused ? 'paused' : p.status === 'complete' ? 'complete' : 'downloading';
          emit(p);
        }
      } catch {
        /* abaikan */
      }
    }
  }, 700);
}
