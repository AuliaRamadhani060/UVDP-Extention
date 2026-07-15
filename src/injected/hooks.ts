// Berjalan di MAIN world halaman (world: "MAIN" di manifest).
// Meng-hook API halaman untuk menangkap media yang tak terlihat di jaringan:
//  - fetch/XHR   : URL playlist/segmen yang di-fetch aplikasi (port dari hookFetch/hookXHR)
//  - MediaSource : stream tersegmentasi berbasis blob: (MSE) — deteksi baru
//  - EME         : konten ber-DRM -> ditandai protected (JANGAN diproses)
//
// MAIN world tidak punya akses `browser.*`, jadi komunikasi ke content script
// (isolated world) memakai window.postMessage dengan penanda origin.

const TAG = 'uvpd:page-hook';

function report(payload: Record<string, unknown>): void {
  window.postMessage({ __uvpd: TAG, payload }, '*');
}

// Penjaga DRM global (§8.3): sekali EME terdeteksi, JANGAN tangkap buffer apa pun.
let emeDetected = false;
let mseCounter = 0;

function toArrayBufferCopy(chunk: unknown): ArrayBuffer | null {
  try {
    if (chunk instanceof ArrayBuffer) return chunk.slice(0);
    const view = chunk as ArrayBufferView;
    if (view && view.buffer) return new Uint8Array(view.buffer, view.byteOffset || 0, view.byteLength).slice().buffer;
  } catch {
    /* noop */
  }
  return null;
}

// --- Fase 0: sinyal "hello" untuk membuktikan alir MAIN → bridge → background → panel ---
report({ kind: 'hello' });

// Pindai teks (JSON/konfigurasi/HTML) untuk URL media & laporkan — ini yang membuat
// deteksi bekerja SEBELUM video diputar (port scanTextForVideoUrls userscript).
const MEDIA_RE =
  /(?:https?:\/\/|\/\/|\/)[^\s"'\\]+?\.(?:mp4|m4v|webm|m3u8|m3u|ogg|mov|mpd|ts|m2ts|m4s|flv|avi|mkv)(?:\?[^"'\\\s]*)?/gi;
const HINT_RE =
  /(?:https?:\/\/|\/\/)[^\s"'\\]+?(?:\?|&)(?:format|type|playlist|stream|ext|file)=(?:hls|dash|m3u8|mpd|mp4)[^\s"'\\]*/gi;
function scanText(txt: string | null | undefined): void {
  if (!txt) return;
  const normalized = String(txt).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let n = 0;
  MEDIA_RE.lastIndex = 0;
  while ((m = MEDIA_RE.exec(normalized)) && n < 80) {
    if (!seen.has(m[0])) { seen.add(m[0]); report({ kind: 'fetch', url: m[0] }); n++; }
  }
  HINT_RE.lastIndex = 0;
  while ((m = HINT_RE.exec(normalized)) && n < 120) {
    if (!seen.has(m[0])) { seen.add(m[0]); report({ kind: 'fetch', url: m[0] }); n++; }
  }
}
const SCANNABLE_CT = /json|text|javascript|xml|mpegurl|dash\+xml/i;
const MAX_BODY = 3 * 1024 * 1024;

// Kenali manifest dari ISI (bukan ekstensi) → tangkap manifest bertoken tanpa
// ekstensi .m3u8/.mpd yang dimuat player MSE. Ini kunci "bisa diputar + resolusi".
function sniffManifest(url: string | undefined, txt: string): void {
  if (!url || !txt) return;
  const head = txt.slice(0, 80).trimStart();
  if (/^#EXTM3U/i.test(head)) report({ kind: 'manifest', url, format: 'hls' });
  else if (/^<\?xml|^<MPD[\s>]/i.test(head)) report({ kind: 'manifest', url, format: 'dash' });
}

// --- Hook fetch (URL + pindai body respons) ---
const origFetch = window.fetch;
if (typeof origFetch === 'function') {
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const promise = origFetch.apply(this, args as never);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url;
      if (url) report({ kind: 'fetch', url });
      promise
        .then((res) => {
          try {
            const ct = res.headers.get('content-type') || '';
            if (!SCANNABLE_CT.test(ct) || /event-stream/i.test(ct)) return;
            const len = parseInt(res.headers.get('content-length') || '0', 10);
            if (len && len > MAX_BODY) return;
            res.clone().text().then((txt) => { sniffManifest(url, txt); scanText(txt); }).catch(() => {});
          } catch { /* noop */ }
        })
        .catch(() => {});
    } catch { /* noop */ }
    return promise;
  };
}

// --- Hook XHR (URL + pindai responseText) ---
const OrigXHR = window.XMLHttpRequest;
if (OrigXHR) {
  const origOpen = OrigXHR.prototype.open;
  const origSend = OrigXHR.prototype.send;
  const attached = new WeakSet<XMLHttpRequest>();
  OrigXHR.prototype.open = function (this: XMLHttpRequest, _method: string, url: string | URL) {
    try { report({ kind: 'xhr', url: String(url) }); } catch { /* noop */ }
    // eslint-disable-next-line prefer-rest-params
    return origOpen.apply(this, arguments as never);
  };
  OrigXHR.prototype.send = function (this: XMLHttpRequest, ...sendArgs: unknown[]) {
    try {
      const xhr = this;
      if (!attached.has(xhr)) {
        attached.add(xhr);
        xhr.addEventListener('load', () => {
          try {
            const rt = xhr.responseType;
            if ((rt === '' || rt === 'text') && xhr.responseText && xhr.responseText.length <= MAX_BODY) {
              sniffManifest(xhr.responseURL, xhr.responseText);
              scanText(xhr.responseText);
            }
          } catch { /* noop */ }
        });
      }
    } catch { /* noop */ }
    return origSend.apply(this, sendArgs as never);
  };
}

// --- Deteksi EME / DRM (§8.3) ---
if (navigator.requestMediaKeySystemAccess) {
  const orig = navigator.requestMediaKeySystemAccess.bind(navigator);
  navigator.requestMediaKeySystemAccess = function (keySystem: string, configs: MediaKeySystemConfiguration[]) {
    emeDetected = true; // sejak kini semua capture ditandai protected & dibuang
    report({ kind: 'eme', keySystem });
    return orig(keySystem, configs);
  };
}

// --- Penangkapan MSE (§8.2): hook addSourceBuffer + appendBuffer ---
if (typeof MediaSource !== 'undefined' && MediaSource.prototype.addSourceBuffer) {
  const origAdd = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
    const sb = origAdd.call(this, mime);
    try {
      const streamId = 'sb' + ++mseCounter + '_' + Date.now().toString(36);
      const isProtected = emeDetected;
      report({ kind: 'mse-open', streamId, mime: String(mime || ''), protected: isProtected });

      const origAppend = sb.appendBuffer.bind(sb);
      (sb as SourceBuffer).appendBuffer = function (chunk: BufferSource) {
        try {
          // Penjaga DRM: konten terenkripsi → jangan tangkap (buffer tak berguna & etis).
          if (!isProtected && !emeDetected) {
            const copy = toArrayBufferCopy(chunk);
            if (copy) {
              window.postMessage(
                { __uvpd: TAG, payload: { kind: 'mse-chunk', streamId, bytes: copy } },
                '*',
                [copy], // transfer zero-copy ke content (buffer asli tetap dipakai appendBuffer)
              );
            }
          }
        } catch {
          /* jangan ganggu playback situs */
        }
        return origAppend(chunk);
      };
    } catch {
      /* noop */
    }
    return sb;
  };
}
