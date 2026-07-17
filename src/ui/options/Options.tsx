// Options lengkap (U6) — semua preferensi di satu tempat + export/import config.
// Ditulis ulang dari halaman lama (±5 setting) ke stack React/Ruang Sinyal.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Upload, RotateCcw, Trash2, Plus, ShieldCheck, Keyboard, Check } from 'lucide-react';
import {
  getSettings, saveSettings, getUiPrefs, saveUiPrefs, exportConfig, importConfig, resetConfig,
  DEFAULT_KEYBINDS, type Settings, type UiPrefs, type PlayerAction,
} from '@/shared/store';
import { t, LOCALES, setLocale, localeSignal } from '@/i18n';

const ACCENTS: Array<{ v: UiPrefs['accent']; color: string }> = [
  { v: 'azure', color: '#5b8def' }, { v: 'emerald', color: '#35d6a0' },
  { v: 'magenta', color: '#ff6fb3' }, { v: 'amber', color: '#f5b54a' },
];
const KEY_ACTIONS: PlayerAction[] = [
  'playPause', 'seekBack', 'seekFwd', 'seekBack10', 'seekFwd10', 'volUp', 'volDown',
  'mute', 'fullscreen', 'pip', 'subtitle', 'frameBack', 'frameFwd', 'screenshot',
  'stats', 'loopA', 'loopB', 'loopClear', 'help',
];

const sel = 'rounded-md px-2 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const selStyle = { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
      <h2 className="rs-display text-[15px]" style={{ color: 'var(--rs-tx)' }}>{title}</h2>
      {children}
    </section>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px]" style={{ color: 'var(--rs-tx-2)' }}>{label}</div>
        {hint && <div className="text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{hint}</div>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: checked ? 'var(--rs-accent)' : 'var(--rs-line-2)' }}
    >
      <span className="absolute top-0.5 h-5 w-5 rounded-full transition-all" style={{ left: checked ? '22px' : '2px', background: checked ? '#08111d' : 'var(--rs-tx-3)' }} />
    </button>
  );
}

