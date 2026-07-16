// Sparkline kecepatan unduhan — SVG murni (tanpa pustaka chart), ringan & mulus.
interface Props { data: number[]; width?: number; height?: number; color?: string }

export function Sparkline({ data, width = 96, height = 26, color = 'var(--rs-accent)' }: Props) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  const max = Math.max(...data, 1);
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - 2 - (v / max) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} stroke-width={1.5} stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}
