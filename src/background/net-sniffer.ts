// Sniffer jaringan level-browser — senjata deteksi utama extension.
// Menangkap SEMUA request media di semua frame/worker via webRequest,
// termasuk yang tak pernah menyentuh DOM. Melaporkan kandidat (belum di-upsert)
// ke pemanggil, yang bertanggung jawab atas registrasi + enrichment.
import { browser } from '@/platform/browser';
import type { MediaRegistry } from '@/core/media-registry';
import type { MediaItem, MediaKind } from '@/shared/types';
import { hasDashHint, hasHlsHint, isHttpMediaUrl, isListableMediaUrl, isSegmentUrl } from '@/core/url-utils';

const PROGRESSIVE_EXT = /\.(mp4|m4v|webm|ogg|ogv|mov|mkv|avi|flv|mpe?g|wmv|3gp)(?:$|[?#])/i;

type Candidate = Omit<MediaItem, 'id' | 'firstSeen' | 'lastSeen'>;
export interface FragmentSignal { url: string; contentType?: string; tabId?: number; frameId?: number; pageUrl?: string }

/** Request yang tampak seperti fragmen stream (untuk pengelompokan §8.1). */
function isFragmentRequest(url: string, contentType?: string): boolean {
  if (isSegmentUrl(url)) return true;
  if (/(?:[?&])range=\d+-\d+/i.test(url)) return true; // googlevideo & sejenis
  if (/googlevideo\.com|\/videoplayback/i.test(url)) return true;
  if (/^(?:video|audio)\/(?:mp2t|iso\.segment)/i.test(contentType || '')) return true;
  return false;
}

function classify(url: string, contentType?: string): MediaKind {
  if (hasHlsHint(url) || /mpegurl/i.test(contentType || '')) return 'hls';
  if (hasDashHint(url) || /dash\+xml/i.test(contentType || '')) return 'dash';
  return 'file';
}

/**
 * Hanya media UTUH yang lolos: playlist HLS, manifest DASH, atau file video
 * progresif. Segmen (.ts/.m4s/…), init, chunk, dan potongan stream DIBUANG
 * agar daftar bersih dan video utama tidak tenggelam.
 */
function looksLikeMedia(url: string, contentType?: string): boolean {
  if (!isHttpMediaUrl(url)) return false;
  if (isSegmentUrl(url)) return false; // buang segmen lebih dulu
  if (isListableMediaUrl(url)) return true;
  // Content-Type video/dash/hls tanpa ekstensi jelas, tapi bukan segmen.
  if (contentType && /^(?:video\/(?:mp4|webm|ogg|quicktime|x-matroska)|application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i.test(contentType)) {
    return PROGRESSIVE_EXT.test(url) || hasHlsHint(url) || hasDashHint(url) || /mpegurl|dash\+xml/i.test(contentType);
  }
  return false;
}

interface HeadersDetails {
  url: string;
  tabId: number;
  frameId: number;
  responseHeaders?: Array<{ name: string; value?: string }>;
  initiator?: string;
  documentUrl?: string;
  originUrl?: string;
}

export function installNetSniffer(
  registry: MediaRegistry,
  onFound: (candidate: Candidate) => void,
  onFragment?: (signal: FragmentSignal) => void,
): void {
  const onHeaders = (details: HeadersDetails): void => {
    if (details.tabId < 0) return; // abaikan request non-tab (mis. dari extension sendiri)
    const headers = details.responseHeaders || [];
    const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value;
    const len = headers.find((h) => h.name.toLowerCase() === 'content-length')?.value;
    const pageUrl = details.initiator || details.documentUrl || details.originUrl || '';

    if (looksLikeMedia(details.url, ct)) {
      onFound({
        url: details.url,
        pageUrl,
        tabId: details.tabId,
        frameId: details.frameId,
        kind: classify(details.url, ct),
        contentType: ct,
        sizeBytes: len ? parseInt(len, 10) : undefined,
        protected: false,
        source: 'network',
      });
      return;
    }
    // Segmen tak dibuang lagi → dikelompokkan per stream induk (§8.1).
    if (onFragment && isFragmentRequest(details.url, ct)) {
      onFragment({ url: details.url, contentType: ct, tabId: details.tabId, frameId: details.frameId, pageUrl });
    }
  };

  (browser.webRequest.onHeadersReceived.addListener as unknown as (
    cb: (d: HeadersDetails) => void,
    filter: { urls: string[] },
    extra: string[],
  ) => void)(onHeaders, { urls: ['<all_urls>'] }, ['responseHeaders']);

  browser.tabs.onRemoved.addListener((tabId: number) => registry.removeByTab(tabId));
}
