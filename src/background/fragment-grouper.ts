// Pengelompokan fragmen (Blueprint §8.1) — KEUNGGULAN BARU atas userscript.
// Alih-alih membuang segmen (.ts/.m4s/range=/googlevideo), kumpulkan per "stream
// induk" (host + path template + itag) agar bisa disusun ulang & diunduh.
import { stableHash } from '@/core/url-utils';
import type { MediaItem } from '@/shared/types';

export interface FragmentInput {
  url: string;
  contentType?: string;
  tabId?: number;
  frameId?: number;
  pageUrl?: string;
}

interface Group {
  id: string;
  key: string;
  type: 'video' | 'audio' | 'unknown';
  itag: string;
  tabId?: number;
  frameId?: number;
  pageUrl?: string;
  representativeUrl: string;
  // index → url (dedup + urut). index bisa dari sq/range/nomor file; null → pakai urutan tiba.
  byIndex: Map<number, string>;
  arrival: string[]; // urutan tiba (fallback bila tak ada index)
  seen: Set<string>;
  firstSeen: number;
}

const groups = new Map<string, Group>();

const MIN_SEGMENTS = 3; // ambang agar tak memunculkan noise

/** Ekstrak {key,type,itag,index} dari URL fragmen. */
export function analyzeFragment(url: string, contentType?: string): {
  key: string; type: 'video' | 'audio' | 'unknown'; itag: string; index: number | null;
} {
  let host = '';
  let pathname = url;
  let itag = '';
  let sq: string | null = null;
  let range: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    pathname = u.pathname;
    itag = u.searchParams.get('itag') || '';
    sq = u.searchParams.get('sq');
    range = u.searchParams.get('range');
  } catch {
    /* biarkan default */
  }

  const ct = (contentType || '').toLowerCase();
  let type: 'video' | 'audio' | 'unknown' = 'unknown';
  if (/^audio\//.test(ct) || /mime=audio/i.test(url)) type = 'audio';
  else if (/^video\//.test(ct) || /mp2t|mpegurl|mime=video/i.test(ct + url)) type = 'video';

  // Indeks sekuens: prioritas sq → range(start) → angka terakhir di path.
  let index: number | null = null;
  let templatePath = pathname;
  if (sq != null && /^\d+$/.test(sq)) {
    index = parseInt(sq, 10);
  } else if (range && /^(\d+)-/.test(range)) {
    index = parseInt(range.match(/^(\d+)-/)![1], 10);
  } else {
    // Ganti gugus angka terakhir di path dengan '*' → template; angka itu = indeks.
    const m = pathname.match(/(\d+)(\.[a-z0-9]+)?$/i);
    if (m) {
      index = parseInt(m[1], 10);
      templatePath = pathname.slice(0, m.index) + '*' + (m[2] || '');
    }
  }

  const key = itag
    ? `${host}|itag=${itag}|${type}`
    : `${host}|${templatePath}|${type}`;
  return { key, type, itag, index };
}

/**
 * Catat sebuah fragmen. Return MediaItem sintetis (kind 'fragmented') bila grup
 * sudah cukup besar untuk ditampilkan, atau null.
 */
export function noteFragment(input: FragmentInput): MediaItem | null {
  const { key, type, itag, index } = analyzeFragment(input.url, input.contentType);
  let g = groups.get(key);
  if (!g) {
    g = {
      id: 'frag_' + stableHash(key),
      key, type, itag,
      tabId: input.tabId,
      frameId: input.frameId,
      pageUrl: input.pageUrl || '',
      representativeUrl: input.url,
      byIndex: new Map(),
      arrival: [],
      seen: new Set(),
      firstSeen: Date.now(),
    };
    groups.set(key, g);
  }
  if (g.seen.has(input.url)) return null;
  g.seen.add(input.url);
  if (index != null) g.byIndex.set(index, input.url);
  else g.arrival.push(input.url);

  const count = g.seen.size;
  // Emit saat pertama melewati ambang, lalu berkala — hindari broadcast tiap segmen.
  if (count < MIN_SEGMENTS) return null;
  if (count === MIN_SEGMENTS || count % 20 === 0) return toEntry(g);
  return null;
}

function toEntry(g: Group): MediaItem {
  const now = Date.now();
  const label = `${g.type === 'audio' ? 'Audio' : g.type === 'video' ? 'Video' : 'Media'} stream${g.itag ? ` · itag ${g.itag}` : ''}`;
  return {
    id: g.id,
    url: g.representativeUrl,
    pageUrl: g.pageUrl || '',
    tabId: g.tabId,
    frameId: g.frameId,
    kind: 'fragmented',
    protected: false,
    source: 'network',
    title: label,
    segmentCount: g.seen.size,
    fragmentType: g.type,
    firstSeen: g.firstSeen,
    lastSeen: now,
  };
}

/** URL segmen berurutan untuk sebuah grup (untuk unduhan reassembly). */
export function getGroupSegments(id: string): string[] {
  const g = Array.from(groups.values()).find((x) => x.id === id);
  if (!g) return [];
  const indexed = Array.from(g.byIndex.entries()).sort((a, b) => a[0] - b[0]).map(([, url]) => url);
  return indexed.length ? indexed : g.arrival.slice();
}

/** Grup audio pendamping di tab yang sama (untuk video → cari audio, sarankan mux). */
export function getSiblingAudioId(videoId: string): string | null {
  const v = Array.from(groups.values()).find((x) => x.id === videoId);
  if (!v || v.type !== 'video') return null;
  const audio = Array.from(groups.values()).find((x) => x.tabId === v.tabId && x.type === 'audio' && x.seen.size >= MIN_SEGMENTS);
  return audio?.id ?? null;
}

export function clearFragmentsForTab(tabId: number): void {
  for (const [key, g] of groups) if (g.tabId === tabId) groups.delete(key);
}
