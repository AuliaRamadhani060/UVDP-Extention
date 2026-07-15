// Media Library — UI utama (Blueprint §5.8), berjalan di side panel / sidebar.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { sendUi } from '@/shared/messaging';
import { t } from '@/i18n';
import { sizeHuman } from '@/core/url-utils';
import {
  mediaKind, mediaDisplayName, mediaOrigin, mediaQualityLabel, formatDuration,
  mediaRelevanceScore, buildFfmpegCommand,
} from '@/core/media-utils';
import { getFavorites, toggleFavorite, getHistory, type HistoryEntry } from '@/shared/store';
import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/ui/components/ThemeSwitcher';
import { Icon } from '@/ui/components/Icons';
import type { MediaItem, DownloadProgress } from '@/shared/types';
import type { BroadcastMessage } from '@/shared/contract';
import './panel.css';

type Tab = 'media' | 'favorites' | 'history' | 'downloads';
type Filter = 'all' | 'file' | 'hls' | 'dash';
type Sort = 'relevance' | 'newest' | 'quality';
interface DlState { done: number; total: number; status: string }

function displayKind(m: MediaItem): 'mse' | 'hls' | 'dash' | 'direct' | 'fragmented' {
  if (m.kind === 'fragmented') return 'fragmented';
  if (/^blob:/i.test(m.url)) return 'mse';
  return mediaKind(m);
}
function kindLabelKey(k: string): string {
  return k === 'direct' ? 'kindLabel.direct' : `kindLabel.${k}`;
}
function tokensFor(m: MediaItem): string[] {
  const out: string[] = [];
  const q = mediaQualityLabel(m); if (q) out.push(q);
  const d = formatDuration(m.duration); if (d) out.push(d);
  if (m.sizeBytes) out.push(sizeHuman(m.sizeBytes));
  if (m.segmentCount) out.push(t('token.segments', { n: m.segmentCount }));
  if (m.variants?.length) out.push(t('token.qualities', { n: m.variants.length }));
  if (m.audioTracks?.length) out.push(t('token.audio', { n: m.audioTracks.length }));
  if (m.subtitles?.length) out.push(t('token.subtitle', { n: m.subtitles.length }));
  return out;
}

