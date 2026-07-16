// DownloadDock — dok ringkas unduhan aktif (mengambang). Muncul saat ada job
// aktif; klik untuk lompat ke tab Unduhan. Ringkasan progres + kecepatan agregat.
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Pause, Play, X } from 'lucide-react';
import { useQueue } from '@/ui/store/downloads';
import { useUvpd } from '@/ui/store/uvpd';
import { sizeHuman } from '@/core/url-utils';
import { t } from '@/i18n';

export function DownloadDock() {
  const jobs = useQueue((s) => s.jobs);
  const { pause, resume, cancel } = useQueue.getState();
  const setView = useUvpd((s) => s.setView);

  const downloading = jobs.filter((j) => j.status === 'downloading');
  const paused = jobs.filter((j) => j.status === 'paused');
  const activeCount = downloading.length + paused.length + jobs.filter((j) => j.status === 'queued').length;
  if (activeCount === 0) return null;

  const totalSpeed = downloading.reduce((s, j) => s + j.speed, 0);
  const loaded = jobs.reduce((s, j) => s + j.loaded, 0);
  const total = jobs.reduce((s, j) => s + (j.total || 0), 0);
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const lead = downloading[0] || paused[0];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 right-4 z-30 w-[300px] overflow-hidden rounded-xl shadow-lg"
        style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', boxShadow: '0 16px 40px rgba(0,0,0,.4)' }}
      >
        <button type="button" onClick={() => setView('downloads')} className="flex w-full items-center gap-2 px-3 py-2 text-left" style={{ borderBottom: '1px solid var(--rs-line)' }}>
          <Download size={14} style={{ color: 'var(--rs-accent)' }} />
          <span className="flex-1 text-[12px]" style={{ color: 'var(--rs-tx)' }}>{t('dl.active', { n: activeCount })}</span>
          {totalSpeed > 0 && <span className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{sizeHuman(totalSpeed)}/s</span>}
        </button>
        {lead && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px]" style={{ color: 'var(--rs-tx-2)' }}>{lead.filename}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--rs-accent)', transition: 'width .2s' }} />
              </div>
            </div>
            {lead.status === 'downloading' && lead.resumable ? (
              <button type="button" onClick={() => pause(lead.id)} aria-label={t('dl.pause')} className="flex h-7 w-7 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><Pause size={14} /></button>
            ) : lead.status === 'paused' ? (
              <button type="button" onClick={() => resume(lead.id)} aria-label={t('dl.resume')} className="flex h-7 w-7 items-center justify-center rounded-md" style={{ color: 'var(--rs-accent)' }}><Play size={14} /></button>
            ) : null}
            <button type="button" onClick={() => cancel(lead.id)} aria-label={t('dl.cancel')} className="flex h-7 w-7 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-3)' }}><X size={14} /></button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
