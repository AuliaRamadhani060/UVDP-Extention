// Registry media terpusat & PERSISTED (Blueprint §5.4b, §9).
// Menyimpan write-through ke chrome.storage.session agar tidak hilang saat
// service worker tidur; rehydrate (merge) saat SW bangun.
import { browser } from '@/platform/browser';
import type { MediaItem } from '@/shared/types';
import { stableVideoId } from './url-utils';

const STORE_KEY = 'uvpd:registry';

export class MediaRegistry {
  private items = new Map<string, MediaItem>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Selesai saat rehydrate awal beres (untuk handler yang mau menunggu). */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.hydrate();
  }

  /** Muat dari storage.session dan MERGE ke memori (tidak menimpa upsert dini). */
  private async hydrate(): Promise<void> {
    try {
      const res = await browser.storage.session.get(STORE_KEY);
      const stored = (res[STORE_KEY] as MediaItem[]) || [];
      for (const it of stored) {
        if (!this.items.has(it.id)) this.items.set(it.id, it);
      }
    } catch {
      /* session storage tak tersedia — jalan tanpa persistensi */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      browser.storage.session.set({ [STORE_KEY]: Array.from(this.items.values()) }).catch(() => {});
    }, 250);
  }

  upsert(partial: Partial<MediaItem> & { url: string }): MediaItem {
    const id = partial.id || stableVideoId(partial.url, partial.pageUrl);
    const now = Date.now();
    const existing = this.items.get(id);
    if (existing) {
      const merged: MediaItem = {
        ...existing,
        ...partial,
        id,
        firstSeen: existing.firstSeen,
        lastSeen: now,
        protected: existing.protected || !!partial.protected,
        variants: partial.variants?.length ? partial.variants : existing.variants,
        audioTracks: partial.audioTracks?.length ? partial.audioTracks : existing.audioTracks,
        subtitles: partial.subtitles?.length ? partial.subtitles : existing.subtitles,
      };
      this.items.set(id, merged);
      this.schedulePersist();
      return merged;
    }
    const created: MediaItem = {
      kind: 'unknown',
      pageUrl: '',
      protected: false,
      source: 'network',
      ...partial,
      id,
      url: partial.url,
      firstSeen: now,
      lastSeen: now,
    } as MediaItem;
    this.items.set(id, created);
    this.schedulePersist();
    return created;
  }

  get(id: string): MediaItem | undefined {
    return this.items.get(id);
  }

  list(tabId?: number): MediaItem[] {
    const all = Array.from(this.items.values());
    const filtered = tabId === undefined ? all : all.filter((m) => m.tabId === tabId);
    return filtered.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  removeByTab(tabId: number): void {
    let changed = false;
    for (const [id, item] of this.items) {
      if (item.tabId === tabId) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  clear(): void {
    this.items.clear();
    this.schedulePersist();
  }
}
