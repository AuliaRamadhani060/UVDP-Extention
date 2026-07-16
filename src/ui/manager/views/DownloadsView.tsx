// DownloadsView (Manager) — daftar unduhan + progress. Data dari GET_DOWNLOADS
// (metadata) + progress live dari store. Queue UI penuh = U4.
import { useEffect, useState } from 'react';
import { X, RotateCw, Check, Download } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { sendUi } from '@/shared/messaging';
import { sizeHuman } from '@/core/url-utils';
import { t } from '@/i18n';
import type { DownloadProgress } from '@/shared/types';

export function DownloadsView() {
  const live = useUvpd((s) => s.downloads);
  const cancel = useUvpd((s) => s.cancel);
  const retry = useUvpd((s) => s.retry);
  const [jobs, setJobs] = useState<DownloadProgress[]>([]);

  const refresh = () => sendUi<DownloadProgress[]>({ type: 'GET_DOWNLOADS' }).then((d) => setJobs(d || []));
  // Segarkan saat mount & saat ada job baru / status berubah (signature stabil).
  const liveSig = Object.entries(live).map(([k, v]) => k + v.status).join(',');
  useEffect(() => { refresh(); }, [liveSig]);

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <h2 className="rs-display mb-4 text-[20px]" style={{ color: 'var(--rs-tx)' }}>{t('nav.downloads')}</h2>
      {jobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" style={{ color: 'var(--rs-tx-3)' }}>
          <Download size={30} />
          <div className="text-[13px]">{t('empty.none')}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {jobs.map((j) => {
            const l = live[j.id];
            const done = l?.loaded ?? j.loaded;
            const total = l?.total ?? j.total;
            const status = l?.status ?? j.status;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div key={j.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]" style={{ color: 'var(--rs-tx)' }}>{j.filename}</div>
                  <div className="mt-1 flex items-center gap-2 rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>
                    <span style={{ color: status === 'complete' ? 'var(--ok)' : status === 'error' ? 'var(--danger)' : 'var(--rs-tx-2)' }}>{status}</span>
                    {status === 'downloading' && total > 0 && <span>{pct}% · {sizeHuman(done)}</span>}
                  </div>
                  {status === 'downloading' && total > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--rs-accent)' }} />
                    </div>
                  )}
                </div>
                {status === 'downloading' ? (
                  <button type="button" onClick={() => cancel(j.id)} title={t('media.clear')} aria-label={t('media.clear')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><X size={15} /></button>
                ) : status === 'error' ? (
                  <button type="button" onClick={() => retry(j.id)} title={t('action.rescan')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><RotateCw size={15} /></button>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center" style={{ color: 'var(--ok)' }}><Check size={15} /></span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
