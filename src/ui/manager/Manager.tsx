// Media Manager (§2) — wujud tab penuh. RailNav + 4 view + ⌘K + transisi.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUvpd, useUvpdBridge, useApplyTheme, type ManagerView } from '@/ui/store/uvpd';
import { RailNav } from './RailNav';
import { HeaderControls } from '@/ui/sidepanel/SidePanel';
import { LibraryView } from '@/ui/components/library/LibraryView';
import { PlayerView } from './views/PlayerView';
import { DownloadsView } from './views/DownloadsView';
import { SettingsView } from './views/SettingsView';
import { CommandPalette } from '@/ui/components/CommandPalette';
import { Toaster } from '@/ui/components/Toaster';
import { t } from '@/i18n';

const TITLES: Record<ManagerView, string> = {
  library: 'nav.library', player: 'nav.player', downloads: 'nav.downloads', settings: 'nav.settings',
};

export function Manager() {
  useUvpdBridge();
  useApplyTheme();
  const [cmdOpen, setCmdOpen] = useState(false);
  const view = useUvpd((s) => s.view);

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
      <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
      <Toaster />
    </div>
  );
}
