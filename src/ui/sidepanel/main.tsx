import { render } from 'preact';
import { initLocale } from '@/i18n';
import { initTheme } from '@/ui/theme/theme';
import { SidePanel } from './SidePanel';
import '@/ui/globals.css';

async function boot() {
  await Promise.all([initLocale(), initTheme()]);
  render(<SidePanel />, document.getElementById('app')!);
}
boot();
