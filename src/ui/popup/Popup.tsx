// Popup (M6) — permukaan cepat kelas satu: header temuan + filter + cari + daftar
// CompactCard (dipakai bersama dropdown). Tema "ruang sinyal". LOGIKA M3 tak
// berubah (jalur aksi shared/actions, filter/cari, live via broadcast).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { mediaActions } from '@/shared/actions';
import { t } from '@/i18n';
import { mediaKind, mediaDisplayName, mediaOrigin, mediaRelevanceScore } from '@/core/media-utils';
import { CompactCard, COMPACT_CARD_CSS } from '@/ui/components/CompactCard';
import { Icon } from '@/ui/components/Icons';
import type { MediaItem } from '@/shared/types';
import type { BroadcastMessage } from '@/shared/contract';
import './popup.css';

type PopFilter = 'all' | 'file' | 'hls' | 'dash';

function kindOf(m: MediaItem): 'mse' | 'hls' | 'dash' | 'direct' | 'fragmented' {
  if (m.kind === 'fragmented') return 'fragmented';
  return /^blob:/i.test(m.url) ? 'mse' : mediaKind(m);
}

async function openSidePanel(): Promise<void> {
  const c = chrome as unknown as { sidePanel?: { open: (o: { tabId?: number; windowId?: number }) => Promise<void> } };
  const b = browser as unknown as { sidebarAction?: { open: () => Promise<void> } };
  try {
    if (c.sidePanel?.open) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await c.sidePanel.open(tab?.id != null ? { tabId: tab.id } : { windowId: tab?.windowId as number });
    } else if (b.sidebarAction?.open) {
      await b.sidebarAction.open();
    }
    window.close();
  } catch { /* abaikan */ }
}
function openManager(): void {
  browser.tabs.create({ url: browser.runtime.getURL('src/ui/manager/manager.html') });
  window.close();
}

const FILTERS: Array<{ v: PopFilter; k: string }> = [
  { v: 'all', k: 'filter.all' }, { v: 'file', k: 'filter.file' }, { v: 'hls', k: 'filter.hls' }, { v: 'dash', k: 'filter.dash' },
];

export function Popup() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<PopFilter>('all');
  const [query, setQuery] = useState('');

  const refresh = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const res = await mediaActions.getList(tab?.id);
    setItems((res?.entries || []).slice().sort((a, b) => mediaRelevanceScore(b) - mediaRelevanceScore(a)));
  };

  useEffect(() => {
    refresh();
    const onMsg = (raw: unknown) => {
      const m = raw as BroadcastMessage;
      if (m?.type === 'MEDIA_LIST_UPDATED') refresh();
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter((m) => (filter === 'file' ? kindOf(m) === 'direct' : kindOf(m) === filter));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((m) => m.url.toLowerCase().includes(q) || (m.title || mediaDisplayName(m)).toLowerCase().includes(q) || mediaOrigin(m).toLowerCase().includes(q));
    return list;
  }, [items, filter, query]);

  return (
    <div class="pop rs-root">
      <style>{COMPACT_CARD_CSS}</style>
      <header class="pop__head">
        <span class="pop__logo"><Icon.film size={15} /></span>
        <div class="pop__titles">
          <div class="pop__name">{t('app.name')}</div>
          <div class="pop__count">{t('count.total', { total: items.length })}</div>
        </div>
        <button class="pop__ico" title={t('action.rescan')} aria-label={t('action.rescan')} onClick={() => refresh()}><Icon.search size={15} /></button>
        <button class="pop__ico" title="Panel" aria-label="Panel" onClick={openSidePanel}><Icon.sidebar size={15} /></button>
        <button class="pop__ico pop__ico--pri" title={t('cmd.openManager')} aria-label={t('cmd.openManager')} onClick={openManager}><Icon.film size={15} /></button>
      </header>

      <div class="pop__controls">
        <div class="pop__filters">
          {FILTERS.map((f) => (
            <button key={f.v} class={`pchip ${filter === f.v ? 'is-on' : ''}`} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>{t(f.k)}</button>
          ))}
        </div>
        <div class="pop__searchwrap">
          <Icon.search size={13} />
          <input class="pop__search" value={query} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </div>
      </div>

      {visible.length === 0 ? (
        <p class="pop__empty">{items.length ? t('empty.noMatch') : t('popup.empty')}</p>
      ) : (
        <div class="pop__list">
          {visible.map((m) => <CompactCard key={m.id} media={m} />)}
        </div>
      )}
    </div>
  );
}
