// Media Manager (§2) — wujud tab penuh. RailNav + 4 view + ⌘K + transisi.
import { useState, useEffect, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste } from 'lucide-react';
import { useUvpd, useUvpdBridge, useApplyTheme, type ManagerView } from '@/ui/store/uvpd';
import { useQueueBridge } from '@/ui/store/downloads';
import { useUrlIntake } from '@/ui/hooks/useUrlIntake';
import { RailNav } from './RailNav';
import { HeaderControls } from '@/ui/sidepanel/SidePanel';
import { LibraryView } from '@/ui/components/library/LibraryView';
import { PlayerView } from './views/PlayerView';
import { DownloadsView } from './views/DownloadsView';
import { SettingsView } from './views/SettingsView';
import { DownloadDock } from '@/ui/components/downloads/DownloadDock';
import { Toaster } from '@/ui/components/Toaster';
import { t } from '@/i18n';

// Perf (U6): cmdk hanya diunduh saat palette pertama kali dibuka.
const CommandPalette = lazy(() => import('@/ui/components/CommandPalette').then((m) => ({ default: m.CommandPalette })));

const TITLES: Record<ManagerView, string> = {
  library: 'nav.library', player: 'nav.player', downloads: 'nav.downloads', settings: 'nav.settings',
};

export function Manager() {
  useUvpdBridge();
  useQueueBridge();
  useApplyTheme();
  const dragging = useUrlIntake();
  const [cmdOpen, setCmdOpen] = useState(false);
  const view = useUvpd((s) => s.view);

  // Pintasan palette hidup di sini (ringan) agar komponen cmdk tetap lazy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((v) => !v); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="rs-root rs-ambient relative flex h-screen">
      <RailNav onCommand={() => setCmdOpen(true)} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--rs-line)' }}>
          <h1 className="rs-display flex-1 text-[18px]" style={{ color: 'var(--rs-tx)' }}>{t(TITLES[view])}</h1>
          <HeaderControls />
        </header>
        <div className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute inset-0 flex min-h-0 flex-col"
            >
              {view === 'library' ? <LibraryView layout="grid" minCol={300} />
                : view === 'player' ? <PlayerView />
                : view === 'downloads' ? <DownloadsView />
                : <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-xl" style={{ border: '2px dashed var(--rs-accent)', background: 'color-mix(in oklab, var(--rs-accent) 10%, transparent)' }}>
          <ClipboardPaste size={26} style={{ color: 'var(--rs-accent)' }} />
          <div className="text-[13px]" style={{ color: 'var(--rs-tx)' }}>{t('intake.drop')}</div>
        </div>
      )}
      {cmdOpen && (
        <Suspense fallback={null}>
          <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
        </Suspense>
      )}
      <DownloadDock />
      <Toaster />
    </div>
  );
}
