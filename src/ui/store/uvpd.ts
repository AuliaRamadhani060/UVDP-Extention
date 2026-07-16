// Store UI (Zustand) — Blueprint §5. Cache hasil broadcast background + view-state.
// Background TETAP sumber kebenaran; store = cache + preferensi tampilan.
import { create } from 'zustand';
import { useEffect } from 'react';
import { browser } from '@/platform/browser';
import { sendUi } from '@/shared/messaging';
import { getFavorites, toggleFavorite as persistToggleFav } from '@/shared/store';
import { buildFfmpegCommand } from '@/core/media-utils';
import type { MediaItem, DownloadProgress } from '@/shared/types';
import type { BroadcastMessage } from '@/shared/contract';

export type Theme = 'dark' | 'light' | 'system';
export type Accent = 'azure' | 'emerald' | 'magenta' | 'amber';
export type Density = 'comfortable' | 'compact';
export type FilterKind = 'all' | 'file' | 'hls' | 'dash' | 'mse' | 'fragmented' | 'favorites';
export type SortKind = 'relevance' | 'recent' | 'quality';
export type ManagerView = 'library' | 'player' | 'downloads' | 'settings';

const UI_KEY = 'uvpd:ui';

interface UvpdState {
  media: Record<string, MediaItem>;
  downloads: Record<string, DownloadProgress>;
  favorites: string[];
  activeTabId?: number;
  loading: boolean;
  // view-state
  view: ManagerView;
  selectedMediaId?: string;
  filter: FilterKind;
  query: string;
  sort: SortKind;
  theme: Theme;
  accent: Accent;
  density: Density;
  // mutations internal
  ingestList: (entries: MediaItem[]) => void;
  applyBroadcast: (msg: BroadcastMessage) => void;
  setActiveTab: (id?: number) => void;
  setLoading: (v: boolean) => void;
  setFavorites: (f: string[]) => void;
  // actions UI
  setView: (v: ManagerView) => void;
  setSelected: (id?: string) => void;
  setFilter: (f: FilterKind) => void;
  setQuery: (q: string) => void;
  setSort: (s: SortKind) => void;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
  toggleFavorite: (url: string) => Promise<void>;
  play: (id: string) => void;
  download: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  copyFfmpeg: (id: string) => Promise<void>;
  rescan: () => Promise<void>;
}

function persistUi(s: Pick<UvpdState, 'theme' | 'accent' | 'density'>): void {
  browser.storage.local.set({ [UI_KEY]: { theme: s.theme, accent: s.accent, density: s.density } }).catch(() => {});
}

export const useUvpd = create<UvpdState>((set, get) => ({
  media: {},
  downloads: {},
  favorites: [],
  loading: false,
  view: 'library',
  filter: 'all',
  query: '',
  sort: 'relevance',
  theme: 'system',
  accent: 'azure',
  density: 'comfortable',

  ingestList: (entries) => set({ media: Object.fromEntries(entries.map((e) => [e.id, e])) }),
  applyBroadcast: (msg) => {
    if (msg.type === 'MEDIA_LIST_UPDATED') {
      const { tabId, entries } = msg.payload;
      if (tabId === undefined || tabId === get().activeTabId) get().ingestList(entries);
    } else if (msg.type === 'DOWNLOAD_PROGRESS') {
      const p = msg.payload;
      set((st) => ({ downloads: { ...st.downloads, [p.id]: { ...(st.downloads[p.id] as DownloadProgress), id: p.id, loaded: p.done, total: p.total, status: 'downloading' } as DownloadProgress } }));
    } else if (msg.type === 'DOWNLOAD_DONE') {
      set((st) => ({ downloads: { ...st.downloads, [msg.payload.id]: { ...(st.downloads[msg.payload.id] as DownloadProgress), status: 'complete' } as DownloadProgress } }));
    } else if (msg.type === 'DOWNLOAD_ERROR') {
      set((st) => ({ downloads: { ...st.downloads, [msg.payload.id]: { ...(st.downloads[msg.payload.id] as DownloadProgress), status: 'error' } as DownloadProgress } }));
    }
  },
  setActiveTab: (id) => set({ activeTabId: id }),
  setLoading: (v) => set({ loading: v }),
  setFavorites: (f) => set({ favorites: f }),

  setView: (view) => set({ view }),
  setSelected: (selectedMediaId) => set({ selectedMediaId }),
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setTheme: (theme) => { set({ theme }); persistUi({ ...get(), theme }); },
  setAccent: (accent) => { set({ accent }); persistUi({ ...get(), accent }); },
  setDensity: (density) => { set({ density }); persistUi({ ...get(), density }); },
  toggleFavorite: async (url) => set({ favorites: await persistToggleFav(url) }),

  play: (id) => sendUi({ type: 'PLAY_MEDIA', payload: { id } }),
  download: (id) => sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id } }),
  cancel: (id) => sendUi({ type: 'DOWNLOAD_CANCEL', payload: { id } }),
  retry: (id) => sendUi({ type: 'DOWNLOAD_RETRY', payload: { id } }),
  copyFfmpeg: async (id) => {
    const m = get().media[id];
    if (!m) return;
    await navigator.clipboard.writeText(buildFfmpegCommand(m.url));
    sendUi({ type: 'NOTIFY', payload: { title: 'UVPD', message: 'ffmpeg → clipboard' } });
  },
  rescan: async () => {
    set({ loading: true });
    const res = await sendUi<{ entries: MediaItem[] }>({ type: 'GET_MEDIA_LIST', payload: { tabId: get().activeTabId } });
    get().ingestList(res?.entries || []);
    set({ loading: false });
  },
}));

/** Setup langganan background + preferensi UI. Panggil sekali di root side panel. */
export function useUvpdBridge(): void {
  useEffect(() => {
    const store = useUvpd.getState();
    (async () => {
      // preferensi UI tersimpan
      try {
        const res = await browser.storage.local.get(UI_KEY);
        const ui = res[UI_KEY] as Partial<Pick<UvpdState, 'theme' | 'accent' | 'density'>> | undefined;
        if (ui) useUvpd.setState({ theme: ui.theme ?? 'system', accent: ui.accent ?? 'azure', density: ui.density ?? 'comfortable' });
      } catch { /* noop */ }
      getFavorites().then(store.setFavorites);
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      store.setActiveTab(tab?.id);
      store.setLoading(true);
      const list = await sendUi<{ entries: MediaItem[] }>({ type: 'GET_MEDIA_LIST', payload: { tabId: tab?.id } });
      store.ingestList(list?.entries || []);
      store.setLoading(false);
    })();

    const onMsg = (raw: unknown) => useUvpd.getState().applyBroadcast(raw as BroadcastMessage);
    const onActivated = (info: { tabId: number }) => {
      useUvpd.getState().setActiveTab(info.tabId);
      useUvpd.getState().rescan();
    };
    browser.runtime.onMessage.addListener(onMsg);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      browser.runtime.onMessage.removeListener(onMsg);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, []);
}

/** Terapkan tema/aksen/densitas ke <html> (data-*). */
export function useApplyTheme(): void {
  const theme = useUvpd((s) => s.theme);
  const accent = useUvpd((s) => s.accent);
  const density = useUvpd((s) => s.density);
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-accent', accent);
    root.setAttribute('data-density', density);
  }, [theme, accent, density]);
}
