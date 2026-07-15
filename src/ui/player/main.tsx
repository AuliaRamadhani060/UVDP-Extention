import { render } from 'preact';
import { initLocale } from '@/i18n';
import { initTheme } from '@/ui/theme/theme';
import { Player } from './Player';
import '@/ui/theme/tokens.css';

async function boot() {
  await Promise.all([initLocale(), initTheme()]);
  render(<Player />, document.getElementById('app')!);
}
boot();
