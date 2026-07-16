import { render } from 'preact';
import { initLocale } from '@/i18n';
import { Manager } from './Manager';
import '@/ui/globals.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';

async function boot() {
  await initLocale(); // tema/aksen/densitas via store (useApplyTheme)
  render(<Manager />, document.getElementById('app')!);
}
boot();