export function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [ui, setUi] = useState<UiPrefs | null>(null);
  const [msg, setMsg] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [capturing, setCapturing] = useState<PlayerAction | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { getSettings().then(setS); getUiPrefs().then(setUi); }, []);

  // Terapkan tema/aksen/densitas ke halaman ini juga (pratinjau langsung).
  useEffect(() => {
    if (!ui) return;
    const root = document.documentElement;
    const resolved = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : ui.theme;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-accent', ui.accent);
    root.setAttribute('data-density', ui.density);
  }, [ui]);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg((c) => (c === m ? '' : c)), 2500); };
  const update = (patch: Partial<Settings>) => { if (!s) return; const next = { ...s, ...patch }; setS(next); saveSettings(next); };
  const updateUi = (patch: Partial<UiPrefs>) => { if (!ui) return; const next = { ...ui, ...patch }; setUi(next); saveUiPrefs(next); };

  // Tangkap tombol berikutnya sebagai keybind untuk aksi terpilih.
  useEffect(() => {
    if (!capturing || !s) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key !== 'Escape') {
        const next = { ...s, keybinds: { ...s.keybinds, [capturing]: e.key } };
        setS(next); saveSettings(next);
      }
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [capturing, s]);

  async function doExport() {
    const cfg = await exportConfig();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `uvpd-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    flash(t('opt.exported'));
  }
  async function doImport(file: File) {
    try {
      const res = await importConfig(JSON.parse(await file.text()));
      if (!res.ok) { flash(res.error || 'error'); return; }
      setS(await getSettings());
      setUi(await getUiPrefs());
      flash(t('opt.imported'));
    } catch (e) { flash(String((e as Error).message || e)); }
  }
  async function doReset() {
    await resetConfig();
    setS(await getSettings());
    setUi(await getUiPrefs());
    flash(t('opt.reset'));
  }
  function addHost() {
    if (!s) return;
    const h = hostInput.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!h) return;
    update({ disabledHosts: Array.from(new Set([...s.disabledHosts, h])) });
    setHostInput('');
  }

  if (!s || !ui) return <div className="rs-root p-6" style={{ color: 'var(--rs-tx-3)' }}>…</div>;

  return (
    <div className="rs-root min-h-screen" style={{ background: 'var(--rs-bg)' }}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <header className="flex items-center justify-between">
          <h1 className="rs-display text-[24px]" style={{ color: 'var(--rs-tx)' }}>{t('settings.title')}</h1>
          {msg && <span className="rs-mono text-[11px]" style={{ color: 'var(--ok)' }}>{msg}</span>}
        </header>

        <Section title={t('opt.appearance')}>
          <Row label={t('settings.language')}>
            <select className={sel} style={selStyle} value={localeSignal.value} onChange={(e) => setLocale((e.target as HTMLSelectElement).value)}>
              {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Row>
          <Row label={t('settings.theme')}>
            <select className={sel} style={selStyle} value={ui.theme} onChange={(e) => updateUi({ theme: (e.target as HTMLSelectElement).value as UiPrefs['theme'] })}>
              <option value="system">{t('theme.system')}</option>
              <option value="dark">{t('theme.dark')}</option>
              <option value="light">{t('theme.light')}</option>
            </select>
          </Row>
          <Row label={t('ui.accent')}>
            <div className="flex gap-1.5">
              {ACCENTS.map((a) => (
                <button key={a.v} type="button" aria-label={a.v} aria-pressed={ui.accent === a.v} onClick={() => updateUi({ accent: a.v })}
                  className="h-7 w-7 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ background: a.color, outline: ui.accent === a.v ? '2px solid var(--rs-tx)' : 'none', outlineOffset: '2px' }} />
              ))}
            </div>
          </Row>
          <Row label={t('ui.density')}>
            <select className={sel} style={selStyle} value={ui.density} onChange={(e) => updateUi({ density: (e.target as HTMLSelectElement).value as UiPrefs['density'] })}>
              <option value="comfortable">comfortable</option>
              <option value="compact">compact</option>
            </select>
          </Row>
        </Section>

        <Section title={t('nav.player')}>
          <Row label={t('opt.autoplay')}>
            <Toggle label={t('opt.autoplay')} checked={s.player.autoPlay} onChange={(v) => update({ player: { ...s.player, autoPlay: v } })} />
          </Row>
          <Row label={t('opt.loop')}>
            <Toggle label={t('opt.loop')} checked={s.player.loop} onChange={(v) => update({ player: { ...s.player, loop: v } })} />
          </Row>
          <Row label={t('opt.defaultSpeed')}>
            <select className={sel} style={selStyle} value={String(s.player.defaultSpeed)} onChange={(e) => update({ player: { ...s.player, defaultSpeed: Number((e.target as HTMLSelectElement).value) } })}>
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
          </Row>
        </Section>

        <Section title={t('opt.keybinds')}>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>
            <Keyboard size={13} /> {t('opt.keybindHint')}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {KEY_ACTIONS.map((a) => (
              <button key={a} type="button" onClick={() => setCapturing(a)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: 'var(--rs-card)', border: `1px solid ${capturing === a ? 'var(--rs-accent)' : 'var(--rs-line)'}` }}>
                <span className="truncate text-[12px]" style={{ color: 'var(--rs-tx-2)' }}>{t('player.act.' + a)}</span>
                <kbd className="rs-mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--rs-line-2)', color: capturing === a ? 'var(--rs-accent)' : 'var(--rs-tx)' }}>
                  {capturing === a ? t('opt.pressKey') : (s.keybinds[a] === ' ' ? 'Space' : s.keybinds[a])}
                </kbd>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => update({ keybinds: { ...DEFAULT_KEYBINDS } })}
            className="inline-flex items-center gap-1.5 self-start rounded-md px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
            <RotateCcw size={12} /> {t('opt.resetKeybinds')}
          </button>
        </Section>

        <Section title={t('opt.detection')}>
          <Row label={t('opt.interval')} hint={t('opt.intervalHint')}>
            <input type="number" min={1000} max={60000} step={500} className={`${sel} w-28`} style={selStyle}
              value={s.autoDetectIntervalMs} onInput={(e) => update({ autoDetectIntervalMs: Number((e.target as HTMLInputElement).value) })} />
          </Row>
          <Row label={t('opt.maxVideos')}>
            <input type="number" min={10} max={2000} step={10} className={`${sel} w-28`} style={selStyle}
              value={s.maxAutoVideos} onInput={(e) => update({ maxAutoVideos: Number((e.target as HTMLInputElement).value) })} />
          </Row>
          <Row label={t('opt.autoLoadHls')}>
            <Toggle label={t('opt.autoLoadHls')} checked={s.autoLoadHls} onChange={(v) => update({ autoLoadHls: v })} />
          </Row>
          <Row label={t('dl.concurrency')} hint={t('opt.concurrencyHint')}>
            <input type="number" min={1} max={8} className={`${sel} w-28`} style={selStyle}
              value={s.maxConcurrentDownloads} onInput={(e) => update({ maxConcurrentDownloads: Math.max(1, Math.min(8, Number((e.target as HTMLInputElement).value) || 1)) })} />
          </Row>
        </Section>

        <Section title={t('opt.privacy')}>
          <div className="flex items-start gap-2 rounded-md p-2 text-[11px]" style={{ background: 'color-mix(in oklab, var(--ok) 10%, transparent)', color: 'var(--rs-tx-2)' }}>
            <ShieldCheck size={14} style={{ color: 'var(--ok)', flex: 'none' }} />
            <span>{t('settings.privacyNote')}</span>
          </div>
          <Row label={t('opt.redact')} hint={t('opt.redactHint')}>
            <Toggle label={t('opt.redact')} checked={s.redactHistoryQuery} onChange={(v) => update({ redactHistoryQuery: v })} />
          </Row>
          <div className="flex flex-col gap-2">
            <div className="text-[13px]" style={{ color: 'var(--rs-tx-2)' }}>{t('opt.perSite')}</div>
            <div className="text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('opt.perSiteHint')}</div>
            <div className="flex gap-2">
              <input className={`${sel} flex-1`} style={selStyle} placeholder="example.com" value={hostInput}
                onInput={(e) => setHostInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if ((e as unknown as KeyboardEvent).key === 'Enter') addHost(); }} />
              <button type="button" onClick={addHost} className="inline-flex items-center gap-1 rounded-md px-2.5 text-[12px]" style={{ background: 'var(--rs-accent)', color: '#08111d', fontWeight: 600 }}>
                <Plus size={13} /> {t('opt.addHost')}
              </button>
            </div>
            {s.disabledHosts.length > 0 && (
              <ul className="flex flex-col gap-1">
                {s.disabledHosts.map((h) => (
                  <li key={h} className="flex items-center justify-between rounded-md px-2 py-1" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
                    <span className="rs-mono text-[12px]" style={{ color: 'var(--rs-tx-2)' }}>{h}</span>
                    <button type="button" aria-label={`${t('media.clear')} ${h}`} onClick={() => update({ disabledHosts: s.disabledHosts.filter((x) => x !== h) })} style={{ color: 'var(--rs-tx-3)' }}>
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title={t('opt.config')}>
          <div className="text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('opt.configHint')}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={doExport} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' }}>
              <Download size={13} /> {t('opt.export')}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' }}>
              <Upload size={13} /> {t('opt.import')}
            </button>
            <button type="button" onClick={doReset} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--danger)' }}>
              <RotateCcw size={13} /> {t('opt.resetAll')}
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) doImport(f); (e.target as HTMLInputElement).value = ''; }} />
          </div>
        </Section>

        <footer className="flex items-center gap-1.5 pb-4 text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>
          <Check size={12} /> {t('opt.autosave')}
        </footer>
      </div>
    </div>
  );
}
