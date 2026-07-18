// Halaman Download (M1) — analyze-first: URL → rencana (kualitas/format/filename/
// batasan) → eksekusi lewat antrean unduh yang ada. UI FUNGSIONAL MINIMAL
// (keindahan ditunda ke M5). Tombol Unduh kartu membuka halaman ini pre-filled.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, Download, Terminal, ShieldAlert, X, Check, Loader } from 'lucide-react';
import { sendUi } from '@/shared/messaging';
import { useQueue, useQueueBridge } from '@/ui/store/downloads';
import { sizeHuman } from '@/core/url-utils';
import { formatDuration } from '@/core/media-utils';
import { t } from '@/i18n';
import type { MediaItem } from '@/shared/types';
import type { SourcePlan, DownloadStrategy } from '@/shared/contract';

const inputCls = 'w-full rounded-md px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const inputStyle = { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' } as const;

function speedHuman(bps: number): string { return !bps || bps < 1 ? '—' : sizeHuman(bps) + '/s'; }
function etaHuman(sec?: number): string {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${Math.round(sec % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="rs-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Downloader() {
  useQueueBridge();
  const analyze = useQueue((s) => s.analyze);
  const download = useQueue((s) => s.download);
  const cancel = useQueue((s) => s.cancel);
  const jobs = useQueue((s) => s.jobs);

  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [urlInput, setUrlInput] = useState(params.get('url') || '');
  const [plan, setPlan] = useState<SourcePlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pilihan user
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('');
  const [filename, setFilename] = useState('');
  const [strategy, setStrategy] = useState<DownloadStrategy | ''>('');

  async function runAnalyze(url: string, id?: string) {
    if (!url.trim() && !id) return;
    setAnalyzing(true);
    try {
      const p = await analyze(url.trim(), id);
      setPlan(p);
      setFilename(p.defaultFilename);
      setQuality('');
      setContainer(p.formats.find((f) => f.available)?.container || '');
      setStrategy(p.strategies[0] || '');
    } finally {
      setAnalyzing(false);
    }
  }

  // Prefill dari kartu/player. mediaId → ambil URL dulu, lalu auto-analyze.
  useEffect(() => {
    const id = params.get('mediaId') || '';
    const url = params.get('url') || '';
    if (id && !url) {
      sendUi<MediaItem | undefined>({ type: 'GET_MEDIA', payload: { id } }).then((m) => {
        if (m?.url) { setUrlInput(m.url); runAnalyze(m.url, id); }
      });
    } else if (url) {
      runAnalyze(url, id || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const job = plan ? jobs.find((j) => j.id === plan.mediaId || j.mediaId === plan.mediaId) : undefined;
  const jobPct = job && job.total > 0 ? Math.min(100, (job.loaded / job.total) * 100) : 0;
  const busy = job && (job.status === 'downloading' || job.status === 'queued' || job.status === 'muxing');

  function startDownload() {
    if (!plan?.ok || !plan.mediaId) return;
    download(plan.mediaId, {
      quality: quality || undefined,
      container: container || undefined,
      filename: filename || undefined,
      strategy: (strategy || undefined) as DownloadStrategy | undefined,
    });
  }
  function copyFfmpeg() {
    if (!plan?.ffmpeg) return;
    navigator.clipboard.writeText(plan.ffmpeg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <div className="rs-root min-h-screen" style={{ background: 'var(--rs-bg)' }}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex items-center gap-2">
          <Download size={20} style={{ color: 'var(--rs-accent)' }} />
          <h1 className="rs-display text-[22px]" style={{ color: 'var(--rs-tx)' }}>{t('dlr.title')}</h1>
        </header>

        {/* Source */}
        <section className="flex flex-col gap-2 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
          <Field label={t('dlr.urlLabel')}>
            <div className="flex gap-2">
              <input
                className={`${inputCls} rs-mono`} style={inputStyle} placeholder={t('dlr.urlPlaceholder')} value={urlInput}
                onInput={(e) => setUrlInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if ((e as unknown as KeyboardEvent).key === 'Enter') runAnalyze(urlInput); }}
              />
              <button type="button" onClick={() => runAnalyze(urlInput)} disabled={analyzing || !urlInput.trim()}
                className="inline-flex flex-none items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
                {analyzing ? <Loader size={14} className="animate-spin" /> : <Search size={14} />} {t('dlr.analyze')}
              </button>
            </div>
          </Field>
        </section>

        {/* Rencana */}
        {!plan ? (
          <div className="rounded-panel p-6 text-center text-[13px]" style={{ background: 'var(--rs-panel)', border: '1px dashed var(--rs-line)', color: 'var(--rs-tx-3)' }}>
            {analyzing ? t('dlr.analyzing') : t('dlr.noPlan')}
          </div>
        ) : (
          <section className="flex flex-col gap-4 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
            <div className="flex items-center justify-between">
              <h2 className="rs-display text-[15px]" style={{ color: 'var(--rs-tx)' }}>{t('dlr.plan')}</h2>
              <span className="rs-mono rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--rs-line-2)', color: 'var(--rs-tx-2)' }}>{plan.kind}</span>
            </div>

            {/* meta ringkas */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 rs-mono text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>
              {plan.sizeBytes ? <span>{t('dlr.size')}: {sizeHuman(plan.sizeBytes)}</span> : null}
              {plan.durationSec ? <span>{t('dlr.duration')}: {formatDuration(plan.durationSec)}</span> : null}
              {plan.itemCount ? <span>{t('dlr.segments')}: {plan.itemCount}</span> : null}
            </div>

            {plan.protected || !plan.ok ? (
              <div className="flex items-center gap-2 rounded-md p-3 text-[13px]" style={{ background: 'color-mix(in oklab, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>
                <ShieldAlert size={16} /> {plan.error || t('dlr.protected')}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('dlr.quality')}>
                    <select className={inputCls} style={inputStyle} value={quality} onChange={(e) => setQuality((e.target as HTMLSelectElement).value)}>
                      {plan.qualities.map((q) => <option key={q.value} value={q.value}>{q.label}{q.bitrate ? ` · ${Math.round(q.bitrate / 1000)}k` : ''}</option>)}
                    </select>
                  </Field>
                  <Field label={t('dlr.format')}>
                    <select className={inputCls} style={inputStyle} value={container} onChange={(e) => setContainer((e.target as HTMLSelectElement).value)}>
                      {plan.formats.map((f) => (
                        <option key={f.container} value={f.container} disabled={!f.available}>
                          {f.label}{f.available ? '' : ` — ${t('dlr.afterM2')}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('dlr.filename')}>
                    <input className={`${inputCls} rs-mono`} style={inputStyle} value={filename} onInput={(e) => setFilename((e.target as HTMLInputElement).value)} />
                  </Field>
                  <Field label={t('dlr.strategy')}>
                    <select className={inputCls} style={inputStyle} value={strategy} onChange={(e) => setStrategy((e.target as HTMLSelectElement).value as DownloadStrategy)}>
                      {plan.strategies.map((s) => <option key={s} value={s}>{t('dlr.strat.' + s)}</option>)}
                    </select>
                  </Field>
                </div>

                {plan.limitations.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-md p-2 text-[11px]" style={{ background: 'color-mix(in oklab, var(--warn) 10%, transparent)', color: 'var(--rs-tx-2)' }}>
                    <span className="font-semibold" style={{ color: 'var(--warn)' }}>{t('dlr.limitations')}</span>
                    {plan.limitations.map((l, i) => <span key={i}>• {l}</span>)}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={startDownload} disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50"
                    style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
                    <Download size={15} /> {t('dlr.download')}
                  </button>
                  {plan.ffmpeg && (
                    <button type="button" onClick={copyFfmpeg} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[12px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
                      {copied ? <Check size={13} /> : <Terminal size={13} />} {copied ? t('dlr.copied') : t('dlr.copyFfmpeg')}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Progress */}
            {job && (
              <div className="flex flex-col gap-2 rounded-md p-3" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="rs-mono" style={{ color: 'var(--rs-tx-2)' }}>
                    {t('dl.status.' + job.status)}
                    {job.status === 'downloading' && ` · ${speedHuman(job.speed)} · ETA ${etaHuman(job.etaSec)}`}
                    {job.status === 'muxing' && ` · ${Math.round((job.muxProgress ?? 0) * 100)}%`}
                  </span>
                  {busy && <button type="button" onClick={() => cancel(job.id)} aria-label={t('dl.cancel')} style={{ color: 'var(--rs-tx-3)' }}><X size={15} /></button>}
                  {job.status === 'complete' && <Check size={15} style={{ color: 'var(--ok)' }} />}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${job.status === 'muxing' ? (job.muxProgress ?? 0) * 100 : jobPct}%`, background: job.status === 'complete' ? 'var(--ok)' : 'var(--rs-accent)', transition: 'width .2s' }} />
                </div>
                {job.total > 0 && <span className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{sizeHuman(job.loaded)} / {sizeHuman(job.total)}</span>}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
