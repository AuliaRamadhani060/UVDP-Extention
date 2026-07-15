// Engine unduhan tersegmentasi — port dari downloadSegmented userscript.
// Netral konteks: fetchBuffer disuntik (SW/offscreen/background page semua bisa).
// Merakit segmen berurutan (init dulu) → satu Blob. Dekripsi AES-128 bila ada key.
import { decryptSegment, type HlsKeyInfo } from './segment-crypto';

export interface SegItem { url: string; range?: string | null; key?: HlsKeyInfo | null }

export interface SegmentDownloadOptions {
  fetchBuffer: (url: string, range?: string | null) => Promise<ArrayBuffer>;
  onProgress?: (p: { completed: number; total: number; bytes: number }) => void;
  isCancelled?: () => boolean;
  parallel?: number;
  retry?: number;
  mimeType?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function downloadSegments(
  segments: SegItem[],
  initSegment: SegItem | null,
  opts: SegmentDownloadOptions,
): Promise<Blob> {
  const { fetchBuffer, onProgress, isCancelled } = opts;
  const maxParallel = Math.max(1, Math.min(16, opts.parallel || 6));
  const maxRetry = Math.max(0, opts.retry ?? 3);
  const mimeType = opts.mimeType || 'application/octet-stream';
  const includeInit = !!initSegment;
  const total = segments.length + (includeInit ? 1 : 0);
  if (!segments.length) throw new Error('Tidak ada segment untuk diunduh');

  const blobs: (Blob | undefined)[] = new Array(total);
  let completed = 0;
  let completedBytes = 0;
  const cancelled = () => !!isCancelled?.();

  async function fetchOne(item: SegItem): Promise<Blob> {
    let attempt = 0;
    for (;;) {
      try {
        if (cancelled()) throw new DOMException('Download dibatalkan', 'AbortError');
        let buffer = await fetchBuffer(item.url, item.range);
        if (item.key) buffer = await decryptSegment(buffer, item.key, (u) => fetchBuffer(u));
        return new Blob([buffer], { type: mimeType });
      } catch (error) {
        if (cancelled() || (error as Error)?.name === 'AbortError') throw error;
        attempt++;
        if (attempt > maxRetry) throw error;
        await sleep(Math.min(5000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
      }
    }
  }

  const report = () => onProgress?.({ completed, total, bytes: completedBytes });

  if (includeInit && initSegment) {
    blobs[0] = await fetchOne(initSegment);
    completed++;
    completedBytes += blobs[0].size;
    report();
  }

  let cursor = 0;
  async function worker() {
    while (!cancelled()) {
      const current = cursor++;
      if (current >= segments.length) break;
      const blob = await fetchOne(segments[current]);
      blobs[includeInit ? current + 1 : current] = blob;
      completed++;
      completedBytes += blob.size;
      report();
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxParallel, segments.length) }, worker));
  if (cancelled()) throw new Error('Download dibatalkan');

  return new Blob(blobs.filter(Boolean) as Blob[], { type: mimeType });
}
