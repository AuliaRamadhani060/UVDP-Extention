// Pemilih tema reaktif.
import { t } from '@/i18n';
import { themeSignal, setTheme, type ThemeMode } from '@/ui/theme/theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemeMode, string> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

export function ThemeSwitcher() {
  return (
    <select
      class="uvpd-btn"
      value={themeSignal.value}
      onChange={(e) => setTheme((e.target as HTMLSelectElement).value as ThemeMode)}
      aria-label={t('settings.theme')}
    >
      {MODES.map((m) => (
        <option key={m} value={m}>
          {t(LABEL[m])}
        </option>
      ))}
    </select>
  );
}
