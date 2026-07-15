// Kontrak pesan antar-lapisan (Blueprint §7) — "lem" yang menyambungkan
// keempat konteks. Semua pesan berbentuk { type, payload }.
//
// Fase 0: kontrak didefinisikan penuh; sebagian handler masih dummy/diagnostik.
// Fitur nyata (deteksi, unduh, player) dipindahkan ke kontrak ini bertahap di Fase 1+.
import type { MediaItem as MediaEntry } from './types';

export type { MediaEntry };

// --- Diagnostik alir pesan (Fase 0) ---
export interface DiagChain {
  main: boolean; // MAIN-world hook tercapai
  bridge: boolean; // content bridge tercapai
  background: boolean; // service worker tercapai
  offscreen: boolean | null; // offscreen (null = tidak berlaku, mis. Firefox)
}
export interface Diagnostics {
  chain: DiagChain;
  message: string;
  ts: number;
}

// --- ① MAIN-world hook → ② content bridge (via window.postMessage) ---
export type HookMessage =
  | { type: 'HOOK_HELLO' }
  | { type: 'HOOK_MEDIA_URL'; payload: { url: string; container?: string } }
  | { type: 'HOOK_MSE_CHUNK'; payload: { streamId: string; bytes: ArrayBuffer; mime: string; protected: boolean } }
  | { type: 'HOOK_EME_DETECTED'; payload: { keySystem: string } };

// --- ② content bridge → ③ background (via runtime.sendMessage) ---
export type BridgeMessage =
  | { type: 'MEDIA_CANDIDATE'; payload: Partial<MediaEntry> }
  | { type: 'DOM_TRACKS_FOUND'; payload: { tabId?: number; textTracks?: unknown[]; thumbnailTrack?: string | null } }
  | { type: 'PING_CHAIN'; payload: { reached: Array<'main' | 'bridge'> } };

// --- UI (panel/popup/player) → ③ background ---
export type UiMessage =
  | { type: 'GET_MEDIA_LIST'; payload?: { tabId?: number } }
  | { type: 'GET_MEDIA'; payload: { id: string } }
  | { type: 'GET_DIAGNOSTICS' }
  | { type: 'PLAY_MEDIA'; payload: { id: string } }
  | { type: 'DOWNLOAD_MEDIA'; payload: { id: string; strategy?: 'direct' | 'segmented' | 'resumable'; quality?: string } }
  | { type: 'DOWNLOAD_CANCEL'; payload: { id: string } }
  | { type: 'DOWNLOAD_RETRY'; payload: { id: string } }
  | { type: 'GET_DOWNLOADS' }
  | { type: 'COPY_FFMPEG'; payload: { id: string } }
  | { type: 'TOGGLE_SITE'; payload: { host: string; enabled: boolean } }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; payload: Record<string, unknown> }
  | { type: 'NOTIFY'; payload: { title: string; message: string } };

// --- ③ background → offscreen ---
export type OffscreenRequest =
  | { type: 'OFFSCREEN_PING' }
  | { type: 'PARSE_DASH'; payload: { text: string; url: string } }
  | { type: 'RUN_SEGMENTED'; payload: { id: string; url: string; kind: 'hls' | 'dash'; filename: string } }
  | { type: 'RUN_FRAGMENTS'; payload: { id: string; segments: Array<{ url: string; range?: string | null }>; filename: string; mime: string } }
  | { type: 'REVOKE_BLOBS'; payload: { urls: string[] } };
export interface SegmentedResult {
  files: Array<{ blobUrl: string; filename: string }>;
  directDownloads: Array<{ url: string; filename: string }>;
  muxHint: boolean;
  error?: string;
}
export type OffscreenResponse =
  | { type: 'OFFSCREEN_PONG' }
  | { type: 'PARSE_DASH_RESULT'; payload: unknown }
  | { type: 'SEGMENTED_RESULT'; payload: SegmentedResult };

// --- ③ background → UI (broadcast) ---
export type BroadcastMessage =
  | { type: 'MEDIA_LIST_UPDATED'; payload: { tabId?: number; entries: MediaEntry[] } }
  | { type: 'HELLO'; payload: { message: string; chain: DiagChain } }
  | { type: 'DOWNLOAD_PROGRESS'; payload: { id: string; done: number; total: number; bytes: number; speed?: number } }
  | { type: 'DOWNLOAD_DONE'; payload: { id: string } }
  | { type: 'DOWNLOAD_ERROR'; payload: { id: string; error: string } };

export type ContractMessage = BridgeMessage | UiMessage;

// Type guard: apakah pesan termasuk kontrak §7 (nama tipe HURUF_BESAR).
export function isContractMessage(msg: unknown): msg is ContractMessage {
  return (
    !!msg &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    /^[A-Z][A-Z_]+$/.test((msg as { type: string }).type)
  );
}
