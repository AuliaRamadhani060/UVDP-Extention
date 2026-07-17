// Persistensi bersama (settings, favorites, history) via chrome.storage.
// Dapat diakses langsung dari content script, popup, options, dan background.
import { browser } from '@/platform/browser';

// ---- Preferensi tampilan (dipakai Options & store UI) ----
export type Theme = 'dark' | 'light' | 'system';
export type Accent = 'azure' | 'emerald' | 'magenta' | 'amber';
export type Density = 'comfortable' | 'compact';
export interface UiPrefs { theme: Theme; accent: Accent; density: Density }
export const DEFAULT_UI: UiPrefs = { theme: 'system', accent: 'azure', density: 'comfortable' };

// ---- Keybind player (U6) — dapat diubah user di Options ----
export type PlayerAction =
  | 'playPause' | 'seekBack' | 'seekFwd' | 'seekBack10' | 'seekFwd10'
  | 'volUp' | 'volDown' | 'mute' | 'fullscreen' | 'pip' | 'subtitle'
  | 'frameBack' | 'frameFwd' | 'screenshot' | 'stats' | 'loopA' | 'loopB' | 'loopClear' | 'help';
export type Keybinds = Record<PlayerAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  playPause: ' ', seekBack: 'ArrowLeft', seekFwd: 'ArrowRight', seekBack10: 'j', seekFwd10: 'l',
  volUp: 'ArrowUp', volDown: 'ArrowDown', mute: 'm', fullscreen: 'f', pip: 'p', subtitle: 'c',
  frameBack: ',', frameFwd: '.', screenshot: 's', stats: 'd', loopA: 'a', loopB: 'b',
  loopClear: 'u', help: '?',
};

export interface Settings {
  autoDetectIntervalMs: number;
  autoLoadHls: boolean;
  maxAutoVideos: number;
  redactHistoryQuery: boolean;
  disabledHosts: string[];
  player: { autoPlay: boolean; defaultSpeed: number; loop: boolean };
  maxConcurrentDownloads: number;
  keybinds: Keybinds;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoDetectIntervalMs: 4000,
  autoLoadHls: true,
  maxAutoVideos: 200,
  redactHistoryQuery: true,
  disabledHosts: [],
  player: { autoPlay: false, defaultSpeed: 1.0, loop: false },
  maxConcurrentDownloads: 3,
  keybinds: { ...DEFAULT_KEYBINDS },
  onboarded: false,
};

export interface HistoryEntry {
  url: string;
  time: number;
  type?: string;
}

const K_SETTINGS = 'uvpd:settings';
const K_FAVORITES = 'uvpd:favorites';
const K_HISTORY = 'uvpd:history';
export const K_UI = 'uvpd:ui';
const HISTORY_LIMIT = 500;

export async function getSettings(): Promise<Settings> {
  const res = await browser.storage.local.get(K_SETTINGS);
  const s = (res[K_SETTINGS] as Partial<Settings>) || {};
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    player: { ...DEFAULT_SETTINGS.player, ...(s.player || {}) },
  };
  merged.keybinds = { ...DEFAULT_KEYBINDS, ...(s.keybinds || {}) };
  merged.autoDetectIntervalMs = Math.max(1000, Math.min(60000, Number(merged.autoDetectIntervalMs) || 4000));
  merged.maxAutoVideos = Math.max(10, Math.min(2000, Number(merged.maxAutoVideos) || 200));
  merged.player.defaultSpeed = Math.max(0.25, Math.min(4, Number(merged.player.defaultSpeed) || 1));
  merged.maxConcurrentDownloads = Math.max(1, Math.min(8, Number(merged.maxConcurrentDownloads) || 3));
  merged.disabledHosts = Array.isArray(s.disabledHosts)
    ? Array.from(new Set(s.disabledHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean)))
    : [];
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [K_SETTINGS]: settings });
}

