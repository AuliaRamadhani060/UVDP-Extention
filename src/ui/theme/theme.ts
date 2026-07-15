// Store tema reaktif. 'system' mengikuti prefers-color-scheme.
import { signal } from '@preact/signals';
import { browser } from '@/platform/browser';

export type ThemeMode = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'uvpd:theme';

export const themeSignal = signal<ThemeMode>('system');

export function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const mode = themeSignal.value;
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  themeSignal.value = mode;
  applyTheme();
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: mode });
  } catch {
    /* abaikan */
  }
}

export async function initTheme(): Promise<void> {
  try {
    const res = await browser.storage.local.get(STORAGE_KEY);
    const saved = res[STORAGE_KEY] as ThemeMode | undefined;
    if (saved) themeSignal.value = saved;
  } catch {
    /* abaikan */
  }
  applyTheme();
}
