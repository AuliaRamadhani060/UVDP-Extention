// Konversi subtitle WebVTT → SubRip (SRT). Pemutar/aplikasi desktop umumnya
// lebih menerima SRT. Konversi murni-string (tanpa DOM) agar jalan di mana saja.

/** Ubah timestamp VTT (mm:ss.mmm / hh:mm:ss.mmm) → SRT (hh:mm:ss,mmm). */
function vttTimeToSrt(ts: string): string {
  const t = ts.trim();
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return t;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2].padStart(2, '0');
  const sec = m[3].padStart(2, '0');
  const ms = m[4].padEnd(3, '0').slice(0, 3);
  return `${String(h).padStart(2, '0')}:${min}:${sec},${ms}`;
}

/** Konversi teks WebVTT menjadi teks SRT. */
export function vttToSrt(vtt: string): string {
  // Buang header WEBVTT + blok NOTE/STYLE/REGION; normalisasi newline.
  const text = vtt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: string[] = [];
  let idx = 1;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;

    // Cari baris waktu "start --> end" (buang setelan posisi cue).
    let timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const timeMatch = lines[timeLineIdx].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!timeMatch) continue;
    const start = vttTimeToSrt(timeMatch[1]);
    const end = vttTimeToSrt(timeMatch[2]);
    const contentLines = lines.slice(timeLineIdx + 1)
      // Bersihkan tag inline VTT (<c>, <v Name>, <00:00:00.000>, dsb.).
      .map((l) => l.replace(/<[^>]+>/g, ''));
    if (!contentLines.length) continue;
    cues.push(`${idx}\n${start} --> ${end}\n${contentLines.join('\n')}`);
    idx++;
  }
  return cues.join('\n\n') + (cues.length ? '\n' : '');
}

/** Apakah teks tampak seperti WebVTT (untuk memutuskan perlu konversi). */
export function looksLikeVtt(text: string): boolean {
  return /^﻿?WEBVTT/.test(text.trimStart());
}
