// Orkestrator unduhan tersegmentasi — port dari startDownload userscript.
// Netral konteks (fetchText/fetchBuffer disuntik). Jalankan di offscreen (Chromium)
// atau background page (Firefox) — keduanya punya crypto.subtle & Blob.
import { parseHls } from './hls-parser';
import { parseHlsMediaPlan } from './hls-plan';
import { parseDashPlan } from './dash-plan';
import { downloadSegments, type SegItem } from './segment-downloader';
import { pickBestQualityVariant } from './quality';
import { buildDownloadFilename } from './media-utils';

export interface RunnerIO {
  fetchText: (url: string) => Promise<string>;
  fetchBuffer: (url: string, range?: string | null) => Promise<ArrayBuffer>;
  onProgress?: (p: { completed: number; total: number; bytes: number; phase: string }) => void;
  isCancelled?: () => boolean;
}
export interface RunnerFile { blob: Blob; filename: string }
export interface RunnerResult {
  files: RunnerFile[];
  directDownloads: Array<{ url: string; filename: string }>;
  muxHint: boolean; // audio+video terpisah → sarankan ffmpeg mux
}

class ProtectedError extends Error {}
class UseFfmpegError extends Error {}
export { ProtectedError, UseFfmpegError };

function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '') || 'video';
}

export async function runSegmentedDownload(
  url: string,
  kind: 'hls' | 'dash',
  filenameHint: string,
  io: RunnerIO,
): Promise<RunnerResult> {
  const filename = filenameHint || buildDownloadFilename(url);
  const result: RunnerResult = { files: [], directDownloads: [], muxHint: false };

  if (kind === 'hls') {
    let mediaUrl = url;
    let audioUrl: string | null = null;
    const masterText = await io.fetchText(url);
    const master = parseHls(masterText, url);
    if (master.isMaster) {
      const best = pickBestQualityVariant(master.variants);
      if (!best?.url) throw new Error('Varian HLS tidak ditemukan');
      mediaUrl = best.url;
      const audio = master.audioTracks.find((a) => a.default) || master.audioTracks[0];
      audioUrl = audio?.url || null;
    }
    const mediaText = mediaUrl === url ? masterText : await io.fetchText(mediaUrl);
    const plan = parseHlsMediaPlan(mediaText, mediaUrl);
    if (plan.protected) throw new ProtectedError('PROTECTED:' + (plan.protectionType || 'HLS'));
    if (plan.live) throw new UseFfmpegError('FFMPEG:HLS live');

    const total = plan.segments.length + (plan.initSegment ? 1 : 0) + (audioUrl ? 1 : 0);
    let base = 0;
    const videoBlob = await downloadSegments(plan.segments as SegItem[], plan.initSegment, {
      ...io, mimeType: 'video/mp4',
      onProgress: (p) => io.onProgress?.({ completed: base + p.completed, total, bytes: p.bytes, phase: 'video' }),
    });
    base += plan.segments.length + (plan.initSegment ? 1 : 0);
    result.files.push({ blob: videoBlob, filename: buildFile(filename, plan.container) });

    if (audioUrl) {
      const audioText = await io.fetchText(audioUrl);
      const audioPlan = parseHlsMediaPlan(audioText, audioUrl);
      if (!audioPlan.protected && !audioPlan.live) {
        const audioBlob = await downloadSegments(audioPlan.segments as SegItem[], audioPlan.initSegment, {
          ...io, mimeType: 'audio/mp4',
          onProgress: (p) => io.onProgress?.({ completed: base + p.completed, total, bytes: p.bytes, phase: 'audio' }),
        });
        result.files.push({ blob: audioBlob, filename: buildFile(baseName(filename) + '.audio', audioPlan.container === 'mp4' ? 'm4a' : audioPlan.container) });
        result.muxHint = true;
      }
    }
    return result;
  }

  // DASH
  const mpdText = await io.fetchText(url);
  const plan = parseDashPlan(mpdText, url);
  if (plan.protected) throw new ProtectedError('PROTECTED:' + (plan.protectionType || 'ContentProtection'));
  if (plan.live) throw new UseFfmpegError('FFMPEG:DASH live');
  if (plan.multiPeriod) throw new UseFfmpegError('FFMPEG:DASH multi-period');

  if (plan.kind === 'dash-direct' && plan.url) {
    result.directDownloads.push({ url: plan.url, filename: buildFile(filename, 'mp4') });
    return result;
  }

  const trackItems = (t?: { segments: unknown[]; initSegment: unknown } | null) => (t ? t.segments.length + (t.initSegment ? 1 : 0) : 0);
  const total = trackItems(plan.videoTrack) + trackItems(plan.audioTrack);
  let base = 0;
  const bn = baseName(filename);

  if (plan.videoTrack && !plan.videoTrack.directUrl) {
    const blob = await downloadSegments(plan.videoTrack.segments as SegItem[], plan.videoTrack.initSegment, {
      ...io, mimeType: 'video/mp4',
      onProgress: (p) => io.onProgress?.({ completed: base + p.completed, total, bytes: p.bytes, phase: 'video' }),
    });
    base += trackItems(plan.videoTrack);
    result.files.push({ blob, filename: buildFile(bn + (plan.audioTrack ? '.video' : ''), 'mp4') });
  } else if (plan.videoTrack?.directUrl) {
    result.directDownloads.push({ url: plan.videoTrack.directUrl, filename: buildFile(bn + '.video', 'mp4') });
  }

  if (plan.audioTrack && !plan.audioTrack.directUrl) {
    const blob = await downloadSegments(plan.audioTrack.segments as SegItem[], plan.audioTrack.initSegment, {
      ...io, mimeType: 'audio/mp4',
      onProgress: (p) => io.onProgress?.({ completed: base + p.completed, total, bytes: p.bytes, phase: 'audio' }),
    });
    result.files.push({ blob, filename: buildFile(bn + '.audio', 'm4a') });
    result.muxHint = !!plan.videoTrack;
  } else if (plan.audioTrack?.directUrl) {
    result.directDownloads.push({ url: plan.audioTrack.directUrl, filename: buildFile(bn + '.audio', 'm4a') });
  }

  return result;
}

function buildFile(base: string, ext: string): string {
  const clean = String(base || 'video').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video';
  const e = String(ext || '').replace(/^\./, '');
  if (!e) return clean;
  if (clean.toLowerCase().endsWith('.' + e.toLowerCase())) return clean;
  return clean.replace(/\.[^./\\]+$/, '') + '.' + e;
}
