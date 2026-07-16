// Mux audio+video in-browser dengan ffmpeg.wasm (U5) — kemampuan yang bahkan
// userscript tak punya.
//
// PENTING (Aturan Keras & MV3):
// - Core WASM dimuat dari BERKAS LOKAL ekstensi (aset yang di-emit Vite), BUKAN CDN.
//   MV3 CSP `script-src 'self'` melarang blob:/CDN, jadi trik `toBlobURL` bawaan
//   ffmpeg.wasm TIDAK dipakai.
// - Modul ini HANYA di-import dinamis saat user memilih "gabungkan" → WASM 32MB
//   tak pernah tersentuh saat startup.
// - Remux memakai `-c copy` (stream copy): tanpa re-encode, cepat, tanpa kualitas hilang.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

let instance: Promise<FFmpeg> | null = null;

/** Muat (sekali) instans ffmpeg.wasm dari aset lokal. */
async function getFfmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      const ff = new FFmpeg();
      if (onLog) ff.on('log', ({ message }) => onLog(message));
      await ff.load({
        coreURL: new URL(coreURL, self.location.href).href,
        wasmURL: new URL(wasmURL, self.location.href).href,
      });
      return ff;
    })();
    instance.catch(() => { instance = null; }); // gagal → boleh coba lagi
  }
  return instance;
}

/** Apakah core sudah termuat (untuk UI/diagnostik). */
export function isFfmpegLoaded(): boolean {
  return instance !== null;
}

function extOf(name: string, fallback: string): string {
  const m = name.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : fallback;
}

export interface MuxInput { data: Uint8Array; filename: string }

/**
 * Gabungkan satu trek video + satu trek audio menjadi satu berkas (stream copy).
 * @returns Blob hasil gabungan (container mengikuti `outName`).
 */
export async function muxAudioVideo(
  video: MuxInput,
  audio: MuxInput,
  outName: string,
  onProgress?: (ratio: number) => void,
  onLog?: (line: string) => void,
): Promise<Blob> {
  const ff = await getFfmpeg(onLog);
  const vIn = `in_v.${extOf(video.filename, 'mp4')}`;
  const aIn = `in_a.${extOf(audio.filename, 'm4a')}`;
  const out = `out.${extOf(outName, 'mp4')}`;

  const onProg = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  if (onProgress) ff.on('progress', onProg);

  try {
    await ff.writeFile(vIn, video.data);
    await ff.writeFile(aIn, audio.data);
    // -c copy: remux murni (tak re-encode). -shortest: berhenti di trek terpendek.
    const code = await ff.exec(['-i', vIn, '-i', aIn, '-c', 'copy', '-shortest', out]);
    if (code !== 0) throw new Error(`ffmpeg keluar dengan kode ${code}`);
    const data = await ff.readFile(out);
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : (data as Uint8Array);
    // Salin keluar dari heap WASM: aman dari detach saat memori ffmpeg tumbuh/di-reuse.
    const bytes = new Uint8Array(raw);
    if (!bytes.byteLength) throw new Error('Hasil mux kosong');
    return new Blob([bytes], { type: out.endsWith('.webm') ? 'video/webm' : 'video/mp4' });
  } finally {
    if (onProgress) ff.off('progress', onProg);
    for (const f of [vIn, aIn, out]) { try { await ff.deleteFile(f); } catch { /* mungkin tak ada */ } }
  }
}
