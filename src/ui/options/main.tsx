import { render } from 'preact';
import { initLocale } from '@/i18n';
import { initTheme } from '@/ui/theme/theme';
import { Options } from './Options';
import '@/ui/theme/tokens.css';

async function boot() {
  await Promise.all([initLocale(), initTheme()]);
  render(<Options />, document.getElementById('app')!);
}
boot();
