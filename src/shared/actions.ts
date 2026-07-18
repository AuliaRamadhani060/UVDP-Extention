// Jalur aksi media BERSAMA (M3) — dipakai popup, dropdown in-page, side panel,
// dan Manager agar tak ada duplikasi logika. Semua aksi = pesan kontrak §7.
import { sendUi } from './messaging';
import type { MediaItem } from './types';
import type { DownloadStrategy } from './contract';

export const mediaActions = {
  /** Buka player (tab). */
  play: (id: string) => sendUi({ type: 'PLAY_MEDIA', payload: { id } }),
  /** Buka Halaman Download pre-filled (alur utama tombol Unduh). */
  openDownloader: (mediaId?: string, url?: string) => sendUi({ type: 'OPEN_DOWNLOADER', payload: { mediaId, url } }),
  /** Unduh cepat langsung ke antrean (mis. quick-quality) tanpa buka halaman. */
  quickDownload: (id: string, opts?: { quality?: string; strategy?: DownloadStrategy }) =>
    sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id, quality: opts?.quality, strategy: opts?.strategy } }),
  /** Daftar media tab (tabId opsional; default = tab pengirim). */
  getList: (tabId?: number) => sendUi<{ entries: MediaItem[] }>({ type: 'GET_MEDIA_LIST', payload: { tabId } }),
};

/** Salin teks ke clipboard (butuh gestur/ fokus dokumen). */
export async function copyUrl(url: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
}
