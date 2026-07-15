// Pemilih bahasa reaktif — dipakai di popup & options.
import { LOCALES, localeSignal, setLocale } from '@/i18n';

export function LanguageSwitcher() {
  return (
    <select
      class="uvpd-btn"
      value={localeSignal.value}
      onChange={(e) => setLocale((e.target as HTMLSelectElement).value)}
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
