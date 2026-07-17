import { render } from 'preact';
import { initLocale } from '@/i18n';
import { getUiPrefs } from '@/shared/store';
import { Onboarding } from './Onboarding';
import '@/ui/globals.css';

async function boot() {
  const [, ui] = await Promise.all([initLocale(), getUiPrefs()]);
  const root = document.documentElement;
  const resolved = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : ui.theme;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-accent', ui.accent);
  root.setAttribute('data-density', ui.density);
  render(<Onboarding />, document.getElementById('app')!);
}
boot();