// ---- Preferensi tampilan ----
export async function getUiPrefs(): Promise<UiPrefs> {
  try {
    const res = await browser.storage.local.get(K_UI);
    return { ...DEFAULT_UI, ...((res[K_UI] as Partial<UiPrefs>) || {}) };
  } catch {
    return { ...DEFAULT_UI };
  }
}
export async function saveUiPrefs(p: UiPrefs): Promise<void> {
  await browser.storage.local.set({ [K_UI]: p });
}

// ---- Export / import konfigurasi (.json) ----
// Kunci yang ikut diekspor. Sengaja TIDAK menyertakan riwayat & antrean:
// itu data jalan, bukan konfigurasi — dan riwayat bisa memuat URL sensitif.
const EXPORT_KEYS = [K_SETTINGS, K_UI, K_FAVORITES] as const;
export const CONFIG_FORMAT = 1;

export interface ExportedConfig {
  app: 'uvpd';
  format: number;
  exportedAt: number;
  data: Record<string, unknown>;
}

export async function exportConfig(): Promise<ExportedConfig> {
  const res = await browser.storage.local.get(EXPORT_KEYS as unknown as string[]);
  const data: Record<string, unknown> = {};
  for (const k of EXPORT_KEYS) if (res[k] !== undefined) data[k] = res[k];
  return { app: 'uvpd', format: CONFIG_FORMAT, exportedAt: Date.now(), data };
}

/** Terapkan konfigurasi hasil import. Hanya kunci yang dikenal yang ditulis. */
export async function importConfig(raw: unknown): Promise<{ ok: boolean; error?: string; applied?: number }> {
  const cfg = raw as Partial<ExportedConfig>;
  if (!cfg || cfg.app !== 'uvpd' || typeof cfg.data !== 'object' || !cfg.data) {
    return { ok: false, error: 'Bukan berkas konfigurasi UVPD' };
  }
  if (Number(cfg.format) > CONFIG_FORMAT) {
    return { ok: false, error: `Format ${cfg.format} lebih baru dari versi ini (${CONFIG_FORMAT})` };
  }
  const patch: Record<string, unknown> = {};
  for (const k of EXPORT_KEYS) if (cfg.data[k] !== undefined) patch[k] = cfg.data[k];
  if (!Object.keys(patch).length) return { ok: false, error: 'Tak ada kunci yang dikenali' };
  await browser.storage.local.set(patch);
  return { ok: true, applied: Object.keys(patch).length };
}

/** Kembalikan semua konfigurasi ke bawaan (tanpa menyentuh riwayat/favorit). */
export async function resetConfig(): Promise<void> {
  await browser.storage.local.set({ [K_SETTINGS]: DEFAULT_SETTINGS, [K_UI]: DEFAULT_UI });
}

export function isHostEnabled(settings: Settings, hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  return !host || !settings.disabledHosts.includes(host);
}

// ---- Favorites (set of media identity urls) ----
export async function getFavorites(): Promise<string[]> {
  const res = await browser.storage.local.get(K_FAVORITES);
  return (res[K_FAVORITES] as string[]) || [];
}

export async function toggleFavorite(url: string): Promise<string[]> {
  const list = new Set(await getFavorites());
  if (list.has(url)) list.delete(url);
  else list.add(url);
  const arr = Array.from(list);
  await browser.storage.local.set({ [K_FAVORITES]: arr });
  return arr;
}

// ---- History ----
export async function getHistory(): Promise<HistoryEntry[]> {
  const res = await browser.storage.local.get(K_HISTORY);
  return (res[K_HISTORY] as HistoryEntry[]) || [];
}

export async function pushHistory(entry: HistoryEntry): Promise<void> {
  const list = await getHistory();
  if (list.some((e) => e.url === entry.url)) return;
  list.unshift(entry);
  await browser.storage.local.set({ [K_HISTORY]: list.slice(0, HISTORY_LIMIT) });
}

export async function clearHistory(): Promise<void> {
  await browser.storage.local.set({ [K_HISTORY]: [] });
}
