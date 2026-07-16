// DownloadsView (Manager) — Antrean unduhan penuh (U4): ring+bar progres,
// sparkline kecepatan, ETA, pause/resume/cancel/retry/remove, reorder (drag),
// kontrol konkurensi, dan riwayat + unduh-ulang.
import { useState } from 'react';
import {
  Pause, Play, X, RotateCw, Check, Download, Trash2, GripVertical,
  Plus, Minus, History, ArrowDownToLine, Gauge, Merge, Save,
} from 'lucide-react';
import { useQueue } from '@/ui/store/downloads';
import { Sparkline } from '@/ui/components/downloads/Sparkline';
import { sizeHuman } from '@/core/url-utils';
import { t } from '@/i18n';
import type { QueueJobView } from '@/shared/contract';

function speedHuman(bps: number): string {
  if (!bps || bps < 1) return '—';
  return sizeHuman(bps) + '/s';
}
function etaHuman(sec?: number): string {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const ACTIVE = new Set(['queued', 'downloading', 'paused', 'error', 'canceled', 'awaiting_mux', 'muxing']);
const STATUS_COLOR: Record<string, string> = {
  downloading: 'var(--rs-accent)', paused: 'var(--warn)', complete: 'var(--ok)',
  error: 'var(--danger)', canceled: 'var(--rs-tx-3)', queued: 'var(--rs-tx-2)',
  awaiting_mux: 'var(--warn)', muxing: 'var(--rs-accent)',
};

function Ring({ pct, status }: { pct: number; status: string }) {
  const r = 13, c = 2 * Math.PI * r;
  const color = STATUS_COLOR[status] || 'var(--rs-tx-2)';
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" style={{ flex: 'none' }}>
      <circle cx={17} cy={17} r={r} fill="none" stroke="var(--rs-line-2)" stroke-width={3} />
      <circle
        cx={17} cy={17} r={r} fill="none" stroke={color} stroke-width={3} stroke-linecap="round"
        stroke-dasharray={c} stroke-dashoffset={c * (1 - Math.max(0, Math.min(1, pct / 100)))}
        transform="rotate(-90 17 17)"
      />
      {status === 'complete'
        ? <text x={17} y={21} textAnchor="middle" fontSize={12} fill={color}>✓</text>
        : <text x={17} y={20} textAnchor="middle" fontSize={9} fill="var(--rs-tx-2)" fontFamily="var(--font-mono)">{Math.round(pct)}</text>}
    </svg>
  );
}

