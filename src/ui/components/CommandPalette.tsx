// Command palette (cmdk, ⌘K/Ctrl+K) — cari media + jalankan aksi. §6 U2.
import { useEffect } from 'react';
import { Command } from 'cmdk';
import { LayoutGrid, Play, Download, Settings, RefreshCw, DownloadCloud, Copy } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { viewKind, kindLabel, kindColorVar, smartName } from '@/ui/lib/media-view';
import { mediaKind } from '@/core/media-utils';
import { sendUi } from '@/shared/messaging';
import { t } from '@/i18n';
import type { LucideIcon } from 'lucide-react';

function Action({ icon: Icon, label, onSelect }: { icon: LucideIcon; label: string; onSelect: () => void }) {
  return (
    <Command.Item value={label} onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]" style={{ color: 'var(--rs-tx)' }}>
      <Icon size={15} style={{ color: 'var(--rs-tx-2)' }} /> {label}
    </Command.Item>
  );
}

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const media = useUvpd((s) => s.media);
  const setView = useUvpd((s) => s.setView);
  const setSelected = useUvpd((s) => s.setSelected);
  const rescan = useUvpd((s) => s.rescan);

  // Catatan (U6): pintasan ⌘K/Ctrl+K & Esc kini ditangani di Manager agar
  // komponen ini (beserta cmdk) bisa dimuat lazy — hanya saat palette dibuka.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const items = Object.values(media);
  const run = (fn: () => void) => { fn(); setOpen(false); };
  const downloadAllDirect = () => items.forEach((m) => { if (!m.protected && mediaKind(m) === 'direct') sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id: m.id } }); });
  const copyAllUrls = () => navigator.clipboard.writeText(items.map((m) => m.url).join('\n'));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" style={{ background: 'rgba(4,6,11,.62)' }} onClick={() => setOpen(false)} role="presentation">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl overflow-hidden rounded-xl" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line-2)', boxShadow: '0 24px 60px -24px rgba(0,0,0,.85)' }}>
        <Command label={t('cmd.open')} loop>
          <Command.Input autoFocus placeholder={t('cmd.placeholder')} className="w-full bg-transparent px-4 py-3 text-[14px] outline-none" style={{ color: 'var(--rs-tx)', borderBottom: '1px solid var(--rs-line)' }} />
          <Command.List className="max-h-[52vh] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-[13px]" style={{ color: 'var(--rs-tx-3)' }}>{t('empty.noMatch')}</Command.Empty>
            <Command.Group heading={t('cmd.actions')}>
              <Action icon={LayoutGrid} label={t('nav.library')} onSelect={() => run(() => setView('library'))} />
              <Action icon={Play} label={t('nav.player')} onSelect={() => run(() => setView('player'))} />
              <Action icon={Download} label={t('nav.downloads')} onSelect={() => run(() => setView('downloads'))} />
              <Action icon={Settings} label={t('nav.settings')} onSelect={() => run(() => setView('settings'))} />
              <Action icon={RefreshCw} label={t('action.rescan')} onSelect={() => run(() => rescan())} />
              <Action icon={DownloadCloud} label={t('cmd.downloadAll')} onSelect={() => run(downloadAllDirect)} />
              <Action icon={Copy} label={t('cmd.copyAll')} onSelect={() => run(copyAllUrls)} />
            </Command.Group>
            {items.length > 0 && (
              <Command.Group heading={t('tab.media')}>
                {items.map((m) => {
                  const k = viewKind(m);
                  return (
                    <Command.Item key={m.id} value={`${smartName(m)} ${m.url}`} onSelect={() => run(() => { setSelected(m.id); setView('player'); })} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]" style={{ color: 'var(--rs-tx)' }}>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: kindColorVar(k) }} />
                      <span className="min-w-0 flex-1 truncate">{smartName(m)}</span>
                      <span className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{kindLabel(k)}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
