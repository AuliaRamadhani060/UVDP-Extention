// Orkestrator unduhan tersegmentasi di background (Blueprint §5.6).
// Chromium: delegasikan ke offscreen (punya Blob/createObjectURL). Firefox:
// jalankan langsung di background page. Hasil (blob URL) diunduh via chrome.downloads.
import { browser } from '@/platform/browser';
import { isOffscreenAvailable, ensureOffscreen } from './offscreen-manager';
import { startDownload } from './download-manager';
import { runSegmentedDownload } from '@/core/segmented-runner';
import { downloadSegments } from '@/core/segment-downloader';
import { getGroupSegments, getSiblingAudioId } from './fragment-grouper';
import { ensureRefererRule } from './referer-spoof';
import { buildDownloadFilename, mediaKind } from '@/core/media-utils';
import type { MediaItem } from '@/shared/types';
import type { SegmentedResult } from '@/shared/contract';

function notify(message: string): void {
  browser.notifications.create({ type: 'basic', iconUrl: browser.runtime.getURL('icons/icon-48.png'), title: 'UVPD', message });
}

/** Unduh media apa pun: direct → chrome.downloads; stream → engine tersegmentasi. */
export async function downloadMedia(media: MediaItem): Promise<void> {
  if (media.protected) { notify('Media terproteksi/DRM — tidak diproses.'); return; }
  if (/^https?:/.test(media.url) && media.pageUrl) await ensureRefererRule(media.url, media.pageUrl);

  // Capture MSE (§8.2): buffer ada di content → minta finalisasi & unduh di sana.
  if (media.kind === 'mse' && /^mse:\/\//.test(media.url)) {
    if (media.tabId != null) browser.tabs.sendMessage(media.tabId, { type: 'FINALIZE_MSE', id: media.id }).catch(() => {});
    else notify('Tab capture tidak ditemukan.');
    return;
  }

  // Stream terkelompok dari fragmen (§8.1): rakit dari segmen yang terkumpul.
  if (media.kind === 'fragmented') { await downloadFragmented(media); return; }

  const kind = mediaKind(media);
  const filename = buildDownloadFilename(media.url);
  if (kind === 'direct') { startDownload(media.url, filename, media.id); return; }

  const k = kind as 'hls' | 'dash';
  if (isOffscreenAvailable()) {
    await ensureOffscreen();
    const res = (await browser.runtime.sendMessage({
      type: 'RUN_SEGMENTED', payload: { id: media.id, url: media.url, kind: k, filename },
    })) as { type: string; payload: SegmentedResult } | undefined;
    if (!res?.payload) { notify('Unduhan gagal.'); return; }
    handleResult(res.payload, media);
  } else {
    // Firefox: background page punya fetch/crypto/Blob/createObjectURL.
    try {
      const result = await runSegmentedDownload(media.url, k, filename, {
        fetchText: (u) => fetch(u, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
        fetchBuffer: (u, range) => {
          const headers: Record<string, string> = {};
          if (range) headers.Range = 'bytes=' + range;
          return fetch(u, { credentials: 'include', headers }).then((r) => { if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
        },
        onProgress: (p) => broadcastProgress(media.id, p.completed, p.total, p.bytes),
      });
      handleResult({
        files: result.files.map((f) => ({ blobUrl: URL.createObjectURL(f.blob), filename: f.filename })),
        directDownloads: result.directDownloads,
        muxHint: result.muxHint,
      }, media);
    } catch (e) {
      reportError(String((e as Error)?.message || e));
    }
  }
}

/** Unduh stream fragmen: rakit segmen video (+ audio pendamping bila ada). */
async function downloadFragmented(media: MediaItem): Promise<void> {
  const videoSegs = getGroupSegments(media.id).map((url) => ({ url }));
  if (!videoSegs.length) { notify('Belum ada cukup fragmen terkumpul. Putar video sejenak lalu coba lagi.'); return; }
  const base = buildDownloadFilename(media.pageUrl || media.url).replace(/\.[^./\\]+$/, '') || 'video';
  const audioId = getSiblingAudioId(media.id);
  const audioSegs = audioId ? getGroupSegments(audioId).map((url) => ({ url })) : [];

  const jobs: Array<{ segments: { url: string }[]; filename: string; mime: string }> = [
    { segments: videoSegs, filename: `${base}${audioSegs.length ? '.video' : ''}.mp4`, mime: 'video/mp4' },
  ];
  if (audioSegs.length) jobs.push({ segments: audioSegs, filename: `${base}.audio.m4a`, mime: 'audio/mp4' });

  if (isOffscreenAvailable()) {
    await ensureOffscreen();
    for (const job of jobs) {
      const res = (await browser.runtime.sendMessage({ type: 'RUN_FRAGMENTS', payload: { id: media.id, ...job } })) as { payload: SegmentedResult } | undefined;
      if (res?.payload) handleResult(res.payload, media);
    }
  } else {
    for (const job of jobs) {
      try {
        const blob = await downloadSegments(job.segments, null, {
          fetchBuffer: (u, range) => {
            const headers: Record<string, string> = {};
            if (range) headers.Range = 'bytes=' + range;
            return fetch(u, { credentials: 'include', headers }).then((r) => { if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
          },
          mimeType: job.mime,
          onProgress: (p) => broadcastProgress(media.id, p.completed, p.total, p.bytes),
        });
        const blobUrl = URL.createObjectURL(blob);
        startDownload(blobUrl, job.filename, media.id, blobUrl);
      } catch (e) { reportError(String((e as Error)?.message || e)); }
    }
  }
  if (audioSegs.length) notify('Audio & video fragmen diunduh terpisah. Gabungkan dengan ffmpeg.');
}

function handleResult(result: SegmentedResult, media: MediaItem): void {
  if (result.error) { reportError(result.error); return; }
  for (const f of result.files) startDownload(f.blobUrl, f.filename, media.id, f.blobUrl);
  for (const d of result.directDownloads) startDownload(d.url, d.filename, media.id);
  if (result.muxHint) notify('Audio & video diunduh terpisah. Gabungkan dengan ffmpeg (tombol "Salin ffmpeg" di panel).');
}

function reportError(message: string): void {
  if (/^PROTECTED:/.test(message) || /protect|drm/i.test(message)) notify('Media terproteksi/DRM — tidak diproses.');
  else if (/^FFMPEG:|live|multi-period/i.test(message)) notify('Stream live/multi-period tak dirakit di browser. Pakai tombol "Salin ffmpeg".');
  else notify('Unduhan gagal: ' + message);
}

function broadcastProgress(id: string, done: number, total: number, bytes: number): void {
  browser.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', payload: { id, done, total, bytes } }).catch(() => {});
}
