// Ekspor/transcode media in-browser dengan ffmpeg.wasm (U5 → diperluas M2).
// Kemampuan yang bahkan userscript tak punya: mux A/V terpisah, remux ke MP4/MKV,
// ekstrak audio (M4A/MP3), dan transcode WebM (VP9/Opus).
//
// PENTING (Aturan Keras & MV3):
// - Core WASM dimuat dari BERKAS LOKAL ekstensi (aset yang di-emit Vite), BUKAN CDN.
//   MV3 CSP `script-src 'self'` melarang blob:/CDN → trik `toBlobURL` bawaan TIDAK dipakai.
// - Modul ini HANYA di-import dinamis saat user memilih format yang butuh ffmpeg →
//   WASM 32MB tak pernah tersentuh saat startup.
// - Remux/mux memakai `-c copy` (stream copy): tanpa re-encode, cepat, tanpa kualitas hilang.
//   Core @ffmpeg/core 0.12 = build GPL penuh (libx264/libvpx/libmp3lame/libopus/aac).
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

/** Operasi ffmpeg yang didukung Halaman Download. */
export type FfmpegOp = 'mux' | 'remux' | 'audio' | 'transcode';

export interface MuxInput { data: Uint8Array; filename: string }

function inExt(name: string, i: number): string {
  const m = String(name).match(/\.([A-Za-z0-9]{2,5})(?:$|[?#])/);
  return m ? m[1].toLowerCase() : (i === 0 ? 'mp4' : 'm4a');
}
function extForContainer(c: string): string {
  return c === 'm4a' ? 'm4a' : c === 'mp3' ? 'mp3' : c === 'mkv' ? 'mkv' : c === 'webm' ? 'webm' : 'mp4';
}
function mimeForContainer(c: string): string {
  return c === 'mp3' ? 'audio/mpeg' : c === 'm4a' ? 'audio/mp4' : c === 'webm' ? 'video/webm' : c === 'mkv' ? 'video/x-matroska' : 'video/mp4';
}

function buildArgs(op: FfmpegOp, container: string, inNames: string[], out: string): string[] {
  switch (op) {
    case 'mux': // gabung video+audio (mp4/mkv) tanpa re-encode
      return [...inNames.flatMap((n) => ['-i', n]), '-c', 'copy', '-shortest', out];
    case 'remux': // ganti container (mis. TS→MP4) tanpa re-encode
      return ['-i', inNames[0], '-c', 'copy', out];
    case 'audio': // ekstrak audio saja
      return container === 'mp3'
        ? ['-i', inNames[0], '-vn', '-c:a', 'libmp3lame', '-q:a', '2', out]
        // M4A: re-encode AAC agar SELALU valid (copy bisa gagal untuk audio non-AAC).
        : ['-i', inNames[0], '-vn', '-c:a', 'aac', '-b:a', '192k', out];
    case 'transcode': // WebM (VP9 + Opus) — re-encode, LAMBAT di wasm
      return [...inNames.flatMap((n) => ['-i', n]), '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-c:a', 'libopus', out];
  }
}

/**
 * Jalankan operasi ffmpeg. `inputs` sudah diurutkan/dipilih pemanggil:
 * - mux/transcode: video dulu, lalu audio.
 * - remux/audio: satu input (audio op → berkas audio, atau A/V bila copy dari satu file).
 * @returns Blob hasil (container = `container`).
 */
export async function runFfmpegExport(
  inputs: MuxInput[],
  container: string,
  op: FfmpegOp,
  onProgress?: (ratio: number) => void,
  onLog?: (line: string) => void,
): Promise<Blob> {
  if (!inputs.length) throw new Error('Tidak ada input untuk ffmpeg');
  const ff = await getFfmpeg(onLog);
  const inNames = inputs.map((f, i) => `in${i}.${inExt(f.filename, i)}`);
  const out = `out.${extForContainer(container)}`;

  const onProg = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  if (onProgress) ff.on('progress', onProg);
  try {
    for (let i = 0; i < inputs.length; i++) await ff.writeFile(inNames[i], inputs[i].data);
    const code = await ff.exec(buildArgs(op, container, inNames, out));
    if (code !== 0) throw new Error(`ffmpeg keluar dengan kode ${code}`);
    const data = await ff.readFile(out);
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : (data as Uint8Array);
    const bytes = new Uint8Array(raw); // salin keluar dari heap WASM (aman dari detach)
    if (!bytes.byteLength) throw new Error('Hasil ffmpeg kosong');
    return new Blob([bytes], { type: mimeForContainer(container) });
  } finally {
    if (onProgress) ff.off('progress', onProg);
    for (const n of [...inNames, out]) { try { await ff.deleteFile(n); } catch { /* mungkin tak ada */ } }
  }
}