export function DownloadsView() {
  const jobs = useQueue((s) => s.jobs);
  const history = useQueue((s) => s.history);
  const concurrency = useQueue((s) => s.concurrency);
  const spark = useQueue((s) => s.spark);
  const { pause, resume, cancel, retry, remove, reorder, setConcurrency, merge, saveSeparate } = useQueue.getState();
  const [showHistory, setShowHistory] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  const active = jobs.filter((j) => ACTIVE.has(j.status)).sort((a, b) => a.order - b.order);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const ids = active.map((j) => j.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorder(ids);
    setDragId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="rs-display text-[20px]" style={{ color: 'var(--rs-tx)' }}>{t('nav.downloads')}</h2>
        <div className="flex items-center gap-2 rounded-lg px-2 py-1" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }} title={t('dl.concurrency')}>
          <Gauge size={13} style={{ color: 'var(--rs-tx-3)' }} />
          <button type="button" onClick={() => setConcurrency(concurrency - 1)} disabled={concurrency <= 1} aria-label="−" className="flex h-6 w-6 items-center justify-center rounded" style={{ color: 'var(--rs-tx-2)' }}><Minus size={13} /></button>
          <span className="rs-mono w-4 text-center text-[13px]" style={{ color: 'var(--rs-tx)' }}>{concurrency}</span>
          <button type="button" onClick={() => setConcurrency(concurrency + 1)} disabled={concurrency >= 8} aria-label="+" className="flex h-6 w-6 items-center justify-center rounded" style={{ color: 'var(--rs-tx-2)' }}><Plus size={13} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {active.length === 0 && history.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" style={{ color: 'var(--rs-tx-3)' }}>
            <Download size={30} />
            <div className="text-[13px]">{t('empty.none')}</div>
            <div className="text-[12px]">{t('dl.hint')}</div>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div className="flex flex-col gap-2">
                {active.map((j) => (
                  <JobRow
                    key={j.id} job={j} spark={spark[j.id] || []}
                    onDragStart={() => setDragId(j.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(j.id)}
                    dragging={dragId === j.id}
                    onPause={() => pause(j.id)} onResume={() => resume(j.id)} onCancel={() => cancel(j.id)}
                    onRetry={() => retry(j.id)} onRemove={() => remove(j.id)}
                    onMerge={() => merge(j.id)} onSaveSeparate={() => saveSeparate(j.id)}
                  />
                ))}
              </div>
            )}

            {history.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowHistory((v) => !v)} className="mb-2 flex items-center gap-2 text-[12px]" style={{ color: 'var(--rs-tx-2)' }}>
                  <History size={13} /> {t('dl.history')} ({history.length})
                </button>
                {showHistory && (
                  <div className="flex flex-col gap-1">
                    {history.map((h) => (
                      <div key={h.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
                        <Check size={15} style={{ color: 'var(--ok)', flex: 'none' }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px]" style={{ color: 'var(--rs-tx)' }}>{h.filename}</div>
                          <div className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{h.total > 0 ? sizeHuman(h.total) : ''}</div>
                        </div>
                        <button type="button" onClick={() => retry(h.id)} title={t('dl.redownload')} aria-label={t('dl.redownload')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><ArrowDownToLine size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  job: QueueJobView; spark: number[]; dragging: boolean;
  onDragStart: () => void; onDragOver: (e: Event) => void; onDrop: () => void;
  onPause: () => void; onResume: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void;
  onMerge: () => void; onSaveSeparate: () => void;
}
function JobRow(p: RowProps) {
  const j = p.job;
  const muxing = j.status === 'muxing';
  const pct = muxing ? (j.muxProgress ?? 0) * 100 : j.total > 0 ? (j.loaded / j.total) * 100 : 0;
  const color = STATUS_COLOR[j.status] || 'var(--rs-tx-2)';
  return (
    <div
      draggable
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver as unknown as (e: unknown) => void}
      onDrop={p.onDrop}
      className="flex items-center gap-3 rounded-lg p-3"
      style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', opacity: p.dragging ? 0.5 : 1 }}
    >
      <span className="cursor-grab" style={{ color: 'var(--rs-tx-3)', flex: 'none' }} aria-hidden="true"><GripVertical size={15} /></span>
      <Ring pct={pct} status={j.status} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px]" style={{ color: 'var(--rs-tx)' }}>{j.filename}</span>
          {j.quality && <span className="rs-mono rounded px-1 text-[9px]" style={{ background: 'var(--rs-line-2)', color: 'var(--rs-tx-2)' }}>{j.quality}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>
          <span style={{ color, textTransform: 'capitalize' }}>{t('dl.status.' + j.status)}</span>
          {j.total > 0 && <span>{sizeHuman(j.loaded)} / {sizeHuman(j.total)}</span>}
          {j.status === 'downloading' && <span>· {speedHuman(j.speed)}</span>}
          {j.status === 'downloading' && j.etaSec != null && <span>· ETA {etaHuman(j.etaSec)}</span>}
          {j.status === 'error' && j.error && <span style={{ color: 'var(--danger)' }}>· {j.error}</span>}
          {muxing && <span>· {Math.round((j.muxProgress ?? 0) * 100)}%</span>}
          {!j.resumable && j.strategy !== 'segmented' && <span title={t('dl.noResume')}>· {t('dl.native')}</span>}
        </div>
        {j.status === 'awaiting_mux' && (
          <div className="mt-1 text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('dl.muxExplain')}</div>
        )}
        <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color, transition: 'width .2s' }} />
        </div>
      </div>

      {j.status === 'downloading' && <Sparkline data={p.spark} />}

      <div className="flex items-center gap-1" style={{ flex: 'none' }}>
        {j.status === 'awaiting_mux' && j.canMerge && (
          <>
            <button type="button" onClick={p.onMerge} title={t('dl.merge')} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold" style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
              <Merge size={14} /> {t('dl.merge')}
            </button>
            <button type="button" onClick={p.onSaveSeparate} title={t('dl.saveSeparate')} aria-label={t('dl.saveSeparate')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><Save size={15} /></button>
          </>
        )}
        {j.status === 'downloading' && j.resumable && (
          <button type="button" onClick={p.onPause} title={t('dl.pause')} aria-label={t('dl.pause')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><Pause size={15} /></button>
        )}
        {j.status === 'downloading' && j.strategy === 'direct' && (
          <button type="button" onClick={p.onPause} title={t('dl.pause')} aria-label={t('dl.pause')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><Pause size={15} /></button>
        )}
        {j.status === 'paused' && (
          <button type="button" onClick={p.onResume} title={t('dl.resume')} aria-label={t('dl.resume')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-accent)' }}><Play size={15} /></button>
        )}
        {(j.status === 'error' || j.status === 'canceled') && (
          <button type="button" onClick={p.onRetry} title={t('dl.retry')} aria-label={t('dl.retry')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><RotateCw size={15} /></button>
        )}
        {(j.status === 'downloading' || j.status === 'paused' || j.status === 'queued') && (
          <button type="button" onClick={p.onCancel} title={t('dl.cancel')} aria-label={t('dl.cancel')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-2)' }}><X size={15} /></button>
        )}
        <button type="button" onClick={p.onRemove} title={t('dl.remove')} aria-label={t('dl.remove')} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-3)' }}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}
