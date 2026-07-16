// ProvenanceStrip (§4.4) — "signature" UVPD: bagaimana media tertangkap.
// Equalizer mini beranimasi berwarna sesuai MediaKind + jejak monospace.
import { provenance, kindColorVar, viewKind } from '@/ui/lib/media-view';
import type { MediaItem } from '@/shared/types';

export function ProvenanceStrip({ media }: { media: MediaItem }) {
  const color = kindColorVar(viewKind(media));
  return (
    <div className="flex items-center gap-1.5 rs-mono text-[10px]" title={provenance(media)}>
      <span className="rs-eq" style={{ color }} aria-hidden="true">
        <i /><i /><i /><i />
      </span>
      <span className="truncate" style={{ color: 'var(--rs-tx-2)' }}>{provenance(media)}</span>
    </div>
  );
}
