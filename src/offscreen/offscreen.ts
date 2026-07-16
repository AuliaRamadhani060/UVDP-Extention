// Dokumen offscreen (Blueprint §4/§5.5) — konteks ke-4 (Chromium).
// Menyediakan DOMParser (DASH), crypto.subtle, Blob & createObjectURL untuk
// engine unduh tersegmentasi — semua tak tersedia di service worker.
import { browser } from '@/platform/browser';
import { parseDash } from '@/core/dash-parser';
import { runSegmentedDownload } from '@/core/segmented-runner';
import { downloadSegments } from '@/core/segment-downloader';
import { runResumableDownload, isRangeUnsupported } from '@/core/resumable-download';
import type { OffscreenRequest, OffscreenResponse, ResumableState } from '@/shared/contract';

// Kontrol jalannya unduhan resumable (pause/cancel) per-id.
const resumableControl = new Map<string, { paused: boolean; canceled: boolean }>();

function emitResumable(payload: ResumableState['payload']): void {
  browser.runtime.sendMessage({ type: 'RESUMABLE_STATE', payload }).catch(() => {});
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}
async function fetchBuffer(url: string, range?: string | null): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {};
  if (range) headers.Range = 'bytes=' + range;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.arrayBuffer();
}

browser.runtime.onMessage.addListener((
  raw: unknown,
  _sender: unknown,
  sendResponse: (r?: OffscreenResponse) => void,
) => {
  const msg = raw as OffscreenRequest;

  if (msg?.type === 'OFFSCREEN_PING') {
    sendResponse({ type: 'OFFSCREEN_PONG' });
    return false;
  }

  if (msg?.type === 'PARSE_DASH') {
    try {
      sendResponse({ type: 'PARSE_DASH_RESULT', payload: parseDash(msg.payload.text, msg.payload.url) });
    } catch (e) {
      sendResponse({ type: 'PARSE_DASH_RESULT', payload: { error: String(e) } });
    }
    return false;
  }

  if (msg?.type === 'REVOKE_BLOBS') {
    msg.payload.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
    return false;
  }

  if (msg?.type === 'CONTROL_RESUMABLE') {
    const ctrl = resumableControl.get(msg.payload.id);
    if (ctrl) {
      if (msg.payload.action === 'pause') ctrl.paused = true;
      else ctrl.canceled = true;
    }
    return false;
  }

  if (msg?.type === 'RUN_RESUMABLE') {
    const { id, url, filename, parallel, priorEtag, priorLastModified } = msg.payload;
    const ctrl = { paused: false, canceled: false };
    resumableControl.set(id, ctrl);
    runResumableDownload(url, filename, {
      fetchImpl: (u, init) => fetch(u, { credentials: 'include', ...init }),
      parallel,
      priorEtag,
      priorLastModified,
      isPaused: () => ctrl.paused,
      isCancelled: () => ctrl.canceled,
      onProgress: (loaded, total) => browser.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', payload: { id, done: loaded, total, bytes: loaded } }).catch(() => {}),
    })
      .then((out) => {
        if (out.status === 'complete') {
          emitResumable({ id, status: 'complete', blobUrl: URL.createObjectURL(out.blob), totalBytes: out.info.totalBytes, etag: out.info.etag, lastModified: out.info.lastModified });
        } else if (out.status === 'paused') {
          emitResumable({ id, status: 'paused', totalBytes: out.info.totalBytes, etag: out.info.etag, lastModified: out.info.lastModified });
        } else {
          emitResumable({ id, status: 'canceled' });
        }
      })
      .catch((e) => emitResumable({ id, status: 'error', rangeUnsupported: isRangeUnsupported(e), error: String((e as Error)?.message || e) }))
      .finally(() => resumableControl.delete(id));
    return false;
  }

  if (msg?.type === 'RUN_FRAGMENTS') {
    const { id, segments, filename, mime } = msg.payload;
    downloadSegments(segments, null, {
      fetchBuffer,
      mimeType: mime,
      onProgress: (p) => browser.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', payload: { id, done: p.completed, total: p.total, bytes: p.bytes } }).catch(() => {}),
    })
      .then((blob) => sendResponse({ type: 'SEGMENTED_RESULT', payload: { files: [{ blobUrl: URL.createObjectURL(blob), filename }], directDownloads: [], muxHint: false } }))
      .catch((e) => sendResponse({ type: 'SEGMENTED_RESULT', payload: { files: [], directDownloads: [], muxHint: false, error: String(e?.message || e) } }));
    return true;
  }

  if (msg?.type === 'RUN_SEGMENTED') {
    const { id, url, kind, filename } = msg.payload;
    runSegmentedDownload(url, kind, filename, {
      fetchText,
      fetchBuffer,
      onProgress: (p) => browser.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', payload: { id, done: p.completed, total: p.total, bytes: p.bytes } }).catch(() => {}),
    })
      .then((result) => {
        const files = result.files.map((f) => ({ blobUrl: URL.createObjectURL(f.blob), filename: f.filename }));
        sendResponse({ type: 'SEGMENTED_RESULT', payload: { files, directDownloads: result.directDownloads, muxHint: result.muxHint } });
      })
      .catch((e) => sendResponse({ type: 'SEGMENTED_RESULT', payload: { files: [], directDownloads: [], muxHint: false, error: String(e?.message || e) } }));
    return true; // async
  }

  return false;
});
