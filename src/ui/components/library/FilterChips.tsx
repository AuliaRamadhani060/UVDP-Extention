// FilterChips (§4.5) — chip filter berwarna per cara-pengiriman + hitungan.
import { useMemo } from 'react';
import { useUvpd, type FilterKind } from '@/ui/store/uvpd';
import { viewKind } from '@/ui/lib/media-view';
import { t } from '@/i18n';

const FILTERS: Array<{ id: FilterKind; key: string; color?: string }> = [
  { id: 'all', key: 'filter.all' },
  { id: 'file', key: 'filter.file', color: 'var(--direct)' },
  { id: 'hls', key: 'filter.hls', color: 'var(--hls)' },
  { id: 'dash', key: 'filter.dash', color: 'var(--dash)' },
  { id: 'fragmented', key: 'filter.frag', color: 'var(--frag)' },
  { id: 'favorites', key: 'filter.favorites', color: 'var(--warn)' },
];

export function FilterChips() {
  const media = useUvpd((s) => s.media);
  const favorites = useUvpd((s) => s.favorites);
  const filter = useUvpd((s) => s.filter);
  const setFilter = useUvpd((s) => s.setFilter);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, file: 0, hls: 0, dash: 0, fragmented: 0, favorites: 0 };
    for (const m of Object.values(media)) {
      c.all++;
      const k = viewKind(m);
      if (k === 'hls') c.hls++;
      else if (k === 'dash') c.dash++;
      else if (k === 'fragmented') c.fragmented++;
      else c.file++;
      if (favorites.includes(m.url)) c.favorites++;
    }
    return c;
  }, [media, favorites]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => {
        const active = filter === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={
              active
                ? { background: f.color || 'var(--rs-accent)', color: '#08111d', fontWeight: 600 }
                : { background: 'var(--rs-card)', color: 'var(--rs-tx-2)', border: '1px solid var(--rs-line)' }
            }
            aria-pressed={active}
          >
            {f.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? '#08111d' : f.color }} />}
            {t(f.key)}
            <span className="rs-mono text-[10px]" style={{ opacity: 0.75 }}>{counts[f.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
