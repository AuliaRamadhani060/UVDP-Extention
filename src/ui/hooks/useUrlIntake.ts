// Analisis cepat URL (U5): tempel (Ctrl/⌘+V) atau seret-lepas tautan media ke
// Manager → langsung dianalisis & masuk Library. Berguna untuk URL yang didapat
// dari luar (chat, catatan) tanpa harus membuka halamannya.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useUvpd } from '@/ui/store/uvpd';
import { t } from '@/i18n';

const URL_RE = /https?:\/\/[^\s"'<>]+/i;

function extractUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
}

/** @returns true saat ada tautan sedang di-seret di atas jendela (untuk overlay). */
export function useUrlIntake(): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const analyze = (raw: string | null) => {
      const url = raw && extractUrl(raw);
      if (!url) return false;
      useUvpd.getState().analyzeUrl(url);
      toast(t('intake.analyzing'), { description: url.slice(0, 90) });
      return true;
    };

    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Jangan bajak paste di kolom input (mis. pencarian / command palette).
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      analyze(e.clipboardData?.getData('text') || '');
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dt = e.dataTransfer;
      analyze(dt?.getData('text/uri-list') || dt?.getData('text') || '');
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('text/uri-list') && !e.dataTransfer?.types?.includes('text/plain')) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };

    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
    };
  }, []);

  return dragging;
}
