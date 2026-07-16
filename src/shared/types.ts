// Tipe domain bersama seluruh konteks (background, content, injected, UI).

export type MediaKind = 'file' | 'hls' | 'dash' | 'mse' | 'fragmented' | 'unknown';
export type PlaylistType = 'master' | 'media' | 'mpd' | '';

/** Trek audio/subtitle/thumbnail yang menyertai sebuah media. */
export interface Track {
  url?: string;
  label: string;
  language?: string;
  groupId?: string;
  codecs?: string;
  mimeType?: string;
  default?: boolean;
  kind?: string;
}

export interface QualityVariant {
  url?: string;
  width?: number;
  height?: number;
  resolution?: string;
  bandwidth?: number;
  averageBandwidth?: number;
  frameRate?: number;
  codecs?: string;
  codecLabel?: string;
  mimeType?: string;
  dash?: boolean;
  index?: number;
}

export interface MediaItem {
  id: string; // stableVideoId(url)
  url: string;
  pageUrl: string;
  tabId?: number;
  frameId?: number;
  kind: MediaKind;
  playlistType?: PlaylistType;
  contentType?: string;
  sizeBytes?: number;
  duration?: number;
  title?: string;
  pageTitle?: string; // judul halaman (og:title/<title>) — judul pintar fallback
  poster?: string; // thumbnail dataURL dari frame <video> (bila bisa ditangkap)
  segmentCount?: number; // untuk stream terkelompok dari fragmen (kind 'fragmented')
  fragmentType?: 'video' | 'audio' | 'unknown';
  spaNav?: boolean; // ditemukan SETELAH navigasi SPA (pushState/popstate) — filter provenance
  captureBytes?: number; // byte tertangkap sejauh ini (capture MSE real-time)
  captureTracks?: number; // jumlah SourceBuffer (2 = audio+video terpisah → butuh remux)

  // Deteksi DRM/enkripsi
  protected: boolean;
  protectionType?: string;
  encrypted?: boolean;

  // Trek & varian
  variants?: QualityVariant[];
  bestVariant?: QualityVariant;
  audioTracks?: Track[];
  subtitles?: Track[];
  thumbnailTracks?: Track[];

  source: 'network' | 'dom' | 'page-hook' | 'text-scan';
  firstSeen: number;
  lastSeen: number;
}

// ---- Progres unduhan (dipakai download-manager) ----
export interface DownloadProgress {
  id: string; // media id atau session key
  url: string;
  filename: string;
  loaded: number;
  total: number;
  // 'awaiting_mux' = audio & video terunduh terpisah, menunggu keputusan user
  // (gabungkan via ffmpeg.wasm atau simpan terpisah). 'muxing' = sedang digabung.
  status: 'queued' | 'downloading' | 'paused' | 'complete' | 'error' | 'canceled' | 'awaiting_mux' | 'muxing';
  error?: string;
  resumable?: boolean;
}

// Protokol pesan antar-konteks kini di `@/shared/contract` (kontrak §7).
