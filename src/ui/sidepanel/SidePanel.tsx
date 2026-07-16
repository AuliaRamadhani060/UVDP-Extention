// Media Library (U1) — desain "Ruang Sinyal": kartu kaya + provenance + kualitas.
import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Film, RefreshCw, Sun, Moon, Monitor, Rows3, LayoutGrid, ScanSearch } from 'lucide-react';
import { useUvpd, useUvpdBridge, useApplyTheme, type Accent, type SortKind } from '@/ui/store/uvpd';
import { computeVisible, primaryId } from '@/ui/lib/media-view';
import { MediaCard } from '@/ui/components/library/MediaCard';
import { FilterChips } from '@/ui/components/library/FilterChips';
import { SearchBar } from '@/ui/components/library/SearchBar';
import { StatCard } from '@/ui/components/library/StatCard';
import { Toaster } from '@/ui/components/Toaster';
import { t, LOCALES, setLocale, localeSignal } from '@/i18n';
import { viewKind } from '@/ui/lib/media-view';

const ACCENTS: Array<{ id: Accent; color: string }> = [
  { id: 'azure', color: '#5b8def' },
  { id: 'emerald', color: '#35d6a0' },
  { id: 'magenta', color: '#ff6fb3' },
  { id: 'amber', color: '#f5b54a' },
];

function HeaderControls() {
  const theme = useUvpd((s) => s.theme);
  const setTheme = useUvpd((s) => s.setTheme);
  const accent = useUvpd((s) => s.accent);
  const setAccent = useUvpd((s) => s.setAccent);
  const density = useUvpd((s) => s.density);
  const setDensity = useUvpd((s) => s.setDensity);
  const rescan = useUvpd((s) => s.rescan);
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const btnStyle = { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' } as const;

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} style={btnStyle} title={t('action.rescan')} aria-label={t('action.rescan')} onClick={() => rescan()}><RefreshCw size={13} /></button>
      <button type="button" className={btn} style={btnStyle} title={t('settings.theme')} aria-label={t('settings.theme')} onClick={() => setTheme(nextTheme)}><ThemeIcon size={13} /></button>
      <button type="button" className={btn} style={btnStyle} title={t('ui.density')} aria-label={t('ui.density')} onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}>
        {density === 'comfortable' ? <Rows3 size={13} /> : <LayoutGrid size={13} />}
      </button>
      <div className="flex items-center gap-1 px-0.5" role="group" aria-label={t('ui.accent')}>
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.id}
            aria-label={`${t('ui.accent')}: ${a.id}`}
            aria-pressed={accent === a.id}
            onClick={() => setAccent(a.id)}
            className="h-3.5 w-3.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: a.color, outline: accent === a.id ? '2px solid var(--rs-tx)' : 'none', outlineOffset: '1px' }}
          />
        ))}
      </div>
      <select
        value={localeSignal.value}
        onChange={(e) => setLocale((e.target as HTMLSelectElement).value)}
        aria-label={t('settings.language')}
        className="h-7 rounded-md px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={btnStyle}
      >
        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>)}
      </select>
    </div>
  );
}

function SortSelect() {
  const sort = useUvpd((s) => s.sort);
  const setSort = useUvpd((s) => s.setSort);
  const opts: Array<{ v: SortKind; k: string }> = [
    { v: 'relevance', k: 'sort.relevance' },
    { v: 'recent', k: 'sort.newest' },
    { v: 'quality', k: 'sort.quality' },
  ];
  return (
    <select
      value={sort}
      onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKind)}
      aria-label={t('sort.label')}
      className="rounded-md px-2 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}
    >
      {opts.map((o) => <option key={o.v} value={o.v}>{t(o.k)}</option>)}
    </select>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-card" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
      <div style={{ aspectRatio: '16 / 9', background: 'var(--rs-card-hi)' }} />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-3 w-3/4 rounded" style={{ background: 'var(--rs-card-hi)' }} />
        <div className="h-2 w-1/2 rounded" style={{ background: 'var(--rs-card-hi)' }} />
        <div className="h-2 w-2/3 rounded" style={{ background: 'var(--rs-card-hi)' }} />
      </div>
    </div>
  );
}

export function SidePanel() {
  useUvpdBridge();
  useApplyTheme();
  const media = useUvpd((s) => s.media);
  const filter = useUvpd((s) => s.filter);
  const query = useUvpd((s) => s.query);
  const sort = useUvpd((s) => s.sort);
  const favorites = useUvpd((s) => s.favorites);
  const loading = useUvpd((s) => s.loading);

  const visible = useMemo(() => computeVisible(media, { filter, query, sort, favorites }), [media, filter, query, sort, favorites]);
  const mainId = useMemo(() => primaryId(media), [media]);
  const stats = useMemo(() => {
    const all = Object.values(media);
    const streams = all.filter((m) => { const k = viewKind(m); return k === 'hls' || k === 'dash' || k === 'fragmented'; }).length;
    return { total: all.length, streams };
  }, [media]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 250,
    overscan: 6,
  });

  return (
    <div className="rs-root rs-ambient relative flex h-screen flex-col">
      <header className="relative z-10 flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--rs-line)' }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: 'color-mix(in oklab, var(--rs-accent) 18%, transparent)', color: 'var(--rs-accent)' }}><Film size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="rs-display text-[16px] leading-none" style={{ color: 'var(--rs-tx)' }}>UVPD</div>
          <div className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{t('count.summary', { shown: visible.length, total: stats.total })}</div>
        </div>
      </header>

      <div className="relative z-10 flex items-center justify-end px-4 pt-2"><HeaderControls /></div>

      {stats.total > 0 && (
        <div className="relative z-10 grid grid-cols-3 gap-2 px-4 pt-3">
          <StatCard label={t('stat.media')} value={stats.total} />
          <StatCard label={t('stat.streams')} value={stats.streams} color="var(--hls)" />
          <StatCard label={t('stat.favorites')} value={favorites.length} color="var(--warn)" />
        </div>
      )}

      <div className="relative z-10 flex flex-col gap-2 px-4 py-3">
        <FilterChips />
        <div className="flex items-center gap-2"><SearchBar /><SortSelect /></div>
      </div>

      <div ref={parentRef} className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
        {loading && visible.length === 0 ? (
          <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ScanSearch size={30} style={{ color: 'var(--rs-tx-3)' }} />
            <div className="text-[13px]" style={{ color: 'var(--rs-tx)' }}>{stats.total ? t('empty.noMatch') : t('empty.none')}</div>
            <div className="text-[12px]" style={{ color: 'var(--rs-tx-3)' }}>{stats.total ? t('empty.hintNoMatch') : t('empty.hintNone')}</div>
          </div>
        ) : (
          <div className="relative" style={{ height: `${virt.getTotalSize()}px` }}>
            {virt.getVirtualItems().map((vi) => {
              const m = visible[vi.index];
              return (
                <div
                  key={m.id}
                  data-index={vi.index}
                  ref={virt.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)`, paddingBottom: 'var(--rs-density-gap)' }}
                >
                  <MediaCard media={m} isMain={m.id === mainId} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Toaster />
    </div>
  );
}
