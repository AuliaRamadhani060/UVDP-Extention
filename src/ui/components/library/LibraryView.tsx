// LibraryView — Library yang DIPAKAI BERSAMA side panel (list) & Manager (grid).
// Satu sumber logika: filter/cari/sort + kartu tervirtualisasi. Layout via prop.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ScanSearch } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { computeVisible, primaryId } from '@/ui/lib/media-view';
import { MediaCard } from './MediaCard';
import { FilterChips } from './FilterChips';
import { ProvenanceChips } from './ProvenanceChips';
import { SearchBar } from './SearchBar';
import { t } from '@/i18n';
import type { SortKind } from '@/ui/store/uvpd';

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
      </div>
    </div>
  );
}

export function LibraryView({ layout = 'list', minCol = 280 }: { layout?: 'list' | 'grid'; minCol?: number }) {
  const media = useUvpd((s) => s.media);
  const filter = useUvpd((s) => s.filter);
  const provenance = useUvpd((s) => s.provenance);
  const query = useUvpd((s) => s.query);
  const sort = useUvpd((s) => s.sort);
  const favorites = useUvpd((s) => s.favorites);
  const loading = useUvpd((s) => s.loading);

  const visible = useMemo(() => computeVisible(media, { filter, query, sort, favorites, provenance }), [media, filter, query, sort, favorites, provenance]);
  const mainId = useMemo(() => primaryId(media), [media]);
  const total = Object.keys(media).length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setCols(layout === 'grid' ? Math.max(1, Math.floor(el.clientWidth / minCol)) : 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, minCol]);

  const rows = Math.ceil(visible.length / cols);
  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 260,
    overscan: 4,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-4 py-3">
        <FilterChips />
        <ProvenanceChips />
        <div className="flex items-center gap-2"><SearchBar /><SortSelect /></div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {loading && visible.length === 0 ? (
          <div className={layout === 'grid' ? 'grid gap-4' : 'flex flex-col gap-3'} style={layout === 'grid' ? { gridTemplateColumns: `repeat(${Math.max(cols, 2)}, minmax(0,1fr))` } : undefined}>
            {[0, 1, 2, 3, 4, 5].slice(0, layout === 'grid' ? 6 : 4).map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ScanSearch size={30} style={{ color: 'var(--rs-tx-3)' }} />
            <div className="text-[13px]" style={{ color: 'var(--rs-tx)' }}>{total ? t('empty.noMatch') : t('empty.none')}</div>
            <div className="text-[12px]" style={{ color: 'var(--rs-tx-3)' }}>{total ? t('empty.hintNoMatch') : t('empty.hintNone')}</div>
          </div>
        ) : (
          <div className="relative" style={{ height: `${virt.getTotalSize()}px` }}>
            {virt.getVirtualItems().map((vr) => {
              const items = visible.slice(vr.index * cols, vr.index * cols + cols);
              return (
                <div
                  key={vr.key}
                  data-index={vr.index}
                  ref={virt.measureElement}
                  className="absolute left-0 top-0 grid w-full"
                  style={{ transform: `translateY(${vr.start}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 'var(--rs-density-gap)', paddingBottom: 'var(--rs-density-gap)' }}
                >
                  {items.map((m) => <MediaCard key={m.id} media={m} isMain={m.id === mainId} />)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
