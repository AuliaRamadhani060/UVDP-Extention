import { render } from 'preact';
import { initLocale } from '@/i18n';
import { Options } from './Options';
import '@/ui/globals.css';

// Tema/aksen/densitas diterapkan di dalam Options (dari preferensi tersimpan).
async function boot() {
  await initLocale();
  render(<Options />, document.getElementById('app')!);
}
boot();
