// Perencana unduhan (M1) — dari MediaItem hasilkan "rencana" untuk Halaman
// Download: jenis, varian kualitas, format output yang MUNGKIN (sesuai kemampuan
// jalur unduh yang ada; transcode ffmpeg ditandai "tersedia setelah M2"), nama
// file default pintar, batasan, dan status protected.
//
// Murni & netral-konteks (tanpa fetch/DOM) — cukup dari MediaItem yang sudah
// di-enrich. Pengambilan manifest/enrichment dilakukan pemanggil (background).
import type { MediaItem } from '@/shared/types';
import type { SourcePlan, PlanQuality, PlanFormat } from '@/shared/contract';
import { mediaKind, buildFfmpegCommand, mediaDisplayName } from './media-utils';

const AFTER_M2 = 'after-m2'; // penanda: butuh transcode ffmpeg.wasm (M2)

function extOf(url: string): string {
  const m = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}
function sanitize(name: string): string {
  return String(name || 'video').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
}

/** Nama file default pintar: judul spesifik → judul halaman → nama dari URL. */
function smartBase(media: MediaItem): string {
  const raw = (media.title && media.title.trim())
    || (media.pageTitle && media.pageTitle.trim())
    || mediaDisplayName(media).replace(/\.[^.]+$/, '');
  return sanitize(raw);
}

function qualities(media: MediaItem): PlanQuality[] {
  const variants = (media.variants || []).filter((v) => v.url && (v.resolution || v.height || v.bandwidth));
  const out: PlanQuality[] = [{ value: '', label: 'Auto', best: true }];
  // Urut tertinggi dulu.
  const sorted = variants.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
  for (const v of sorted) {
    const value = v.resolution || (v.height ? `${v.height}p` : '');
    if (!value) continue;
    out.push({ value, label: value, height: v.height, bitrate: v.bandwidth, url: v.url });
  }
  // Bila hanya "Auto", tandai bukan-best agar dropdown tetap masuk akal.
  if (out.length === 1) out[0] = { value: '', label: 'Auto', best: true };
  return out;
}

function directFormats(nativeExt: string): PlanFormat[] {
  const ext = nativeExt || 'mp4';
  const out: PlanFormat[] = [{ container: ext, label: `Asli (.${ext})`, available: true }];
  for (const c of ['mp4', 'mkv', 'webm', 'm4a', 'mp3']) {
    if (c === ext) continue;
    out.push({ container: c, label: c.toUpperCase(), available: false, needsTranscode: true, note: AFTER_M2 });
  }
  return out;
}
function streamFormats(): PlanFormat[] {
  return [
    { container: 'auto', label: 'Otomatis (remux dari sumber)', available: true },
    { container: 'mp4', label: 'MP4', available: false, needsTranscode: true, note: AFTER_M2 },
    { container: 'mkv', label: 'MKV', available: false, needsTranscode: true, note: AFTER_M2 },
    { container: 'webm', label: 'WebM', available: false, needsTranscode: true, note: AFTER_M2 },
    { container: 'm4a', label: 'Audio (M4A)', available: false, needsTranscode: true, note: AFTER_M2 },
    { container: 'mp3', label: 'Audio (MP3)', available: false, needsTranscode: true, note: AFTER_M2 },
  ];
}

/** Bangun rencana unduhan dari MediaItem yang (idealnya) sudah di-enrich. */
export function buildPlan(media: MediaItem): SourcePlan {
  const isBlobMse = /^blob:/i.test(media.url) || media.kind === 'mse';
  const kind = media.kind === 'fragmented' ? 'fragmented' : isBlobMse ? 'mse' : mediaKind(media);
  const base: SourcePlan = {
    ok: true,
    mediaId: media.id,
    url: media.url,
    pageUrl: media.pageUrl,
    kind,
    protected: !!media.protected,
    protectionType: media.protectionType,
    qualities: [],
    formats: [],
    defaultFilename: 'video',
    strategies: [],
    limitations: [],
    sizeBytes: media.sizeBytes,
    durationSec: media.duration,
    itemCount: media.segmentCount,
  };

  // DRM: hentikan — tidak pernah diproses (Aturan Keras #1).
  if (media.protected) {
    base.ok = false;
    base.limitations = [`Terproteksi (${media.protectionType || 'DRM'}) — tidak dapat diunduh.`];
    base.defaultFilename = sanitize(smartBase(media));
    return base;
  }

  const bn = smartBase(media);
  base.qualities = qualities(media);

  if (kind === 'direct') {
    const ext = extOf(media.bestVariant?.url || media.url) || 'mp4';
    base.formats = directFormats(ext);
    base.defaultFilename = `${bn}.${ext}`;
    base.strategies = ['resumable', 'direct'];
    if ((media.variants?.length || 0) > 1) base.limitations.push('Pilih kualitas = file per-resolusi yang berbeda.');
    if (!media.sizeBytes) base.limitations.push('Ukuran belum diketahui (akan tampil saat unduhan mulai).');
  } else if (kind === 'hls' || kind === 'dash') {
    base.formats = streamFormats();
    base.defaultFilename = `${bn}.mp4`;
    base.strategies = ['segmented'];
    base.ffmpeg = buildFfmpegCommand(media.url);
    if (kind === 'dash') base.limitations.push('DASH: kualitas terbaik dipilih otomatis (pemilihan per-kualitas menyusul).');
    else if (base.qualities.length > 1) base.limitations.push('HLS: pemilihan kualitas mengunduh varian playlist itu langsung.');
    base.limitations.push('Stream live / multi-period tak dirakit di browser — pakai perintah ffmpeg.');
  } else if (kind === 'fragmented') {
    base.formats = streamFormats();
    base.defaultFilename = `${bn}.mp4`;
    base.strategies = ['segmented'];
    base.limitations.push('Dirakit dari fragmen yang terkumpul — putar video agar fragmen lengkap.');
  } else {
    // mse capture
    base.formats = [{ container: 'auto', label: 'Simpan tangkapan', available: true }];
    base.defaultFilename = `${bn}.mp4`;
    base.strategies = ['segmented'];
    base.limitations.push('Tangkapan real-time — hanya berisi bagian yang sudah diputar.');
  }

  return base;
}
