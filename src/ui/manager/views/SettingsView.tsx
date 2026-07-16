// SettingsView (Manager) — preferensi tampilan cepat + tautan ke Options lengkap.
import type { ReactNode } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { browser } from '@/platform/browser';
import { useUvpd, type Theme, type Accent, type Density } from '@/ui/store/uvpd';
import { t, LOCALES, setLocale, localeSignal } from '@/i18n';

const sel = 'w-full rounded-md px-2 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const selStyle = { background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-[13px]" style={{ color: 'var(--rs-tx-2)' }}>{label}</span>
      <div className="w-52">{children}</div>
    </label>
  );
}

export function SettingsView() {
  const theme = useUvpd((s) => s.theme);
  const setTheme = useUvpd((s) => s.setTheme);
  const accent = useUvpd((s) => s.accent);
  const setAccent = useUvpd((s) => s.setAccent);
  const density = useUvpd((s) => s.density);
  const setDensity = useUvpd((s) => s.setDensity);

  return (
    <div className="mx-auto flex h-full w-full max-w-xl min-h-0 flex-col gap-5 overflow-y-auto p-6">
      <h2 className="rs-display text-[22px]" style={{ color: 'var(--rs-tx)' }}>{t('settings.title')}</h2>

      <div className="flex flex-col gap-4 rounded-lg p-4" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}>
        <Row label={t('settings.theme')}>
          <select className={sel} style={selStyle} value={theme} onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}>
            <option value="system">{t('theme.system')}</option>
            <option value="dark">{t('theme.dark')}</option>
            <option value="light">{t('theme.light')}</option>
          </select>
        </Row>
        <Row label={t('ui.accent')}>
          <select className={sel} style={selStyle} value={accent} onChange={(e) => setAccent((e.target as HTMLSelectElement).value as Accent)}>
            <option value="azure">Azure</option>
            <option value="emerald">Emerald</option>
            <option value="magenta">Magenta</option>
            <option value="amber">Amber</option>
          </select>
        </Row>
        <Row label={t('ui.density')}>
          <select className={sel} style={selStyle} value={density} onChange={(e) => setDensity((e.target as HTMLSelectElement).value as Density)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </Row>
        <Row label={t('settings.language')}>
          <select className={sel} style={selStyle} value={localeSignal.value} onChange={(e) => setLocale((e.target as HTMLSelectElement).value)}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Row>
      </div>

      <button
        type="button"
        onClick={() => browser.runtime.openOptionsPage?.()}
        className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ background: 'var(--rs-card-hi)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' }}
      >
        <ExternalLink size={14} /> {t('settings.openFull')}
      </button>

      <div className="flex items-start gap-2 rounded-lg p-3 text-[12px]" style={{ background: 'var(--rs-surface)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-3)' }}>
        <ShieldCheck size={16} style={{ color: 'var(--ok)', flexShrink: 0 }} />
        <span>{t('settings.privacyNote')}</span>
      </div>
    </div>
  );
}
