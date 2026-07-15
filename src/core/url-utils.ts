// Helper URL & identitas media — di-port langsung dari userscript UVPD
// (bagian UTIL/HELPER). Netral-browser, tanpa dependensi.

const VOLATILE_QUERY =
  /^(?:token|access_token|auth|authorization|signature|sig|expires?|expiry|policy|key-pair-id|hdnea|hdnts|jwt)$/i;

/** FNV-1a hash 32-bit dalam base36. */
export function stableHash(value: unknown): string {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Menormalkan URL dan meredaksi parameter token yang mudah berubah,
 *  agar URL yang sama secara logis menghasilkan identitas stabil. */
export function canonicalMediaIdentity(url: string, base = location.href): string {
  try {
    const parsed = new URL(url, base);
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (VOLATILE_QUERY.test(key)) parsed.searchParams.set(key, '{redacted}');
    }
    return parsed.href;
  } catch {
    return String(url ?? '');
  }
}

export function stableVideoId(url: string, base?: string): string {
  return 'vid_' + stableHash(canonicalMediaIdentity(url, base));
}

export function normalizeURL(url: string, base = location.href): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export function isHttpMediaUrl(url: string, base = location.href): boolean {
  try {
    const parsed = new URL(url, base);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function isSafeMediaUrl(url: string): boolean {
  if (/^(?:blob:|mediasource:|mediastream:)/i.test(String(url ?? ''))) return true;
  return isHttpMediaUrl(url);
}

export function sizeHuman(bytes?: number): string {
  if (!bytes || Number.isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return num.toFixed(2) + ' ' + units[i];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function hasHlsHint(url: string): boolean {
  const raw = String(url ?? '');
  const decoded = safeDecode(raw);
  return (
    /\.m3u8(?:$|[?#])/i.test(raw) ||
    /\.m3u(?:$|[?#])/i.test(raw) ||
    /[?&](?:format|type|playlist|stream|ext)=m3u8(?:&|$)/i.test(decoded) ||
    /[?&](?:format|type)=hls(?:&|$)/i.test(decoded) ||
    /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(decoded)
  );
}

export function hasDashHint(url: string): boolean {
  const raw = String(url ?? '');
  const decoded = safeDecode(raw);
  return (
    /\.mpd(?:$|[?#])/i.test(raw) ||
    /[?&](?:format|type|playlist|stream|ext)=mpd(?:&|$)/i.test(decoded) ||
    /[?&](?:format|type)=dash(?:&|$)/i.test(decoded) ||
    /application\/dash\+xml/i.test(decoded)
  );
}

/** Regex pemindai URL media dari teks (di-port dari scanTextForVideoUrls). */
export const MEDIA_URL_REGEX =
  /(?:https?:\/\/|\/\/|\/)[^\s"'\\]+?\.(mp4|m4v|webm|m3u8|m3u|ogg|mov|mpd|ts|m2ts|m4s|flv|avi|mkv)(\?[^"'\\\s]*)?/gi;

// --- Aturan penyaringan segmen (agar daftar tidak banjir potongan stream) ---

/** Ekstensi segmen streaming (BUKAN video utuh). */
const SEGMENT_EXT = /\.(ts|m2ts|m4s|cmfv|cmfa)(?:$|[?#])/i;
/** File bernama segmen/chunk/fragment/init. */
const SEGMENTISH = /(?:^|[/_-])(?:seg(?:ment)?|chunk|frag(?:ment)?|init)[/_-]?\d*[^/]*\.(?:ts|mp4|m4s)(?:$|[?#])/i;
/** Video progresif yang layak ditampilkan sebagai media utuh. */
const PROGRESSIVE_EXT = /\.(mp4|m4v|webm|ogg|ogv|mov|mkv|avi|flv|mpe?g|wmv|3gp)(?:$|[?#])/i;

/** True bila URL adalah potongan/segmen stream, bukan media utuh. */
export function isSegmentUrl(url: string): boolean {
  const raw = String(url || '');
  return SEGMENT_EXT.test(raw) || SEGMENTISH.test(raw);
}

/**
 * True bila URL layak muncul di daftar sebagai media utuh:
 * playlist HLS, manifest DASH, atau file video progresif — dan BUKAN segmen.
 */
export function isListableMediaUrl(url: string): boolean {
  const raw = String(url || '');
  if (/^blob:/i.test(raw)) return true; // MSE/blob = media aktif
  if (isSegmentUrl(raw)) return false;
  return hasHlsHint(raw) || hasDashHint(raw) || PROGRESSIVE_EXT.test(raw);
}
