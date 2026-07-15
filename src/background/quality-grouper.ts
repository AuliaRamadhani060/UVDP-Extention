// Pengelompokan file per-kualitas → satu entri multi-resolusi.
// Banyak situs menyajikan kualitas sebagai file mp4 TERPISAH (mis. video_720m.mp4,
// video_480m.mp4) alih-alih HLS master. Kita gabungkan berdasarkan "template path"
// (angka kualitas diganti placeholder) sehingga muncul SATU entri dengan pilihan
// resolusi yang bisa dipindah di player.
import { stableHash } from '@/core/url-utils';
import type { MediaItem, QualityVariant } from '@/shared/types';

// Tinggi kualitas yang lazim (hindari salah-cocok dengan ID acak).
const QUALITY_RE =
  /(?:^|[_\-/=.])(144|180|234|240|270|288|360|432|480|540|576|640|720|1080|1440|2160)(?:m|p)?(?=[._\-/?&]|$)/i;

interface QGroup {
  id: string;
  key: string;
  pageUrl: string;
  tabId?: number;
  variants: Map<number, string>; // height → url terbaik
  sizes: Map<number, number>; // height → size
  firstSeen: number;
}

const groups = new Map<string, QGroup>();

/** Return {height, key} bila URL mengandung token kualitas jelas, else null. */
function analyze(url: string): { height: number; key: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.origin + u.pathname; // abaikan query agar token tak memecah grup
  QUALITY_RE.lastIndex = 0;
  const m = QUALITY_RE.exec(path);
  if (!m) return null;
  const height = parseInt(m[1], 10);
  const numIdx = path.indexOf(m[1], m.index);
  const key = path.slice(0, numIdx) + '{q}' + path.slice(numIdx + m[1].length);
  return { height, key };
}

/**
 * Catat file media. Bila ber-kualitas → kelompokkan & return entri gabungan
 * (kind 'file' + variants). Bila tidak → return null (daftarkan normal).
 */
export function noteQualityFile(item: Partial<MediaItem> & { url: string }): MediaItem | null {
  const info = analyze(item.url);
  if (!info) return null;
  let g = groups.get(info.key);
  if (!g) {
    g = { id: 'q_' + stableHash(info.key), key: info.key, pageUrl: item.pageUrl || '', tabId: item.tabId, variants: new Map(), sizes: new Map(), firstSeen: Date.now() };
    groups.set(info.key, g);
  }
  g.variants.set(info.height, item.url);
  if (item.sizeBytes) g.sizes.set(info.height, item.sizeBytes);
  if (!g.pageUrl && item.pageUrl) g.pageUrl = item.pageUrl;
  return toEntry(g);
}

function toEntry(g: QGroup): MediaItem {
  const variants: QualityVariant[] = Array.from(g.variants.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([height, url]) => ({ url, height, resolution: `${height}p` }));
  const best = variants[variants.length - 1];
  const bestUrl = best.url || '';
  const filename = (bestUrl.split('/').pop() || 'video').split('?')[0];
  return {
    id: g.id,
    url: bestUrl,
    pageUrl: g.pageUrl,
    tabId: g.tabId,
    kind: 'file',
    protected: false,
    source: 'network',
    title: filename,
    variants,
    bestVariant: best,
    sizeBytes: g.sizes.get(best.height!),
    firstSeen: g.firstSeen,
    lastSeen: Date.now(),
  };
}

/** Ambil URL varian dengan tinggi tertentu (untuk probe ukuran per-varian). */
export function clearQualityForTab(tabId: number): void {
  for (const [key, g] of groups) if (g.tabId === tabId) groups.delete(key);
}
