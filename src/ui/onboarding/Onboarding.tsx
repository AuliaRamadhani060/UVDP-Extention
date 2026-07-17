// Onboarding first-run (U6) — singkat & jujur: apa yang UVPD lakukan, izin apa
// yang dipakai & untuk apa, cara memakainya, dan batas tegasnya (DRM tak disentuh).
import { useState } from 'react';
import { browser } from '@/platform/browser';
import { Radio, ShieldCheck, PanelRight, Download, ArrowRight, Check } from 'lucide-react';
import { getSettings, saveSettings } from '@/shared/store';
import { t } from '@/i18n';

interface Step { icon: typeof Radio; title: string; body: string }

const STEPS: Step[] = [
  { icon: Radio, title: 'onb.detect.title', body: 'onb.detect.body' },
  { icon: PanelRight, title: 'onb.use.title', body: 'onb.use.body' },
  { icon: Download, title: 'onb.download.title', body: 'onb.download.body' },
  { icon: ShieldCheck, title: 'onb.privacy.title', body: 'onb.privacy.body' },
];

// Izin yang diminta + alasannya (transparansi, bukan daftar mentah dari manifest).
const PERMS: Array<{ k: string; v: string }> = [
  { k: 'onb.perm.host', v: 'onb.perm.hostWhy' },
  { k: 'onb.perm.webRequest', v: 'onb.perm.webRequestWhy' },
  { k: 'onb.perm.downloads', v: 'onb.perm.downloadsWhy' },
  { k: 'onb.perm.storage', v: 'onb.perm.storageWhy' },
  { k: 'onb.perm.dnr', v: 'onb.perm.dnrWhy' },
];

export function Onboarding() {
  const [done, setDone] = useState(false);

  async function finish() {
    const s = await getSettings();
    await saveSettings({ ...s, onboarded: true });
    setDone(true);
    // Tutup tab onboarding bila dibuka sebagai tab tersendiri.
    setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 400);
  }

  return (
    <div className="rs-root rs-ambient min-h-screen" style={{ background: 'var(--rs-bg)' }}>
      <div className="mx-auto flex max-w-2xl flex-col gap-5 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="rs-display text-[28px]" style={{ color: 'var(--rs-tx)' }}>{t('onb.welcome')}</h1>
          <p className="text-[13px]" style={{ color: 'var(--rs-tx-2)' }}>{t('onb.tagline')}</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <section key={title} className="flex flex-col gap-2 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
              <div className="flex items-center gap-2">
                <Icon size={16} style={{ color: 'var(--rs-accent)' }} />
                <h2 className="text-[13px] font-semibold" style={{ color: 'var(--rs-tx)' }}>{t(title)}</h2>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--rs-tx-2)' }}>{t(body)}</p>
            </section>
          ))}
        </div>

        <section className="flex flex-col gap-2 rounded-panel p-4" style={{ background: 'var(--rs-panel)', border: '1px solid var(--rs-line)' }}>
          <h2 className="rs-display text-[15px]" style={{ color: 'var(--rs-tx)' }}>{t('onb.perms')}</h2>
          <p className="text-[11px]" style={{ color: 'var(--rs-tx-3)' }}>{t('onb.permsHint')}</p>
          <ul className="flex flex-col gap-1.5">
            {PERMS.map((p) => (
              <li key={p.k} className="flex gap-2 text-[12px]">
                <code className="rs-mono flex-none rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--rs-line-2)', color: 'var(--rs-tx)' }}>{t(p.k)}</code>
                <span style={{ color: 'var(--rs-tx-2)' }}>{t(p.v)}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex items-center gap-3">
          <button type="button" onClick={finish} disabled={done}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
            {done ? <><Check size={15} /> {t('onb.done')}</> : <>{t('onb.start')} <ArrowRight size={15} /></>}
          </button>
          <button type="button" onClick={() => browser.runtime.openOptionsPage()}
            className="rounded-md px-3 py-2.5 text-[13px]" style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-2)' }}>
            {t('settings.openFull')}
          </button>
        </div>
      </div>
    </div>
  );
}
