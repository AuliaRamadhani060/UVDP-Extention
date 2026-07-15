// Persistensi bersama (settings, favorites, history) via chrome.storage.
// Dapat diakses langsung dari content script, popup, options, dan background.
import { browser } from '@/platform/browser';

export interface Settings {
  autoDetectIntervalMs: number;
  autoLoadHls: boolean;
  maxAutoVideos: number;
  redactHistoryQuery: boolean;
  disabledHosts: string[];
  player: { autoPlay: boolean; defaultSpeed: number; loop: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  autoDetectIntervalMs: 4000,
  autoLoadHls: true,
  maxAutoVideos: 200,
  redactHistoryQuery: true,
  disabledHosts: [],
  player: { autoPlay: false, defaultSpeed: 1.0, loop: false },
};

export interface HistoryEntry {
  url: string;
  time: number;
  type?: string;
}

const K_SETTINGS = 'uvpd:settings';
const K_FAVORITES = 'uvpd:favorites';
const K_HISTORY = 'uvpd:history';
const HISTORY_LIMIT = 500;

export async function getSettings(): Promise<Settings> {
  const res = await browser.storage.local.get(K_SETTINGS);
  const s = (res[K_SETTINGS] as Partial<Settings>) || {};
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    player: { ...DEFAULT_SETTINGS.player, ...(s.player || {}) },
  };
  merged.autoDetectIntervalMs = Math.max(1000, Math.min(60000, Number(merged.autoDetectIntervalMs) || 4000));
  merged.maxAutoVideos = Math.max(10, Math.min(2000, Number(merged.maxAutoVideos) || 200));
  merged.player.defaultSpeed = Math.max(0.25, Math.min(4, Number(merged.player.defaultSpeed) || 1));
  merged.disabledHosts = Array.isArray(s.disabledHosts)
    ? Array.from(new Set(s.disabledHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean)))
    : [];
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [K_SETTINGS]: settings });
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
