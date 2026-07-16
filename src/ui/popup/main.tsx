import { render } from 'preact';
import { initLocale } from '@/i18n';
import { initTheme } from '@/ui/theme/theme';
import { Popup } from './Popup';
import '@/ui/globals.css';

async function boot() {
  await Promise.all([initLocale(), initTheme()]);
  render(<Popup />, document.getElementById('app')!);
}

boot();
