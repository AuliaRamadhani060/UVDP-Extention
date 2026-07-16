// Helper tampilan Media Library — turunan dari MediaItem untuk UI (§4).
import { sizeHuman } from '@/core/url-utils';
import { mediaKind, mediaDisplayName, mediaOrigin, mediaQualityLabel, formatDuration, mediaRelevanceScore } from '@/core/media-utils';
import type { MediaItem } from '@/shared/types';
import type { FilterKind, SortKind } from '@/ui/store/uvpd';

export type ViewKind = 'direct' | 'hls' | 'dash' | 'mse' | 'fragmented';

export function viewKind(m: MediaItem): ViewKind {
  if (m.kind === 'fragmented') return 'fragmented';
  if (/^blob:/i.test(m.url) || m.kind === 'mse') return 'mse';
  return mediaKind(m); // direct | hls | dash
}

/** Warna semantik (CSS var) per cara-pengiriman (§4.1). */
export function kindColorVar(k: ViewKind): string {
  return { direct: 'var(--direct)', hls: 'var(--hls)', dash: 'var(--dash)', mse: 'var(--mse)', fragmented: 'var(--frag)' }[k];
}

export function kindLabel(k: ViewKind): string {
  return { direct: 'FILE', hls: 'HLS', dash: 'DASH', mse: 'MSE', fragmented: 'FRAG' }[k];
}

/** Jejak provenance monospace (§4.4): bagaimana media tertangkap. */
export function provenance(m: MediaItem): string {
  const frame = m.frameId ? ' · iframe' : '';
  if (m.kind === 'fragmented') return `reassembled · ${m.segmentCount || 0} fragmen`;
  if (m.kind === 'mse' || /^blob:/i.test(m.url)) return m.protected ? 'appendBuffer · protected' : 'appendBuffer · MSE';
  switch (m.source) {
    case 'dom': return `DOM · <video>${frame}`;
    case 'network': return `network${frame}`;
    case 'page-hook': return `player hook${frame}`;
    case 'text-scan': return `page text${frame}`;
    default: return m.source;
  }
}

/** Judul pintar: title spesifik → judul halaman → nama file. */
export function smartName(m: MediaItem): string {
  return (m.title && m.title.trim()) || (m.pageTitle && m.pageTitle.trim()) || mediaDisplayName(m);
}

export function metaTokens(m: MediaItem): string[] {
  const out: string[] = [];
  const q = mediaQualityLabel(m); if (q) out.push(q);
  const d = formatDuration(m.duration); if (d) out.push(d);
  if (m.sizeBytes) out.push(sizeHuman(m.sizeBytes));
  return out;
}

export { mediaOrigin };

/** Filter + cari + sort → daftar tampil. */
export function computeVisible(
  media: Record<string, MediaItem>,
  opts: { filter: FilterKind; query: string; sort: SortKind; favorites: string[] },
): MediaItem[] {
  let list = Object.values(media);
  const { filter, query, sort, favorites } = opts;

  if (filter === 'favorites') list = list.filter((m) => favorites.includes(m.url));
  else if (filter !== 'all') list = list.filter((m) => (filter === 'file' ? viewKind(m) === 'direct' || viewKind(m) === 'mse' : viewKind(m) === filter));

  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter((m) => m.url.toLowerCase().includes(q) || smartName(m).toLowerCase().includes(q) || mediaOrigin(m).toLowerCase().includes(q));
  }

  list.sort((a, b) =>
    sort === 'quality' ? (b.bestVariant?.height || 0) - (a.bestVariant?.height || 0)
    : sort === 'recent' ? b.lastSeen - a.lastSeen
    : mediaRelevanceScore(b) - mediaRelevanceScore(a));
  return list;
}

/** id item paling relevan (badge "Utama"). */
export function primaryId(media: Record<string, MediaItem>): string {
  const top = Object.values(media).sort((a, b) => mediaRelevanceScore(b) - mediaRelevanceScore(a))[0];
  if (!top) return '';
  const strong = top.source === 'dom' || (top.variants?.length || 0) > 0 || viewKind(top) !== 'direct';
  return strong ? top.id : '';
}
