// Ingat volume/kecepatan per-situs + posisi tonton per-media (chrome.storage).
import { browser } from '@/platform/browser';

const KEY = 'uvpd:player';

export interface HostPref { volume: number; speed: number; muted: boolean }
interface PlayerPrefs { hosts: Record<string, HostPref>; positions: Record<string, number> }

async function load(): Promise<PlayerPrefs> {
  try {
    const res = await browser.storage.local.get(KEY);
    const p = (res[KEY] as Partial<PlayerPrefs>) || {};
    return { hosts: p.hosts || {}, positions: p.positions || {} };
  } catch {
    return { hosts: {}, positions: {} };
  }
}

export function hostOf(pageUrlOrUrl: string): string {
  try { return new URL(pageUrlOrUrl).hostname || 'local'; } catch { return 'local'; }
}

export async function getHostPref(host: string): Promise<HostPref | undefined> {
  return (await load()).hosts[host];
}
export async function getPosition(mediaId: string): Promise<number | undefined> {
  return (await load()).positions[mediaId];
}
export async function saveHostPref(host: string, pref: HostPref): Promise<void> {
  const p = await load();
  p.hosts[host] = pref;
  await browser.storage.local.set({ [KEY]: p });
}
export async function savePosition(mediaId: string, seconds: number): Promise<void> {
  const p = await load();
  // Jangan simpan posisi hampir-awal atau hampir-selesai.
  if (seconds < 5) delete p.positions[mediaId];
  else p.positions[mediaId] = seconds;
  // Batasi jumlah entri.
  const keys = Object.keys(p.positions);
  if (keys.length > 300) delete p.positions[keys[0]];
  await browser.storage.local.set({ [KEY]: p });
}
