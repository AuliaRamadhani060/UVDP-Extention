// Spoof Referer & probe ukuran — menutup celah lintas-origin vs userscript.
//
// Userscript berjalan DI HALAMAN, jadi request medianya membawa Referer situs →
// lolos hotlink protection CDN. Extension berjalan di origin terpisah, jadi
// request player/unduh tak punya Referer yang benar → CDN menolak (403), video
// hitam & ukuran kosong. Solusi: declarativeNetRequest menyisipkan Referer situs
// pada request ke host media, sehingga extension "berperilaku seperti di halaman".

interface DnrApi {
  updateDynamicRules: (o: { addRules?: unknown[]; removeRuleIds?: number[] }) => Promise<void>;
}
function getDnr(): DnrApi | null {
  const c = (typeof chrome !== 'undefined' ? chrome : undefined) as unknown as { declarativeNetRequest?: DnrApi } | undefined;
  return c?.declarativeNetRequest ?? null;
}

const ruledHost = new Map<string, string>(); // host → referer terpasang

function ruleId(host: string): number {
  let h = 2166136261;
  for (let i = 0; i < host.length; i++) { h ^= host.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2_000_000_000) + 1;
}

/** Pastikan ada aturan DNR yang menyetel Referer=origin halaman untuk host media. */
export async function ensureRefererRule(mediaUrl: string, pageUrl?: string): Promise<void> {
  const api = getDnr();
  if (!api || !pageUrl) return;
  let host = '';
  let referer = '';
  try {
    host = new URL(mediaUrl).hostname;
    referer = new URL(pageUrl).origin;
  } catch {
    return;
  }
  if (!host || !/^https?:/.test(referer)) return;
  if (ruledHost.get(host) === referer) return; // sudah terpasang dengan referer sama
  ruledHost.set(host, referer);
  const id = ruleId(host);
  try {
    await api.updateDynamicRules({
      removeRuleIds: [id],
      addRules: [{
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'referer', operation: 'set', value: referer + '/' }],
        },
        condition: {
          requestDomains: [host],
          resourceTypes: ['media', 'xmlhttprequest', 'object', 'other', 'sub_frame', 'image'],
        },
      }],
    });
  } catch {
    ruledHost.delete(host);
  }
}

/** Ambil ukuran file via ranged GET (butuh Referer benar → panggil ensureRefererRule dulu). */
export async function probeSize(mediaUrl: string): Promise<number | undefined> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(mediaUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'include', signal: ctrl.signal });
    let size: number | undefined;
    const cr = res.headers.get('content-range'); // "bytes 0-0/12345"
    if (cr) {
      const m = cr.match(/\/(\d+)\s*$/);
      if (m) size = parseInt(m[1], 10);
    } else if (res.status === 200) {
      const cl = res.headers.get('content-length'); // server abaikan Range → ini ukuran penuh
      if (cl) size = parseInt(cl, 10);
    }
    ctrl.abort(); // hentikan body agar tak mengunduh seluruh file
    return size;
  } catch {
    try { ctrl.abort(); } catch { /* noop */ }
    return undefined;
  }
}
