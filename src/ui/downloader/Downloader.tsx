// Halaman Download — desain "ruang sinyal" (M5). Analyze-first: URL → rencana
// (kualitas/format/filename/lanjutan) → unduh via antrean. LOGIKA M1/M2 TIDAK
// berubah; ini murni lapisan tampilan (chip kualitas, matriks format, panel
// progress ring, activity log). Monospace untuk URL/bytes/kecepatan.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Search, Download, Terminal, ShieldAlert, ShieldCheck, X, Check, LoaderCircle,
  Copy, ChevronDown, ChevronRight, Trash2, Film, Music, FileDown, Activity, Clock, Gauge,
} from 'lucide-react';
import { sendUi } from '@/shared/messaging';
import { copyUrl } from '@/shared/actions';
import { useQueue, useQueueBridge } from '@/ui/store/downloads';
import { sizeHuman } from '@/core/url-utils';
import { formatDuration } from '@/core/media-utils';
import { t } from '@/i18n';
import type { MediaItem } from '@/shared/types';
import type { SourcePlan, DownloadStrategy, QueueJobView } from '@/shared/contract';

const KIND_COLOR: Record<string, string> = {
  direct: 'var(--direct)', hls: 'var(--hls)', dash: 'var(--dash)', mse: 'var(--mse)', fragmented: 'var(--frag)', unknown: 'var(--rs-tx-2)',
};
const STATUS_COLOR: Record<string, string> = {
  idle: 'var(--rs-tx-3)', ready: 'var(--rs-accent)', analyzing: 'var(--rs-accent)',
  queued: 'var(--rs-tx-2)', downloading: 'var(--rs-accent)', paused: 'var(--warn)',
  muxing: 'var(--rs-accent)', awaiting_mux: 'var(--warn)', complete: 'var(--ok)',
  error: 'var(--danger)', canceled: 'var(--rs-tx-3)',
};

function speedHuman(bps: number): string { return !bps || bps < 1 ? '—' : sizeHuman(bps) + '/s'; }
function etaHuman(sec?: number): string {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${Math.round(sec % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const inputStyle = { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' } as const;
const inputCls = 'w-full rounded-md px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Card({ title, icon, right, children }: { title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
      {title && (
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="rs-display flex-1 text-[14px]" style={{ color: 'var(--rs-tx)' }}>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
function Metric({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="rs-mono text-[9px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{label}</span>
      <span className={`${mono ? 'rs-mono' : ''} text-[13px]`} style={{ color: 'var(--rs-tx)' }}>{value}</span>
    </div>
  );
}
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" style={{ flex: 'none' }} aria-hidden="true">
      <circle cx={38} cy={38} r={r} fill="none" stroke="var(--rs-line-2)" strokeWidth={6} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct / 100)))}
        transform="rotate(-90 38 38)" style={{ transition: 'stroke-dashoffset .3s' }} />
      <text x={38} y={42} textAnchor="middle" fontSize={15} fontFamily="var(--font-mono)" fill="var(--rs-tx)">{Math.round(pct)}%</text>
    </svg>
  );
}

