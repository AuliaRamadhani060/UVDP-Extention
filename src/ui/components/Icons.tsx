// Set ikon SVG minimal (gaya feather) — konsisten & tajam di semua ukuran.
import type { JSX } from 'preact';

type IconProps = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

function base(size: number, children: JSX.Element, filled = false): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  play: ({ size = 16 }: IconProps) => base(size, <polygon points="6 4 20 12 6 20 6 4" />, true),
  download: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>,
    ),
  copy: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>,
    ),
  star: ({ size = 16, ...p }: IconProps) =>
    base(size, <polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" />, (p as { filled?: boolean }).filled),
  film: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <rect x="2" y="2" width="20" height="20" rx="2.5" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </>,
    ),
  stream: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
      </>,
    ),
  search: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>,
    ),
  close: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>,
    ),
  shield: ({ size = 16 }: IconProps) => base(size, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  check: ({ size = 16 }: IconProps) => base(size, <polyline points="20 6 9 17 4 12" />),
  sidebar: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </>,
    ),
  clock: ({ size = 16 }: IconProps) =>
    base(
      size,
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </>,
    ),
};
