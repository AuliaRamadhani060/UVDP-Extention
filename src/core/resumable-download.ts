// Engine unduhan resumable berbasis IndexedDB (port userscript UVPD ~L6224+).
// Netral-konteks: dijalankan di offscreen (Chromium) atau background page (Firefox)
// — keduanya punya fetch (dengan host_permissions → lintas-origin), IndexedDB,
// Blob & createObjectURL. Service worker TIDAK punya createObjectURL, jadi engine
// ini tak dijalankan di sana.
//
// Strategi: unduh file dalam chunk 8MB via request Range paralel (≤8), simpan tiap
// chunk ke IndexedDB, validasi Content-Range + panjang byte, dan bisa dilanjutkan
// (resume) dari chunk tersimpan — bahkan setelah browser ditutup. ETag/Last-Modified
// (+If-Range) menjaga agar tidak menyambung file yang sudah berubah di server.

export const CHUNK_SIZE = 8 * 1024 * 1024;
const DB_NAME = 'uvpd-downloads';
const DB_VERSION = 1;
const CHUNK_STORE = 'chunks';
const MAX_PARALLEL = 8;

export interface DownloadInfo {
  totalBytes?: number;
  resumable: boolean;
  contentType: string;
  etag: string;
  lastModified: string;
  acceptRanges: string;
}

export type ResumableOutcome =
  | { status: 'complete'; blob: Blob; info: DownloadInfo }
  | { status: 'paused'; info: DownloadInfo }
  | { status: 'canceled' };

export interface ResumableDeps {
  /** Fetch dengan kredensial + host permission (lintas-origin). Default: global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  onProgress?: (loaded: number, total: number) => void;
  onInfo?: (info: DownloadInfo) => void;
  isPaused?: () => boolean;
  isCancelled?: () => boolean;
  parallel?: number;
  /** ETag/Last-Modified sesi sebelumnya (untuk deteksi file berubah saat resume). */
  priorEtag?: string;
  priorLastModified?: string;
}

// ---------- IndexedDB ----------
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, { keyPath: ['sessionKey', 'index'] });
        store.createIndex('sessionKey', 'sessionKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB unduhan'));
  });
  return dbPromise;
}

async function idbTx<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(CHUNK_STORE, mode);
    const store = tx.objectStore(CHUNK_STORE);
    Promise.resolve(handler(store)).then((result) => {
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Transaksi IndexedDB gagal'));
      tx.onabort = () => reject(tx.error || new Error('Transaksi IndexedDB dibatalkan'));
    }).catch(reject);
  });
}

interface ChunkRow { sessionKey: string; index: number; blob: Blob; savedAt: number }

function putChunk(sessionKey: string, index: number, blob: Blob): Promise<void> {
  return idbTx('readwrite', (store) => new Promise<void>((resolve, reject) => {
    const r = store.put({ sessionKey, index, blob, savedAt: Date.now() } as ChunkRow);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error || new Error('Gagal menyimpan chunk'));
  }));
}
function getChunk(sessionKey: string, index: number): Promise<ChunkRow | null> {
  return idbTx('readonly', (store) => new Promise<ChunkRow | null>((resolve, reject) => {
    const r = store.get([sessionKey, index]);
    r.onsuccess = () => resolve((r.result as ChunkRow) || null);
    r.onerror = () => reject(r.error || new Error('Gagal membaca chunk'));
  }));
}
export function clearChunks(sessionKey: string): Promise<void> {
  return idbTx('readwrite', (store) => new Promise<void>((resolve, reject) => {
    const r = store.index('sessionKey').openCursor(IDBKeyRange.only(sessionKey));
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      cursor.continue();
    };
    r.onerror = () => reject(r.error || new Error('Gagal membersihkan chunk'));
  }));
}
export function listChunkIndices(sessionKey: string): Promise<number[]> {
  return idbTx('readonly', (store) => new Promise<number[]>((resolve, reject) => {
    const r = store.index('sessionKey').getAllKeys(IDBKeyRange.only(sessionKey));
    r.onsuccess = () => resolve(((r.result as Array<[string, number]>) || []).map((k) => k[1]).sort((a, b) => a - b));
    r.onerror = () => reject(r.error || new Error('Gagal membaca daftar chunk'));
  }));
}

