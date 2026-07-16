// Media Library (side panel) — wujud ringkas. Memakai LibraryView bersama (list).
import { useMemo } from 'react';
import { Film, RefreshCw, Sun, Moon, Monitor, Rows3, LayoutGrid } from 'lucide-react';
import { useUvpd, useUvpdBridge, useApplyTheme, type Accent } from '@/ui/store/uvpd';
import { viewKind } from '@/ui/lib/media-view';
import { LibraryView } from '@/ui/components/library/LibraryView';
import { StatCard } from '@/ui/components/library/StatCard';
import { Toaster } from '@/ui/components/Toaster';
import { t, LOCALES, setLocale, localeSignal } from '@/i18n';

const ACCENTS: Array<{ id: Accent; color: string }> = [
  { id: 'azure', color: '#5b8def' },
  { id: 'emerald', color: '#35d6a0' },
  { id: 'magenta', color: '#ff6fb3' },
  { id: 'amber', color: '#f5b54a' },
];

export function HeaderControls() {
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

export function SidePanel() {
  useUvpdBridge();
  useApplyTheme();
  const media = useUvpd((s) => s.media);
  const favorites = useUvpd((s) => s.favorites);
  const stats = useMemo(() => {
    const all = Object.values(media);
    const streams = all.filter((m) => { const k = viewKind(m); return k === 'hls' || k === 'dash' || k === 'fragmented'; }).length;
    return { total: all.length, streams };
  }, [media]);

  return (
    <div className="rs-root rs-ambient relative flex h-screen flex-col">
      <header className="relative z-10 flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--rs-line)' }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: 'color-mix(in oklab, var(--rs-accent) 18%, transparent)', color: 'var(--rs-accent)' }}><Film size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="rs-display text-[16px] leading-none" style={{ color: 'var(--rs-tx)' }}>UVPD</div>
          <div className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{t('count.total', { total: stats.total })}</div>
        </div>
        <HeaderControls />
      </header>

      {stats.total > 0 && (
        <div className="relative z-10 grid grid-cols-3 gap-2 px-4 pt-3">
          <StatCard label={t('stat.media')} value={stats.total} />
          <StatCard label={t('stat.streams')} value={stats.streams} color="var(--hls)" />
          <StatCard label={t('stat.favorites')} value={favorites.length} color="var(--warn)" />
        </div>
      )}

      <LibraryView layout="list" />
      <Toaster />
    </div>
  );
}
