// QualityLadder (§4.5) — tangga chip kualitas; terbaik ter-highlight.
import type { MediaItem } from '@/shared/types';

export function QualityLadder({ media }: { media: MediaItem }) {
  const variants = media.variants || [];
  if (variants.length < 1) return null;
  const bestUrl = media.bestVariant?.url;
  const shown = variants.slice(0, 5);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((v, i) => {
        const best = bestUrl && v.url === bestUrl;
        const label = v.resolution || (v.height ? `${v.height}p` : `v${i + 1}`);
        return (
          <span
            key={i}
            className="rs-mono rounded px-1.5 py-0.5 text-[10px] leading-none"
            style={
              best
                ? { color: 'var(--rs-accent)', border: '1px solid var(--rs-accent)', fontWeight: 700 }
                : { color: 'var(--rs-tx-2)', border: '1px solid var(--rs-line-2)' }
            }
          >
            {label}
          </span>
        );
      })}
      {variants.length > shown.length && (
        <span className="rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>+{variants.length - shown.length}</span>
      )}
    </div>
  );
}
