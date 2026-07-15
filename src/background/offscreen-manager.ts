// Manajemen offscreen document (Blueprint §5.5). Chromium-only: menyediakan
// DOMParser untuk parse DASH. Firefox tidak punya API offscreen — di sana
// background sudah punya DOMParser, jadi offscreen tidak diperlukan.
import { browser } from '@/platform/browser';
import type { OffscreenResponse } from '@/shared/contract';
import type { DashResult } from '@/core/dash-parser';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

// API offscreen hanya ada di Chromium. Diakses via cast agar netral tipe lintas-browser.
interface OffscreenApi {
  hasDocument?: () => Promise<boolean>;
  createDocument: (o: { url: string; reasons: string[]; justification: string }) => Promise<void>;
}
function getOffscreenApi(): OffscreenApi | null {
  const c = (typeof chrome !== 'undefined' ? chrome : undefined) as unknown as { offscreen?: OffscreenApi } | undefined;
  return c?.offscreen ?? null;
}

/** True bila platform mendukung offscreen (Chromium). Firefox: false → pakai DOMParser di background. */
export function isOffscreenAvailable(): boolean {
  return !!getOffscreenApi();
}

/** Parse DASH di offscreen (punya DOMParser). Dipakai di Chromium. */
export async function parseDashViaOffscreen(text: string, url: string): Promise<DashResult | null> {
  await ensureOffscreen();
  try {
    const res = (await browser.runtime.sendMessage({ type: 'PARSE_DASH', payload: { text, url } })) as
      | { type: string; payload: DashResult }
      | undefined;
    return res?.type === 'PARSE_DASH_RESULT' ? res.payload : null;
  } catch {
    return null;
  }
}

let creating: Promise<void> | null = null;

/** Pastikan offscreen document ada. Return false bila API tak tersedia (Firefox). */
export async function ensureOffscreen(): Promise<boolean> {
  const api = getOffscreenApi();
  if (!api) return false;
  try {
    const has = (await api.hasDocument?.()) ?? false;
    if (has) return true;
    if (!creating) {
      creating = api.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['DOM_PARSER'],
        justification: 'Parse DASH .mpd manifests with DOMParser (not available in service worker).',
      });
    }
    await creating;
    creating = null;
    return true;
  } catch {
    creating = null;
    return !!getOffscreenApi();
  }
}

/** Ping offscreen; true bila membalas PONG. */
export async function pingOffscreen(): Promise<boolean> {
  try {
    const res = (await browser.runtime.sendMessage({ type: 'OFFSCREEN_PING' })) as OffscreenResponse | undefined;
    return res?.type === 'OFFSCREEN_PONG';
  } catch {
    return false;
  }
}
