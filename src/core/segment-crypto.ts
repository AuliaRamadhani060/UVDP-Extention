// Dekripsi segmen HLS AES-128 (AES-CBC) — port dari userscript (decryptHlsSegment).
// crypto.subtle tersedia di service worker, offscreen, dan background page.

export interface HlsKeyInfo {
  method: string; // 'AES-128' | 'SAMPLE-AES' | ...
  url: string; // URI key
  iv: string; // hex '0x...' atau kosong
  keyFormat?: string;
  sequence?: number;
}

/** IV turunan dari media sequence (bila EXT-X-KEY tak memberi IV). */
export function sequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  const value = Number(sequence) || 0;
  view.setUint32(8, Math.floor(value / 0x100000000), false);
  view.setUint32(12, value >>> 0, false);
  return iv;
}

export function parseIv(raw: string | undefined, sequence: number): Uint8Array {
  if (!raw) return sequenceIv(sequence);
  const clean = String(raw).replace(/^0x/i, '').padStart(32, '0').slice(-32);
  if (!/^[0-9a-f]{32}$/i.test(clean)) throw new Error('IV HLS invalid');
  const iv = new Uint8Array(16);
  for (let i = 0; i < 16; i++) iv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return iv;
}

const keyCache = new Map<string, ArrayBuffer>();

/**
 * Dekripsi buffer segmen. Hanya AES-128 keyformat identity yang didukung
 * (SAMPLE-AES / keyformat lain = DRM → ditolak, sesuai batas keras blueprint §2).
 */
export async function decryptSegment(
  buffer: ArrayBuffer,
  keyInfo: HlsKeyInfo | null | undefined,
  fetchBuffer: (url: string) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  if (!keyInfo) return buffer;
  if (keyInfo.method !== 'AES-128' || (keyInfo.keyFormat && keyInfo.keyFormat !== 'identity')) {
    throw new Error('Enkripsi HLS tidak didukung: ' + (keyInfo.method || keyInfo.keyFormat || 'unknown'));
  }
  if (!keyInfo.url) throw new Error('URI key AES-128 tidak tersedia');

  let keyBuffer = keyCache.get(keyInfo.url);
  if (!keyBuffer) {
    keyBuffer = await fetchBuffer(keyInfo.url);
    if (keyBuffer.byteLength !== 16) throw new Error('Panjang key AES-128 bukan 16 byte');
    keyCache.set(keyInfo.url, keyBuffer);
  }
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-CBC' }, false, ['decrypt']);
  const iv = parseIv(keyInfo.iv, keyInfo.sequence || 0) as unknown as BufferSource;
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, buffer);
}
