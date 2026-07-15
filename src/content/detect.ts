// Helper klasifikasi & pembuatan MediaItem di sisi content script.
import type { MediaItem, MediaKind } from '@/shared/types';
import { hasDashHint, hasHlsHint, stableVideoId } from '@/core/url-utils';

const FILE_EXT = /\.(mp4|m4v|webm|ogg|mov|ts|m2ts|m4s|flv|avi|mkv)(?:$|[?#])/i;

export function classifyFromUrl(url: string): MediaKind {
  if (hasHlsHint(url)) return 'hls';
  if (hasDashHint(url)) return 'dash';
  if (/^blob:/i.test(url)) return 'mse';
  if (FILE_EXT.test(url)) return 'file';
  return 'unknown';
}

export function toMediaItem(
  url: string,
  kind: MediaKind,
  source: MediaItem['source'],
  extra: Partial<MediaItem> = {},
): MediaItem {
  const now = Date.now();
  return {
    id: stableVideoId(url, location.href),
    url,
    pageUrl: location.href,
    kind,
    protected: false,
    source,
    firstSeen: now,
    lastSeen: now,
    ...extra,
  };
}
