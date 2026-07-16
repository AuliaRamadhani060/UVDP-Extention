// RailNav — rail navigasi kiri Media Manager (§2). 4 view + petunjuk ⌘K.
import { LayoutGrid, Play, Download, Settings, Command as CmdIcon, Film } from 'lucide-react';
import { useUvpd, type ManagerView } from '@/ui/store/uvpd';
import { t } from '@/i18n';

const ITEMS: Array<{ v: ManagerView; icon: typeof LayoutGrid; key: string }> = [
  { v: 'library', icon: LayoutGrid, key: 'nav.library' },
  { v: 'player', icon: Play, key: 'nav.player' },
  { v: 'downloads', icon: Download, key: 'nav.downloads' },
  { v: 'settings', icon: Settings, key: 'nav.settings' },
];

export function RailNav({ onCommand }: { onCommand: () => void }) {
  const view = useUvpd((s) => s.view);
  const setView = useUvpd((s) => s.setView);
  const dlCount = useUvpd((s) => Object.values(s.downloads).filter((d) => d.status === 'downloading').length);

  return (
    <nav className="relative z-10 flex w-16 flex-col items-center gap-2 py-4" style={{ borderRight: '1px solid var(--rs-line)', background: 'var(--rs-surface)' }} aria-label="Media Manager">
      <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'color-mix(in oklab, var(--rs-accent) 18%, transparent)', color: 'var(--rs-accent)' }}><Film size={19} /></span>
      {ITEMS.map(({ v, icon: Icon, key }) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-current={active ? 'page' : undefined}
            title={t(key)}
            aria-label={t(key)}
            className="relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={active ? { background: 'color-mix(in oklab, var(--rs-accent) 20%, transparent)', color: 'var(--rs-accent)' } : { color: 'var(--rs-tx-3)' }}
          >
            <Icon size={19} />
            {v === 'downloads' && dlCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 rs-mono text-[9px] font-bold" style={{ background: 'var(--rs-accent)', color: '#08111d' }}>{dlCount}</span>
            )}
          </button>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <button type="button" onClick={onCommand} title="⌘K" aria-label={t('cmd.open')} className="flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ color: 'var(--rs-tx-3)' }}>
          <CmdIcon size={18} />
        </button>
        <span className="rs-mono text-[9px]" style={{ color: 'var(--rs-tx-3)' }}>⌘K</span>
      </div>
    </nav>
  );
}
