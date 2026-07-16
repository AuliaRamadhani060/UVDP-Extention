// StatCard (§4.5) — kartu statistik ringkas; angka pakai font display.
export function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg px-3 py-2"
      style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)' }}
    >
      <span className="rs-display text-[19px] leading-none" style={{ color: color || 'var(--rs-tx)' }}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--rs-tx-3)' }}>{label}</span>
    </div>
  );
}