export function sessionKeyFor(url: string, filename: string): string {
  return `${encodeURIComponent(url)}::${encodeURIComponent(filename)}`;
}

/** Berapa byte sudah tersimpan untuk sesi ini (untuk tampilan resume). */
export async function savedBytes(url: string, filename: string): Promise<number> {
  const key = sessionKeyFor(url, filename);
  const rows = await idbTx('readonly', (store) => new Promise<ChunkRow[]>((resolve, reject) => {
    const r = store.index('sessionKey').getAll(IDBKeyRange.only(key));
    r.onsuccess = () => resolve((r.result as ChunkRow[]) || []);
    r.onerror = () => reject(r.error);
  }));
  return rows.reduce((s, c) => s + (c.blob?.size || 0), 0);
}

// ---------- HTTP info ----------
function contentRangeTotal(cr: string): number | undefined {
  const m = cr.match(/\/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Deteksi dukungan Range + total byte + validator (ETag/Last-Modified). */
export async function requestDownloadInfo(url: string, fetchImpl: (u: string, i?: RequestInit) => Promise<Response>): Promise<DownloadInfo> {
  const h: Record<string, string> = Object.create(null);
  const merge = (res: Response) => { res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; }); };

  try {
    const head = await fetchImpl(url, { method: 'HEAD' });
    if (head.status) merge(head);
  } catch { /* HEAD sering ditolak — lanjut ke probe Range */ }

  let probe206 = false;
  if (!h['content-length'] || !/bytes/i.test(h['accept-ranges'] || '')) {
    try {
      const probe = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      merge(probe);
      probe206 = probe.status === 206;
      try { await probe.arrayBuffer(); } catch { /* buang body probe */ }
      const total = contentRangeTotal(h['content-range'] || '');
      if (total) h['content-length'] = String(total);
    } catch { /* abaikan */ }
  }

  const totalBytes = h['content-length'] ? parseInt(h['content-length'], 10) : undefined;
  const acceptRangesRaw = h['accept-ranges'] || (probe206 ? 'bytes' : '');
  const acceptRanges = acceptRangesRaw.toLowerCase();
  const resumable = (probe206 || acceptRanges.includes('bytes')) && Number.isFinite(totalBytes) && (totalBytes || 0) > 0;
  return {
    totalBytes,
    resumable,
    contentType: h['content-type'] || 'application/octet-stream',
    etag: h.etag || '',
    lastModified: h['last-modified'] || '',
    acceptRanges: acceptRangesRaw,
  };
}

class RangeUnsupportedError extends Error {
  code = 'RANGE_UNSUPPORTED' as const;
}
export function isRangeUnsupported(e: unknown): boolean {
  return !!e && (e as { code?: string }).code === 'RANGE_UNSUPPORTED';
}

// ---------- Engine ----------
/**
 * Jalankan (atau lanjutkan) unduhan resumable. Melempar RangeUnsupportedError bila
 * server tak mendukung Range → caller sebaiknya fallback ke unduhan native.
 */
