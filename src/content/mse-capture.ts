// Penangkapan MSE di content script (Blueprint §8.2). MAIN-world hook mengirim
// potongan appendBuffer ke sini; kita akumulasi per SourceBuffer, daftarkan entri
// media, dan saat diminta → rakit Blob → unduh. Buffer BESAR tetap di sini (bukan
// lewat background), jadi memori aman dan tak membanjiri pesan.
import { sendBridge } from '@/shared/messaging';
import { stableHash } from '@/core/url-utils';
import type { MediaItem } from '@/shared/types';

interface Capture {
  streamId: string;
  mime: string;
  chunks: ArrayBuffer[];
  bytes: number;
  protected: boolean;
  type: 'video' | 'audio' | 'unknown';
}

const captures = new Map<string, Capture>();
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // batas keamanan memori (2 GB)
let sinceUpdate = 0;

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('audio/mp4') || m.includes('mp4a')) return 'm4a';
  if (m.startsWith('audio/webm')) return 'webm';
  if (m.startsWith('video/webm') || m.includes('vp8') || m.includes('vp9') || m.includes('av01')) return 'webm';
  return 'mp4';
}
function typeFromMime(mime: string): 'video' | 'audio' | 'unknown' {
  const m = mime.toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'unknown';
}

function entryId(streamId: string): string {
  return 'mse_' + stableHash(streamId);
}

function register(cap: Capture): void {
  const item: Partial<MediaItem> & { url: string } = {
    id: entryId(cap.streamId),
    url: 'mse://' + cap.streamId,
    pageUrl: location.href,
    kind: 'mse',
    protected: cap.protected,
    protectionType: cap.protected ? 'EME/MSE' : '',
    source: 'page-hook',
    title: `${cap.type === 'audio' ? 'Audio' : 'Video'} capture (${cap.mime.split(';')[0]})`,
    fragmentType: cap.type,
    segmentCount: cap.chunks.length,
    sizeBytes: cap.bytes,
  };
  sendBridge({ type: 'MEDIA_CANDIDATE', payload: item });
}

export function mseOpen(streamId: string, mime: string, isProtected: boolean): void {
  const cap: Capture = { streamId, mime, chunks: [], bytes: 0, protected: isProtected, type: typeFromMime(mime) };
  captures.set(streamId, cap);
  register(cap); // muncul di panel (protected → ditandai, tak bisa disimpan)
}

export function mseChunk(streamId: string, bytes: ArrayBuffer): void {
  const cap = captures.get(streamId);
  if (!cap || cap.protected) return;
  if (cap.bytes + bytes.byteLength > MAX_BYTES) return; // hentikan di batas memori
  cap.chunks.push(bytes);
  cap.bytes += bytes.byteLength;
  if (++sinceUpdate >= 15) { sinceUpdate = 0; register(cap); } // update metadata berkala
}

/** Rakit chunk jadi Blob & unduh. Dipanggil saat user menekan Simpan. */
export function mseFinalize(streamId: string): void {
  const cap = captures.get(streamId);
  if (!cap || cap.protected || !cap.chunks.length) return;
  const blob = new Blob(cap.chunks, { type: cap.mime.split(';')[0] || 'application/octet-stream' });
  const base = (document.title || location.hostname || 'capture').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'capture';
  const filename = `${base}.${extFromMime(cap.mime)}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** streamId dari entry id (untuk finalize by media id). */
export function findStreamIdByEntry(id: string): string | null {
  for (const cap of captures.values()) if (entryId(cap.streamId) === id) return cap.streamId;
  return null;
}
