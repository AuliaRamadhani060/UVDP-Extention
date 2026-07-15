// Engine i18n reaktif berbasis @preact/signals.
// - Ganti bahasa tanpa reload (UI otomatis re-render via signal).
// - Deteksi bahasa awal dari storage -> preferensi browser -> fallback 'en'.
// - Dukungan RTL (mis. Arab): otomatis set dir dokumen.
// Menambah bahasa = tambah entri di LOCALES + satu file JSON. Tidak ada langkah lain.
import { signal, computed } from '@preact/signals';
import { browser } from '@/platform/browser';

import id from './locales/id.json';
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

type Dict = Record<string, string>;

export interface LocaleMeta {
  code: string;
  label: string; // nama bahasa dalam bahasa itu sendiri (endonym)
  dict: Dict;
  rtl?: boolean;
}

export const LOCALES: LocaleMeta[] = [
  { code: 'id', label: 'Bahasa Indonesia', dict: id },
  { code: 'en', label: 'English', dict: en },
  { code: 'es', label: 'Español', dict: es },
  { code: 'ar', label: 'العربية', dict: ar, rtl: true },
  { code: 'ja', label: '日本語', dict: ja },
  { code: 'zh', label: '中文', dict: zh },
];

const FALLBACK = 'en';
const STORAGE_KEY = 'uvpd:locale';

function byCode(code: string): LocaleMeta | undefined {
  return LOCALES.find((l) => l.code === code);
}

// Signal locale aktif. Semua komponen yang memakai t() akan re-render saat berubah.
export const localeSignal = signal<string>(detectInitialLocale());

const activeMeta = computed(() => byCode(localeSignal.value) || byCode(FALLBACK)!);

function detectInitialLocale(): string {
  const langs = (navigator.languages || [navigator.language || FALLBACK]).map((l) =>
    l.toLowerCase().split('-')[0],
  );
  for (const l of langs) if (byCode(l)) return l;
  return 'id'; // default proyek: Indonesia
}

/** Terjemahkan kunci; dukung interpolasi {param}. */
export function t(key: string, params?: Record<string, string | number>): string {
  const meta = activeMeta.value;
  let text = meta.dict[key] ?? byCode(FALLBACK)!.dict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** Ubah bahasa aktif, simpan preferensi, dan sesuaikan arah dokumen. */
export async function setLocale(code: string): Promise<void> {
  if (!byCode(code)) return;
  localeSignal.value = code;
  applyDir();
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: code });
  } catch {
    /* konteks tanpa storage (mis. MAIN world) — abaikan */
  }
}

/** Terapkan dir/lang ke <html> sesuai locale aktif. */
export function applyDir(): void {
  const meta = activeMeta.value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.rtl ? 'rtl' : 'ltr';
  }
}

/** Muat preferensi tersimpan (panggil sekali saat startup UI). */
export async function initLocale(): Promise<void> {
  try {
    const res = await browser.storage.local.get(STORAGE_KEY);
    const saved = res[STORAGE_KEY] as string | undefined;
    if (saved && byCode(saved)) localeSignal.value = saved;
  } catch {
    /* abaikan */
  }
  applyDir();
}
