// Penilaian & pemilihan varian kualitas — di-port dari userscript UVPD.
import type { QualityVariant } from '@/shared/types';

export function formatFrameRate(value?: number | string): string {
  if (value === undefined || value === null || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return String(value);
  return `${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)} fps`;
}

export function parseFrameRate(value?: number | string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : undefined;
}

export function parseResolutionLabel(width?: number, height?: number): string {
  if (width && height) return `${width}x${height}`;
  if (height) return `${height}p`;
  if (width) return `${width}w`;
  return 'variant';
}

export function describeQualityVariant(variant: QualityVariant = {}): string {
  const parts: string[] = [];
  if (variant.resolution) parts.push(variant.resolution);
  if (variant.bandwidth) parts.push(`${Math.round(variant.bandwidth / 1000)} kbps`);
  if (variant.codecLabel) parts.push(variant.codecLabel);
  if (variant.frameRate) parts.push(formatFrameRate(variant.frameRate));
  return parts.join(' • ');
}

export function scoreQualityVariant(variant: QualityVariant = {}): number {
  const height =
    variant.height ||
    parseInt((variant.resolution || '').split('x')[1] || variant.resolution || '', 10) ||
    0;
  const width =
    variant.width || parseInt((variant.resolution || '').split('x')[0] || '', 10) || 0;
  const bandwidth = variant.bandwidth || 0;
  const frameRate = variant.frameRate || 0;
  const codec = (variant.codecs || variant.codecLabel || '').toLowerCase();
  const codecBoost = /av1|hevc|h265|vp9/.test(codec) ? 50 : /avc|h264/.test(codec) ? 25 : 0;
  return height * 1_000_000 + width * 10_000 + bandwidth + frameRate * 1000 + codecBoost;
}

export function pickBestQualityVariant(variants: QualityVariant[] = []): QualityVariant | null {
  if (!Array.isArray(variants) || !variants.length) return null;
  return (
    variants
      .map((variant, index) => ({ index, ...variant }))
      .sort((a, b) => scoreQualityVariant(a) - scoreQualityVariant(b))
      .pop() || null
  );
}
