// ProvenanceChips (U5) — filter berdasarkan CARA media tertangkap, bukan formatnya.
// Menjawab pertanyaan yang tak bisa dijawab tool lain: "yang mana dari iframe?",
// "yang mana hasil susun-ulang fragmen?", "yang muncul setelah navigasi SPA?".
import { Frame, Blocks, Route, Layers } from 'lucide-react';
import { useUvpd, type ProvenanceFilter } from '@/ui/store/uvpd';
import { matchesProvenance } from '@/ui/lib/media-view';
import { t } from '@/i18n';

const CHIPS: Array<{ v: ProvenanceFilter; k: string; icon: typeof Frame }> = [
  { v: 'any', k: 'prov.any', icon: Layers },
  { v: 'iframe', k: 'prov.iframe', icon: Frame },
  { v: 'reassembled', k: 'prov.reassembled', icon: Blocks },
  { v: 'spa', k: 'prov.spa', icon: Route },
];

export function ProvenanceChips() {
  const media = useUvpd((s) => s.media);
  const provenance = useUvpd((s) => s.provenance);
  const setProvenance = useUvpd((s) => s.setProvenance);
  const all = Object.values(media);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('prov.label')}>
      {CHIPS.map(({ v, k, icon: Icon }) => {
        const count = v === 'any' ? all.length : all.filter((m) => matchesProvenance(m, v)).length;
        // Sembunyikan chip provenance yang tak punya isi (kecuali "semua" & yang aktif).
        if (v !== 'any' && count === 0 && provenance !== v) return null;
        const active = provenance === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => setProvenance(v)}
            aria-pressed={active}
            title={t(k + '.hint')}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={active
              ? { background: 'color-mix(in oklab, var(--rs-accent) 22%, transparent)', color: 'var(--rs-accent)', border: '1px solid var(--rs-accent)' }
              : { background: 'var(--rs-card)', color: 'var(--rs-tx-3)', border: '1px solid var(--rs-line)' }}
          >
            <Icon size={11} />
            {t(k)}
            <span className="rs-mono opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