interface LogEntry { ts: number; msg: string; tone?: 'ok' | 'warn' | 'err' }

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
  const [copiedFf, setCopiedFf] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [log, setLog] = useState<LogEntry[]>([]);

  // Pilihan user (nilai sama persis dengan M1/M2 — hanya kontrol UI yang berubah).
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('');
  const [filename, setFilename] = useState('');
  const [strategy, setStrategy] = useState<DownloadStrategy | ''>('');

  const pushLog = (msg: string, tone?: LogEntry['tone']) => setLog((l) => [{ ts: Date.now(), msg, tone }, ...l].slice(0, 60));

  async function runAnalyze(url: string, id?: string) {
    if (!url.trim() && !id) return;
    setAnalyzing(true);
    pushLog(t('dlr.logAnalyze'));
    try {
      const p = await analyze(url.trim(), id);
      setPlan(p);
      setFilename(p.defaultFilename);
      setQuality('');
      setContainer(p.formats.find((f) => f.available)?.container || '');
      setStrategy(p.strategies[0] || '');
      if (p.ok) pushLog(`${t('dlr.logPlan')}: ${p.kind}`, 'ok');
      else pushLog(p.error || t('dlr.protected'), 'err');
    } catch (e) {
      pushLog(String((e as Error)?.message || e), 'err');
    } finally {
      setAnalyzing(false);
    }
  }

  // Prefill dari kartu/player.
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

  const job: QueueJobView | undefined = plan ? jobs.find((j) => j.id === plan.mediaId || j.mediaId === plan.mediaId) : undefined;
  const busy = !!job && (job.status === 'downloading' || job.status === 'queued' || job.status === 'muxing');
  const muxing = job?.status === 'muxing';
  const jobPct = muxing ? (job?.muxProgress ?? 0) * 100 : job && job.total > 0 ? Math.min(100, (job.loaded / job.total) * 100) : 0;

  // Activity log: catat transisi status (observasi UI, bukan perubahan logika).
  const lastStatus = useRef<string>('');
  useEffect(() => {
    if (!job || job.status === lastStatus.current) return;
    lastStatus.current = job.status;
    const tone = job.status === 'complete' ? 'ok' : job.status === 'error' ? 'err' : job.status === 'paused' || job.status === 'awaiting_mux' ? 'warn' : undefined;
    pushLog(`${t('dlr.logStatus')}: ${t('dl.status.' + job.status)}`, tone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  const status = analyzing ? 'analyzing' : job ? job.status : plan ? 'ready' : 'idle';

  function startDownload() {
    if (!plan?.ok || !plan.mediaId) return;
    download(plan.mediaId, {
      quality: quality || undefined,
      container: container || undefined,
      filename: filename || undefined,
      strategy: (strategy || undefined) as DownloadStrategy | undefined,
    });
    pushLog(`${t('dlr.logStart')}: ${filename || plan.defaultFilename}`);
  }
  function copyFfmpeg() {
    if (!plan?.ffmpeg) return;
    navigator.clipboard.writeText(plan.ffmpeg).then(() => { setCopiedFf(true); setTimeout(() => setCopiedFf(false), 1500); });
  }
  function doCopyUrl() { copyUrl(urlInput).then((ok) => { if (ok) { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500); } }); }

  const kindColor = plan ? (KIND_COLOR[plan.kind] || 'var(--rs-tx-2)') : 'var(--rs-tx-2)';

  return (
    <div className="rs-root rs-ambient min-h-screen" style={{ background: 'var(--rs-bg)' }}>
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {/* Header + status */}
        <header className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'color-mix(in oklab, var(--rs-accent) 18%, transparent)', color: 'var(--rs-accent)' }}><Download size={18} /></span>
          <h1 className="rs-display flex-1 text-[22px]" style={{ color: 'var(--rs-tx)' }}>{t('dlr.title')}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{ background: `color-mix(in oklab, ${STATUS_COLOR[status]} 16%, transparent)`, color: STATUS_COLOR[status] }}>
            <span className={status === 'analyzing' || status === 'downloading' || status === 'muxing' ? 'rs-eq' : ''} style={{ color: STATUS_COLOR[status] }} aria-hidden="true">
              {status === 'analyzing' || status === 'downloading' || status === 'muxing' ? <><i /><i /><i /><i /></> : '●'}
            </span>
            {status === 'analyzing' ? t('dlr.analyzing') : status === 'ready' ? t('dlr.ready') : status === 'idle' ? t('dlr.idle') : t('dl.status.' + status)}
          </span>
        </header>

        {/* Media Source */}
        <Card title={t('dlr.source')} icon={<Search size={15} style={{ color: 'var(--rs-tx-3)' }} />}>
          <div className="flex gap-2">
            <input className={`${inputCls} rs-mono`} style={inputStyle} placeholder={t('dlr.urlPlaceholder')} value={urlInput}
              aria-label={t('dlr.urlLabel')}
              onInput={(e) => setUrlInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if ((e as unknown as KeyboardEvent).key === 'Enter') runAnalyze(urlInput); }} />
            <button type="button" onClick={doCopyUrl} disabled={!urlInput.trim()} aria-label={t('dlr.copyUrl')} title={t('dlr.copyUrl')}
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-md disabled:opacity-40" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
              {copiedUrl ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button type="button" onClick={() => runAnalyze(urlInput)} disabled={analyzing || !urlInput.trim()}
              className="inline-flex flex-none items-center gap-1.5 rounded-md px-4 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
              {analyzing ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />} {t('dlr.analyze')}
            </button>
          </div>
        </Card>

        {/* Empty / loading */}
        {!plan && (
          <div className="rounded-panel p-8 text-center text-[13px]" style={{ background: 'var(--rs-panel)', border: '1px dashed var(--rs-line)', color: 'var(--rs-tx-3)' }}>
            {analyzing ? (
              <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> {t('dlr.analyzing')}</span>
            ) : t('dlr.noPlan')}
          </div>
        )}

        {/* Protected / error */}
        {plan && (plan.protected || !plan.ok) && (
          <Card>
            <div className="flex items-center gap-2 rounded-md p-3 text-[13px]" style={{ background: 'color-mix(in oklab, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>
              <ShieldAlert size={16} /> {plan.error || t('dlr.protected')}
            </div>
          </Card>
        )}

        {/* Source analysis */}
        {plan && plan.ok && (
          <Card title={t('dlr.analysis')} icon={<Activity size={15} style={{ color: kindColor }} />}
            right={<span className="rs-mono rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: `color-mix(in oklab, ${kindColor} 18%, transparent)`, color: kindColor }}>{plan.kind}</span>}>
            {/* keamanan + meta */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ok)' }}><ShieldCheck size={13} /> {t('dlr.securityOk')}</span>
              {plan.sizeBytes ? <span className="rs-mono text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.size')} {sizeHuman(plan.sizeBytes)}</span> : null}
              {plan.durationSec ? <span className="rs-mono text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.duration')} {formatDuration(plan.durationSec)}</span> : null}
              {plan.itemCount ? <span className="rs-mono text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{plan.itemCount} {t('dlr.items')}</span> : null}
            </div>

            {/* chip kualitas */}
            <div className="flex flex-col gap-1.5">
              <span className="rs-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.quality')}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('dlr.quality')}>
                {plan.qualities.map((q) => {
                  const on = quality === q.value;
                  return (
                    <button key={q.value} type="button" aria-pressed={on} onClick={() => setQuality(q.value)}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={on
                        ? { background: 'var(--rs-accent)', color: '#08111d', fontWeight: 600 }
                        : { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
                      {q.label}
                      {q.best && <span className="rs-mono text-[9px]" style={{ opacity: 0.8 }}>★ {t('dlr.best')}</span>}
                      {q.bitrate ? <span className="rs-mono text-[9px]" style={{ opacity: 0.7 }}>{Math.round(q.bitrate / 1000)}k</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* matriks format */}
            <div className="flex flex-col gap-1.5">
              <span className="rs-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.format')}</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {plan.formats.map((f) => {
                  const on = container === f.container;
                  const audio = f.container === 'm4a' || f.container === 'mp3';
                  const Icon = audio ? Music : f.container === 'original' ? FileDown : Film;
                  return (
                    <button key={f.container} type="button" disabled={!f.available} aria-pressed={on}
                      onClick={() => f.available && setContainer(f.container)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
                      style={on
                        ? { background: 'color-mix(in oklab, var(--rs-accent) 16%, transparent)', border: '1px solid var(--rs-accent)' }
                        : { background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
                      <Icon size={15} style={{ color: on ? 'var(--rs-accent)' : 'var(--rs-tx-3)', flex: 'none' }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px]" style={{ color: 'var(--rs-tx)' }}>{t('fmt.' + f.container)}</span>
                        {f.needsTranscode && <span className="block rs-mono text-[9px]" style={{ color: 'var(--warn)' }}>{t('fmt.slow')}</span>}
                        {!f.available && <span className="block rs-mono text-[9px]" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.unavailable')}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* batasan */}
            {plan.limitations.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md p-2.5 text-[11px]" style={{ background: 'color-mix(in oklab, var(--warn) 10%, transparent)', color: 'var(--rs-tx-2)' }}>
                <span className="font-semibold" style={{ color: 'var(--warn)' }}>{t('dlr.limitations')}</span>
                {plan.limitations.map((l, i) => <span key={i}>• {l}</span>)}
              </div>
            )}
          </Card>
        )}

        {/* Save as */}
        {plan && plan.ok && (
          <Card title={t('dlr.saveAs')} icon={<FileDown size={15} style={{ color: 'var(--rs-tx-3)' }} />}>
            <input className={`${inputCls} rs-mono`} style={inputStyle} value={filename} aria-label={t('dlr.filename')}
              onInput={(e) => setFilename((e.target as HTMLInputElement).value)} />
          </Card>
        )}

        {/* Advanced (collapsible) */}
        {plan && plan.ok && (
          <section className="rounded-panel" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
            <button type="button" onClick={() => setAdvOpen((v) => !v)} aria-expanded={advOpen}
              className="flex w-full items-center gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {advOpen ? <ChevronDown size={15} style={{ color: 'var(--rs-tx-3)' }} /> : <ChevronRight size={15} style={{ color: 'var(--rs-tx-3)' }} />}
              <span className="rs-display flex-1 text-[14px]" style={{ color: 'var(--rs-tx)' }}>{t('dlr.advanced')}</span>
            </button>
            {advOpen && (
              <div className="flex flex-col gap-1 px-4 pb-4">
                <span className="rs-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{t('dlr.strategy')}</span>
                <select className={inputCls} style={inputStyle} value={strategy} onChange={(e) => setStrategy((e.target as HTMLSelectElement).value as DownloadStrategy)}>
                  {plan.strategies.map((s) => <option key={s} value={s}>{t('dlr.strat.' + s)}</option>)}
                </select>
              </div>
            )}
          </section>
        )}

        {/* Aksi utama */}
        {plan && plan.ok && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={startDownload} disabled={!!busy}
              className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
              <Download size={15} /> {t('dlr.download')}
            </button>
            {plan.ffmpeg && (
              <button type="button" onClick={copyFfmpeg}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
                {copiedFf ? <Check size={13} /> : <Terminal size={13} />} {copiedFf ? t('dlr.copied') : t('dlr.copyFfmpeg')}
              </button>
            )}
          </div>
        )}

        {/* Panel Download */}
        {job && (
          <Card title={t('dlr.progress')} icon={<Gauge size={15} style={{ color: STATUS_COLOR[job.status] }} />}
            right={busy ? (
              <button type="button" onClick={() => cancel(job.id)} aria-label={t('dl.cancel')} title={t('dl.cancel')}
                className="flex h-7 w-7 items-center justify-center rounded-md" style={{ color: 'var(--rs-tx-3)' }}><X size={15} /></button>
            ) : job.status === 'complete' ? <Check size={16} style={{ color: 'var(--ok)' }} /> : null}>
            <div className="flex items-center gap-4">
              <Ring pct={jobPct} color={STATUS_COLOR[job.status] || 'var(--rs-accent)'} />
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label={t('dlr.completed')} value={`${Math.round(jobPct)}%`} />
                <Metric label={t('dlr.downloaded')} value={job.total > 0 ? `${sizeHuman(job.loaded)} / ${sizeHuman(job.total)}` : sizeHuman(job.loaded)} />
                <Metric label={t('dlr.speed')} value={job.status === 'downloading' ? speedHuman(job.speed) : '—'} />
                <Metric label={t('dlr.eta')} value={job.status === 'downloading' ? etaHuman(job.etaSec) : muxing ? t('dl.status.muxing') : '—'} />
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
              <div className="h-full rounded-full" style={{ width: `${jobPct}%`, background: STATUS_COLOR[job.status] || 'var(--rs-accent)', transition: 'width .3s' }} />
            </div>
          </Card>
        )}

        {/* Activity log */}
        {log.length > 0 && (
          <section className="rounded-panel" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
            <div className="flex items-center gap-2 p-4">
              <button type="button" onClick={() => setLogOpen((v) => !v)} aria-expanded={logOpen} className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none">
                {logOpen ? <ChevronDown size={15} style={{ color: 'var(--rs-tx-3)' }} /> : <ChevronRight size={15} style={{ color: 'var(--rs-tx-3)' }} />}
                <Terminal size={14} style={{ color: 'var(--rs-tx-3)' }} />
                <span className="rs-display text-[14px]" style={{ color: 'var(--rs-tx)' }}>{t('dlr.log')}</span>
                <span className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>({log.length})</span>
              </button>
              <button type="button" onClick={() => setLog([])} aria-label={t('dlr.clearLog')} title={t('dlr.clearLog')} style={{ color: 'var(--rs-tx-3)' }}><Trash2 size={14} /></button>
            </div>
            {logOpen && (
              <div className="max-h-48 overflow-auto px-4 pb-4">
                <ul className="flex flex-col gap-1">
                  {log.map((e, i) => (
                    <li key={i} className="flex gap-2 rs-mono text-[11px]">
                      <span style={{ color: 'var(--rs-tx-3)' }} className="flex-none"><Clock size={10} className="inline" /> {new Date(e.ts).toLocaleTimeString()}</span>
                      <span style={{ color: e.tone === 'err' ? 'var(--danger)' : e.tone === 'warn' ? 'var(--warn)' : e.tone === 'ok' ? 'var(--ok)' : 'var(--rs-tx-2)' }}>{e.msg}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