export async function runResumableDownload(url: string, filename: string, deps: ResumableDeps = {}): Promise<ResumableOutcome> {
  const fetchImpl = deps.fetchImpl || ((u, i) => fetch(u, { credentials: 'include', ...i }));
  const key = sessionKeyFor(url, filename);
  const info = await requestDownloadInfo(url, fetchImpl);
  deps.onInfo?.(info);
  if (!info.resumable || !info.totalBytes) throw new RangeUnsupportedError('Server tidak mendukung resume berbasis chunk');

  const total = info.totalBytes;
  const totalChunks = Math.ceil(total / CHUNK_SIZE);

  // File berubah di server sejak sesi sebelumnya? Buang chunk lama, mulai bersih.
  const changed = (!!deps.priorEtag && !!info.etag && deps.priorEtag !== info.etag) ||
    (!!deps.priorLastModified && !!info.lastModified && deps.priorLastModified !== info.lastModified);
  if (changed) await clearChunks(key);

  const savedIndices = new Set(changed ? [] : await listChunkIndices(key));
  let completedBytes = 0;
  for (const idx of savedIndices) {
    const startByte = idx * CHUNK_SIZE;
    completedBytes += Math.min(CHUNK_SIZE, total - startByte);
  }

  const pending: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!savedIndices.has(i)) pending.push(i);

  const inFlight = new Map<number, number>();
  const controllers = new Set<AbortController>();
  let cursor = 0;
  let stop: 'paused' | 'canceled' | null = null;

  const report = () => {
    if (!deps.onProgress) return;
    let live = completedBytes;
    inFlight.forEach((v) => { live += Math.max(0, v); });
    deps.onProgress(Math.min(total, live), total);
  };

  const downloadChunk = async (index: number): Promise<void> => {
    const startByte = index * CHUNK_SIZE;
    const endByte = Math.min(total - 1, startByte + CHUNK_SIZE - 1);
    const headers: Record<string, string> = { Range: `bytes=${startByte}-${endByte}` };
    const ifRange = info.etag || info.lastModified;
    if (ifRange) headers['If-Range'] = ifRange;

    const controller = new AbortController();
    controllers.add(controller);
    inFlight.set(index, 0);
    try {
      const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      if (res.status !== 206) throw new RangeUnsupportedError(`Server mengabaikan Range (HTTP ${res.status})`);
      const cr = res.headers.get('content-range') || '';
      if (!new RegExp(`^bytes\\s+${startByte}-${endByte}/${total}$`, 'i').test(cr)) {
        throw new Error(`Content-Range tidak sesuai: ${cr || 'kosong'}`);
      }
      const buffer = await res.arrayBuffer();
      const expected = endByte - startByte + 1;
      if (buffer.byteLength !== expected) throw new Error(`Ukuran chunk salah: ${buffer.byteLength} != ${expected}`);
      await putChunk(key, index, new Blob([buffer], { type: info.contentType }));
      completedBytes += buffer.byteLength;
      report();
    } finally {
      controllers.delete(controller);
      inFlight.delete(index);
    }
  };

  const worker = async (): Promise<void> => {
    while (stop === null) {
      if (deps.isCancelled?.()) { stop = 'canceled'; break; }
      if (deps.isPaused?.()) { stop = 'paused'; break; }
      const i = cursor++;
      if (i >= pending.length) return;
      await downloadChunk(pending[i]);
    }
  };

  report();
  const workerCount = Math.max(1, Math.min(deps.parallel || 4, MAX_PARALLEL, pending.length || 1));
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());

  try {
    await Promise.all(workers);
  } catch (e) {
    controllers.forEach((c) => { try { c.abort(); } catch { /* */ } });
    throw e;
  }

  if (stop) {
    controllers.forEach((c) => { try { c.abort(); } catch { /* */ } });
    if (stop === 'canceled') { await clearChunks(key); return { status: 'canceled' }; }
    return { status: 'paused', info };
  }

  // Rakit blob final berurutan; verifikasi tidak ada chunk hilang + total byte cocok.
  const parts: Blob[] = [];
  let assembled = 0;
  for (let i = 0; i < totalChunks; i++) {
    const row = await getChunk(key, i);
    if (!row || !row.blob) throw new Error(`Chunk hilang saat perakitan: ${i}`);
    parts.push(row.blob);
    assembled += row.blob.size;
  }
  if (assembled !== total) throw new Error(`Ukuran file akhir tidak sesuai: ${assembled} != ${total}`);
  const blob = new Blob(parts, { type: info.contentType });
  await clearChunks(key);
  return { status: 'complete', blob, info };
}
