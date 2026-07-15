import { useEffect, useState } from 'preact/hooks';
import { t } from '@/i18n';
import { getSettings, saveSettings, type Settings } from '@/shared/store';
import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/ui/components/ThemeSwitcher';
import './options.css';

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  }

  if (!settings) return <div class="opt">…</div>;

  return (
    <div class="opt">
      <header class="opt__head">
        <h1>{t('settings.title')}</h1>
        <div class="opt__switch">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <label class="opt__row">
        <input
          type="checkbox"
          checked={settings.autoLoadHls}
          onChange={(e) => update({ autoLoadHls: (e.target as HTMLInputElement).checked })}
        />
        {t('kind.hls')} auto-load
      </label>

      <label class="opt__row">
        {t('popup.count', { count: settings.maxAutoVideos })}
        <input
          type="number"
          min={10}
          max={2000}
          value={settings.maxAutoVideos}
          onInput={(e) => update({ maxAutoVideos: Number((e.target as HTMLInputElement).value) })}
        />
      </label>

      <label class="opt__row">
        <input
          type="checkbox"
          checked={settings.redactHistoryQuery}
          onChange={(e) => update({ redactHistoryQuery: (e.target as HTMLInputElement).checked })}
        />
        Redact history query token
      </label>

      <label class="opt__row">
        Auto-detect (ms)
        <input
          type="number"
          min={1000}
          max={60000}
          step={500}
          value={settings.autoDetectIntervalMs}
          onInput={(e) => update({ autoDetectIntervalMs: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
    </div>
  );
}
