// Popup (M3) — permukaan cepat: list media tab aktif + aksi penuh (Putar,
// Unduh→Halaman Download, Salin, quick-quality), filter, pencarian. UI minimal
// (poles = M6). Aksi lewat jalur bersama `shared/actions`.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { mediaActions, copyUrl } from '@/shared/actions';
import { t } from '@/i18n';
import { sizeHuman } from '@/core/url-utils';
import { mediaKind, mediaDisplayName, mediaOrigin, mediaQualityLabel, formatDuration, mediaRelevanceScore } from '@/core/media-utils';
import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/ui/components/ThemeSwitcher';
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

  // Popup = halaman ekstensi (tanpa sender.tab) → selalu query tab aktif dulu,
  // agar list tetap tab-scoped baik saat mount maupun refresh live.
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

  function tokens(m: MediaItem): string[] {
    const out: string[] = [];
    const q = mediaQualityLabel(m); if (q) out.push(q);
    const d = formatDuration(m.duration); if (d) out.push(d);
    if (m.sizeBytes) out.push(sizeHuman(m.sizeBytes));
    return out;
  }

  return (
    <div class="pop">
      <header class="pop__head">
        <span class="pop__logo"><Icon.film size={16} /></span>
        <div class="pop__titles">
          <div class="pop__name">{t('app.name')}</div>
          <div class="pop__count">{t('count.total', { total: items.length })}</div>
        </div>
        <button class="pbtn" title={t('action.rescan')} onClick={() => refresh()}><Icon.search size={15} /></button>
        <button class="pbtn pbtn--primary" title={t('cmd.openManager')} onClick={openManager}><Icon.sidebar size={15} /></button>
        <button class="pbtn" title="Panel" onClick={openSidePanel}><Icon.film size={15} /></button>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </header>

      <div class="pop__controls">
        <div class="pop__filters">
          {FILTERS.map((f) => (
            <button key={f.v} class={`pchip ${filter === f.v ? 'is-on' : ''}`} onClick={() => setFilter(f.v)}>{t(f.k)}</button>
          ))}
        </div>
        <input class="pop__search" value={query} placeholder={t('search.placeholder')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      </div>

      {visible.length === 0 ? (
        <p class="pop__empty">{items.length ? t('empty.noMatch') : t('popup.empty')}</p>
      ) : (
        <ul class="pop__list">
          {visible.map((m) => {
            const kind = kindOf(m);
            const variants = (m.variants || []).filter((v) => v.url && (v.resolution || v.height));
            const canDownload = !m.protected && !(kind === 'mse' && !/^mse:\/\//.test(m.url));
            const canPlay = !m.protected && kind !== 'fragmented' && !(kind === 'mse' && /^blob:/i.test(m.url));
            return (
              <li key={m.id} class={`pcard ${m.protected ? 'is-protected' : ''}`}>
                <span class={`pcard__icon k-${kind}`}>{kind === 'hls' || kind === 'dash' ? <Icon.stream size={15} /> : <Icon.film size={15} />}</span>
                <div class="pcard__body">
                  <div class="pcard__title" title={m.url}>{m.title || mediaDisplayName(m)}</div>
                  <div class="pcard__meta">
                    <span class={`pbadge k-${kind}`}>{t(kind === 'direct' ? 'kindLabel.direct' : `kindLabel.${kind}`)}</span>
                    <span class="pmuted">{mediaOrigin(m)}</span>
                    {tokens(m).map((tok, i) => <span key={i} class="ptok">{tok}</span>)}
                  </div>
                </div>
                {m.protected ? (
                  <span class="pcard__lock" title={t('media.protected')}><Icon.shield size={13} /></span>
                ) : (
                  <div class="pcard__actions">
                    {canPlay && <button class="pbtn" onClick={() => mediaActions.play(m.id)} title={t('media.play')}><Icon.play size={13} /></button>}
                    {canDownload && <button class="pbtn pbtn--primary" onClick={() => mediaActions.openDownloader(m.id)} title={t('media.download')}><Icon.download size={13} /></button>}
                    {canDownload && variants.length > 1 && (
                      <select class="pquality" title={t('sort.quality')} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) mediaActions.quickDownload(m.id, { quality: v }); (e.target as HTMLSelectElement).value = ''; }}>
                        <option value="">{t('sort.quality')}</option>
                        {variants.slice().reverse().map((v, i) => { const lb = v.resolution || `${v.height}p`; return <option key={i} value={lb}>{lb}</option>; })}
                      </select>
                    )}
                    <button class="pbtn" onClick={() => copyUrl(m.url)} title={t('media.copyLink')}><Icon.copy size={13} /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
