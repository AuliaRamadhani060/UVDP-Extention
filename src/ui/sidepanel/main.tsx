import { render } from 'preact';
import { initLocale } from '@/i18n';
import { SidePanel } from './SidePanel';
import '@/ui/globals.css';
// Font §4 (dibundel lokal, MV3-compliant).
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';

async function boot() {
  await initLocale(); // tema/aksen/densitas dikelola store (useApplyTheme)
  render(<SidePanel />, document.getElementById('app')!);
}
boot();
