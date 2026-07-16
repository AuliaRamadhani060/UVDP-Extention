/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx,html}'],
  // Preflight dimatikan di U0 agar surface lama (CSS sendiri) tidak ter-reset.
  // Diaktifkan kembali saat redesain di U1.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--sh-border))',
        input: 'hsl(var(--sh-input))',
        ring: 'hsl(var(--sh-ring))',
        background: 'hsl(var(--sh-background))',
        foreground: 'hsl(var(--sh-foreground))',
        primary: { DEFAULT: 'hsl(var(--sh-primary))', foreground: 'hsl(var(--sh-primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--sh-secondary))', foreground: 'hsl(var(--sh-secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--sh-destructive))', foreground: 'hsl(var(--sh-destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--sh-muted))', foreground: 'hsl(var(--sh-muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--sh-accent))', foreground: 'hsl(var(--sh-accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--sh-popover))', foreground: 'hsl(var(--sh-popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--sh-card))', foreground: 'hsl(var(--sh-card-foreground))' },
        // Warna semantik cara-pengiriman (§4.4) — dipakai penuh di U1.
        kind: { direct: 'var(--direct)', hls: 'var(--hls)', dash: 'var(--dash)', mse: 'var(--mse)', frag: 'var(--frag)' },
      },
      borderRadius: {
        lg: 'var(--sh-radius)',
        md: 'calc(var(--sh-radius) - 2px)',
        sm: 'calc(var(--sh-radius) - 4px)',
        card: '16px',
        panel: '22px',
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
      boxShadow: {
        elev: '0 24px 60px -24px rgba(0,0,0,.85)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