export function SidePanel() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [tab, setTab] = useState<Tab>('media');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('relevance');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DlState>>({});
  const [dls, setDls] = useState<DownloadProgress[]>([]);
  const [activeTab, setActiveTab] = useState<number | undefined>();

  const refreshDownloads = () => sendUi<DownloadProgress[]>({ type: 'GET_DOWNLOADS' }).then((d) => setDls(d || []));
  const activeTabRef = useRef<number | undefined>(undefined);
  activeTabRef.current = activeTab;

  async function refresh(tabId?: number) {
    const res = await sendUi<{ entries: MediaItem[] }>({ type: 'GET_MEDIA_LIST', payload: { tabId } });
    setItems(res?.entries || []);
  }

  useEffect(() => {
    (async () => {
      const [tabInfo] = await browser.tabs.query({ active: true, currentWindow: true });
      setActiveTab(tabInfo?.id);
      refresh(tabInfo?.id);
    })();
    getFavorites().then(setFavorites);
    getHistory().then(setHistory);
    refreshDownloads();

    const onMsg = (raw: unknown) => {
      const msg = raw as BroadcastMessage;
      if (msg?.type === 'MEDIA_LIST_UPDATED') refresh(activeTabRef.current);
      else if (msg?.type === 'DOWNLOAD_PROGRESS') setDownloads((d) => ({ ...d, [msg.payload.id]: { done: msg.payload.done, total: msg.payload.total, status: 'downloading' } }));
      else if (msg?.type === 'DOWNLOAD_DONE') { setDownloads((d) => ({ ...d, [msg.payload.id]: { ...(d[msg.payload.id] || { done: 1, total: 1 }), status: 'complete' } })); refreshDownloads(); }
      else if (msg?.type === 'DOWNLOAD_ERROR') refreshDownloads();
    };
    browser.runtime.onMessage.addListener(onMsg);
    const onActivated = (info: { tabId: number }) => { setActiveTab(info.tabId); refresh(info.tabId); };
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      browser.runtime.onMessage.removeListener(onMsg);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, file: 0, hls: 0, dash: 0, favorites: 0 };
    for (const m of items) {
      const k = displayKind(m);
      if (k === 'hls') c.hls++; else if (k === 'dash') c.dash++; else c.file++;
      if (favorites.includes(m.url)) c.favorites++;
    }
    return c;
  }, [items, favorites]);

  const primaryId = useMemo(() => {
    const top = items.slice().sort((a, b) => mediaRelevanceScore(b) - mediaRelevanceScore(a))[0];
    return top && (top.source === 'dom' || (top.variants?.length || 0) > 0 || displayKind(top) !== 'direct') ? top.id : '';
  }, [items]);

  const visible = useMemo(() => {
    let list = items.slice();
    if (tab === 'favorites') list = list.filter((m) => favorites.includes(m.url));
    if (filter !== 'all') list = list.filter((m) => { const k = displayKind(m); return filter === 'file' ? k === 'direct' || k === 'mse' || k === 'fragmented' : k === filter; });
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((m) => m.url.toLowerCase().includes(q) || mediaDisplayName(m).toLowerCase().includes(q) || mediaOrigin(m).toLowerCase().includes(q));
    }
    list.sort((a, b) =>
      sort === 'quality' ? (b.bestVariant?.height || 0) - (a.bestVariant?.height || 0)
      : sort === 'newest' ? b.lastSeen - a.lastSeen
      : mediaRelevanceScore(b) - mediaRelevanceScore(a));
    return list;
  }, [items, filter, tab, query, sort, favorites]);

  async function onFavorite(m: MediaItem) { setFavorites(await toggleFavorite(m.url)); }
  function toggleSelect(id: string) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  async function copyUrl(url: string) { await navigator.clipboard.writeText(url); sendUi({ type: 'NOTIFY', payload: { title: 'UVPD', message: t('media.copied') } }); }
  async function copyFfmpeg(m: MediaItem) { await navigator.clipboard.writeText(buildFfmpegCommand(m.url)); sendUi({ type: 'NOTIFY', payload: { title: 'UVPD', message: 'ffmpeg → clipboard' } }); }
  function batchDownload() {
    for (const id of selected) {
      const m = items.find((x) => x.id === id);
      if (m && displayKind(m) === 'direct' && !m.protected) sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id } });
    }
    setSelected(new Set());
  }

  const filters: Array<{ id: Filter; key: string; n: number }> = [
    { id: 'all', key: 'filter.all', n: counts.all },
    { id: 'file', key: 'filter.file', n: counts.file },
    { id: 'hls', key: 'filter.hls', n: counts.hls },
    { id: 'dash', key: 'filter.dash', n: counts.dash },
  ];

  return (
    <div class="sp">
      <header class="sp__head">
        <span class="sp__logo"><Icon.film size={18} /></span>
        <div class="sp__titles">
          <div class="sp__name">{t('app.name')}</div>
          <div class="sp__sub">{t('count.summary', { shown: visible.length, total: items.length })}</div>
        </div>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </header>

      <nav class="tabs">
        <button class={`tab ${tab === 'media' ? 'is-active' : ''}`} onClick={() => setTab('media')}>{t('tab.media')}</button>
        <button class={`tab ${tab === 'favorites' ? 'is-active' : ''}`} onClick={() => setTab('favorites')}><Icon.star size={13} /> {t('tab.favorites')} <b>{counts.favorites}</b></button>
        <button class={`tab ${tab === 'history' ? 'is-active' : ''}`} onClick={() => setTab('history')}><Icon.clock size={13} /> {t('tab.history')}</button>
        <button class={`tab ${tab === 'downloads' ? 'is-active' : ''}`} onClick={() => { setTab('downloads'); refreshDownloads(); }}><Icon.download size={13} /> {t('tab.downloads')} {dls.length > 0 && <b>{dls.length}</b>}</button>
      </nav>

      {tab === 'downloads' ? (
        <ul class="list">
          {dls.length === 0 && <li class="empty"><strong>{t('empty.none')}</strong></li>}
          {dls.map((d) => {
            const live = downloads[d.id];
            const done = live?.done ?? d.loaded;
            const total = live?.total ?? d.total;
            const status = live?.status ?? d.status;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <li key={d.id} class="dl">
                <div class="dl__body">
                  <div class="dl__name" title={d.filename}>{d.filename}</div>
                  <div class="dl__meta">
                    <span class={`dl__status dl__status--${status}`}>{status}</span>
                    {total > 0 && status === 'downloading' && <span>{pct}% · {sizeHuman(done)}</span>}
                  </div>
                  {status === 'downloading' && total > 0 && <div class="progress"><div class="progress__bar" style={{ width: `${pct}%` }} /></div>}
                </div>
                {status === 'downloading' ? (
                  <button class="iconbtn" title={t('media.clear')} onClick={() => sendUi({ type: 'DOWNLOAD_CANCEL', payload: { id: d.id } })}><Icon.close size={14} /></button>
                ) : status === 'error' ? (
                  <button class="btn" onClick={() => sendUi({ type: 'DOWNLOAD_RETRY', payload: { id: d.id } })}>↻</button>
                ) : (
                  <span class="dl__done"><Icon.check size={14} /></span>
                )}
              </li>
            );
          })}
        </ul>
      ) : tab === 'history' ? (
        <ul class="list">
          {history.length === 0 && <li class="empty"><strong>{t('empty.none')}</strong></li>}
          {history.slice(0, 100).map((h) => (
            <li key={h.url + h.time} class="hist">
              <span class="hist__url" title={h.url}>{h.url}</span>
              <button class="iconbtn" onClick={() => copyUrl(h.url)} title={t('media.copyLink')}><Icon.copy size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div class="filters">
            {filters.map((f) => (
              <button key={f.id} class={`chip ${filter === f.id && tab === 'media' ? 'is-active' : ''}`} onClick={() => { setFilter(f.id); setTab('media'); }}>
                {t(f.key)} <span class="chip__n">{f.n}</span>
              </button>
            ))}
          </div>
          <div class="toolbar">
            <label class="search"><Icon.search size={14} /><input placeholder={t('search.placeholder')} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} /></label>
            <select class="select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)} aria-label={t('sort.label')}>
              <option value="relevance">{t('sort.relevance')}</option>
              <option value="newest">{t('sort.newest')}</option>
              <option value="quality">{t('sort.quality')}</option>
            </select>
          </div>

          <ul class="list">
            {visible.length === 0 && (
              <li class="empty">
                <strong>{items.length ? t('empty.noMatch') : t('empty.none')}</strong>
                <span>{items.length ? t('empty.hintNoMatch') : t('empty.hintNone')}</span>
              </li>
            )}
            {visible.map((m) => {
              const kind = displayKind(m);
              const fav = favorites.includes(m.url);
              const dl = downloads[m.id];
              const isMain = m.id === primaryId;
              const isStream = kind === 'hls' || kind === 'dash';
              return (
                <li key={m.id} class={`card ${m.protected ? 'is-protected' : ''} ${isMain ? 'is-main' : ''}`}>
                  <label class="card__check"><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} /></label>
                  <span class={`card__icon k-${kind}`}>{kind === 'direct' || kind === 'mse' ? <Icon.film size={16} /> : <Icon.stream size={16} />}</span>
                  <div class="card__body">
                    <div class="card__title" title={m.url}>{m.title || mediaDisplayName(m)}</div>
                    <div class="card__tags">
                      <span class={`badge k-${kind}`}>{t(kindLabelKey(kind))}</span>
                      {isMain && <span class="badge badge--main">{t('badge.main')}</span>}
                      <span class="muted">{mediaOrigin(m)}</span>
                      {m.protected && <span class="badge badge--drm"><Icon.shield size={11} /> DRM</span>}
                    </div>
                    <div class="card__url" title={m.url}>{m.url}</div>
                    <div class="card__meta">
                      <span class="muted">{t(`source.${m.source}`)}</span>
                      {tokensFor(m).map((tok, i) => <span key={i} class="tok">{tok}</span>)}
                    </div>
                    {m.variants && m.variants.length > 0 && (
                      <div class="variants">
                        {m.variants.slice(0, 4).map((v, i) => (
                          <span key={i} class={`vchip ${m.bestVariant?.url === v.url ? 'is-best' : ''}`}>{v.resolution || `${v.height || ''}p`}</span>
                        ))}
                        {m.variants.length > 4 && <span class="vchip vchip--more">+{m.variants.length - 4}</span>}
                      </div>
                    )}
                    <div class="card__actions">
                      {m.protected ? (
                        <span class="lock"><Icon.shield size={13} /> {t('media.protected')}</span>
                      ) : (
                        <>
                          {kind !== 'mse' && kind !== 'fragmented' && <button class="btn btn--primary" onClick={() => sendUi({ type: 'PLAY_MEDIA', payload: { id: m.id } })}><Icon.play size={13} /> {t('media.play')}</button>}
                          {(kind !== 'mse' || m.url.startsWith('mse://')) && <button class="btn" onClick={() => sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id: m.id } })}><Icon.download size={13} /> {t('media.download')}</button>}
                          {isStream && <button class="btn" onClick={() => copyFfmpeg(m)}>{t('media.ffmpeg')}</button>}
                        </>
                      )}
                      <button class="btn btn--ghost" onClick={() => copyUrl(m.url)} title={t('media.copyLink')}><Icon.copy size={13} /></button>
                      <button class={`btn btn--ghost ${fav ? 'is-fav' : ''}`} onClick={() => onFavorite(m)} title={t('media.favorite')}><Icon.star size={13} /></button>
                    </div>
                    {dl && dl.total > 0 && dl.status !== 'complete' && (
                      <div class="progress"><div class="progress__bar" style={{ width: `${Math.round((dl.done / dl.total) * 100)}%` }} /></div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {selected.size > 0 && (
            <footer class="selbar">
              <span>{t('media.selected', { n: selected.size })}</span>
              <button class="btn btn--primary" onClick={batchDownload}><Icon.download size={13} /> {t('media.downloadSelected')}</button>
              <button class="btn btn--ghost" onClick={() => setSelected(new Set())}>{t('media.clear')}</button>
            </footer>
          )}
        </>
      )}
    </div>
  );
}
