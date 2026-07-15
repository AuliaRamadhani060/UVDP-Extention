// Utilitas media umum — port dari userscript (mediaKind, nama tampilan, ffmpeg).
import type { MediaItem } from '@/shared/types';
import { hasDashHint, hasHlsHint } from './url-utils';

export type MediaKindResolved = 'hls' | 'dash' | 'direct';

export function mediaKind(v: Pick<MediaItem, 'url' | 'playlistType'>): MediaKindResolved {
  const url = String(v?.url || '');
  const pt = String(v?.playlistType || '').toLowerCase();
  if (pt === 'mpd' || hasDashHint(url)) return 'dash';
  if (/master|media|m3u8/.test(pt) || hasHlsHint(url)) return 'hls';
  return 'direct';
}

export function mediaDisplayName(v: Pick<MediaItem, 'url'>): string {
  try {
    const parsed = new URL(v.url, location.href);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const raw = parts.pop() || parsed.hostname;
    return decodeURIComponent(raw).replace(/\+/g, ' ') || 'media';
  } catch {
    return String(v?.url || 'media').split('?')[0].split('/').pop() || 'media';
  }
}

export function buildDownloadFilename(url: string, fallback = 'video'): string {
  const rawName = (url.split('/').slice(-1)[0].split('?')[0] || fallback || 'video').trim();
  return (rawName || 'video').replace(/[\\/:*?"<>|]+/g, '_');
}

export function mediaOrigin(v: Pick<MediaItem, 'url'>): string {
  try {
    const parsed = new URL(v.url, location.href);
    return parsed.hostname || parsed.protocol.replace(':', '');
  } catch {
    return '';
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Label kualitas terbaik (resolusi) dari varian atau dari pola URL. */
export function mediaQualityLabel(v: MediaItem): string {
  const best = v.bestVariant;
  if (best?.resolution) return best.resolution;
  if (best?.height) return `${best.height}p`;
  const match = String(v.url || '').match(/(?:^|[_-])(\d{3,4})p(?:[_.-]|$)/i);
  return match ? `${match[1]}p` : '';
}

/**
 * Skor relevansi untuk menemukan "video utama". Semakin tinggi, semakin utama.
 * Video pada elemen halaman & manifest multi-kualitas diutamakan; hasil pindai
 * teks yang spekulatif diturunkan.
 */
export function mediaRelevanceScore(m: MediaItem): number {
  let s = 0;
  const k = mediaKind(m);
  const variants = m.variants?.length || 0;

  // Sumber ideal: manifest multi-resolusi yang bisa diputar dgn pilihan kualitas.
  if (variants) s += 6000 + variants * 20 + (m.bestVariant?.height || 0);
  else if (k === 'hls' || k === 'dash') s += 3000; // stream tanpa variants (media playlist)

  if (m.kind === 'fragmented') s += 2500 + Math.min(1500, m.segmentCount || 0);

  // Elemen <video> nyata di halaman (bukan blob).
  if (m.source === 'dom' && !/^blob:/i.test(m.url)) s += 2500;

  // Tingkatan ukuran: bedakan video utuh dari klip pendek.
  const mb = (m.sizeBytes || 0) / (1024 * 1024);
  if (mb > 200) s += 3000; else if (mb > 50) s += 2000; else if (mb > 5) s += 800;

  // Durasi panjang = konten utama (detik).
  if (m.duration) s += Math.min(2500, m.duration);

  if (m.audioTracks?.length) s += 50;
  if (m.subtitles?.length) s += 50;

  // Penalti.
  if (m.source === 'text-scan') s -= 1500; // spekulatif
  if (/\b(preview|trailer|teaser|sample|thumb|thumbnail|sprite|intro|ad|advert)\b/i.test(m.url)) s -= 4000; // klip bernilai rendah
  if (/^blob:/i.test(m.url)) s -= 9000; // blob tak actionable langsung
  if (m.protected) s -= 500;
  return s;
}

function quote(value: string): string {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

/** Perintah ffmpeg untuk remux stream ke mp4 (paritas userscript). */
export function buildFfmpegCommand(url: string, filename?: string): string {
  const base = String(filename || buildDownloadFilename(url)).replace(/\.[^./\\]+$/, '') || 'video';
  return 'ffmpeg -i ' + quote(url) + ' -map 0 -c copy ' + quote(base + '.mp4');
}
