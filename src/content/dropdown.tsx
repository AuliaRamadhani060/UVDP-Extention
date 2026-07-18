// Dropdown in-page (M6) — quick-list media melayang, di dalam SHADOW DOM (CSS
// situs tak bocor). Gaya "glass" konsisten token "ruang sinyal", floating button
// dengan badge, animasi masuk halus, dapat DIGESER & ditutup. Kartu = CompactCard
// (dipakai bersama popup). LOGIKA M3 tak berubah (live broadcast, disabledHosts,
// top-frame, jalur aksi shared).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { mediaActions } from '@/shared/actions';
import { mediaKind } from '@/core/media-utils';
import { t } from '@/i18n';
import { Icon } from '@/ui/components/Icons';
import { CompactCard, COMPACT_CARD_CSS } from '@/ui/components/CompactCard';
import type { MediaItem } from '@/shared/types';
import type { BroadcastMessage } from '@/shared/contract';

const HOST_ID = 'uvpd-inpage-dropdown';

// Token "ruang sinyal" disuntik ke :host (—:root tak masuk shadow) + CSS kartu.
const CSS = `
:host {
  --rs-bg:#080a0f; --rs-panel:#12161f; --rs-surface:#0f131c; --rs-card:#141a25; --rs-card-hi:#18202d;
  --rs-tx:#eaeef5; --rs-tx-2:#98a3b4; --rs-tx-3:#5e6675;
  --rs-line:rgba(255,255,255,.10); --rs-line-2:rgba(255,255,255,.14);
  --rs-accent:#5b8def; --direct:#35d6a0; --hls:#5b8def; --dash:#a374ff; --mse:#f5b54a; --frag:#ff6fb3;
  --rs-glass:rgba(16,20,28,.72);
  --font-mono:ui-monospace,"JetBrains Mono","Cascadia Code","Consolas",monospace;
}
* { box-sizing: border-box; }
.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
  font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
.fab { position: relative; width: 48px; height: 48px; border-radius: 50%; border: none; cursor: grab;
  background: var(--rs-accent); color: #08111d; display: grid; place-items: center; touch-action: none;
  box-shadow: 0 8px 24px rgba(0,0,0,.4); transition: transform .15s, filter .15s; }
.fab:hover { filter: brightness(1.08); }
.fab:active { cursor: grabbing; transform: scale(.96); }
.fab:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.badge { position: absolute; top: -4px; right: -4px; min-width: 19px; height: 19px; padding: 0 5px;
  border-radius: 10px; background: var(--frag); color: #1a0a12; font: 700 11px var(--font-mono);
  display: grid; place-items: center; border: 2px solid var(--rs-bg); }
.panel { position: absolute; right: 0; bottom: 60px; width: 336px; max-height: 62vh; overflow: auto;
  background: var(--rs-glass); -webkit-backdrop-filter: blur(16px) saturate(1.2); backdrop-filter: blur(16px) saturate(1.2);
  color: var(--rs-tx); border: 1px solid var(--rs-line-2); border-radius: 16px;
  box-shadow: 0 20px 52px rgba(0,0,0,.55); padding: 9px; animation: pop-in .18s cubic-bezier(.2,.8,.2,1); }
@keyframes pop-in { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
.head { display: flex; align-items: center; gap: 8px; padding: 5px 7px 9px; }
.head .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--rs-accent); }
.head b { font-size: 12.5px; font-weight: 600; flex: 1; }
.head .n { font: 500 11px var(--font-mono); color: var(--rs-tx-3); }
.x { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; border: none;
  background: none; color: var(--rs-tx-3); cursor: pointer; }
.x:hover { background: var(--rs-card-hi); color: var(--rs-tx); }
.list { display: flex; flex-direction: column; gap: 5px; }
.empty { padding: 16px; text-align: center; color: var(--rs-tx-3); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } .fab { transition: none; } }
${COMPACT_CARD_CSS}
`;

// Filter tampil IDENTIK dengan M3 (jangan ubah logika): sembunyikan hanya
// capture MSE berbasis blob (tak actionable).
function listable(m: MediaItem): boolean {
  const kind = m.kind === 'fragmented' ? 'fragmented' : (/^blob:/i.test(m.url) ? 'mse' : mediaKind(m));
  return kind !== 'mse' || /^mse:\/\//.test(m.url);
}

function Dropdown() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const refresh = () => { mediaActions.getList().then((res) => setItems(res?.entries || [])).catch(() => {}); };

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMsg = (raw: unknown) => {
      const m = raw as BroadcastMessage;
      if (m?.type === 'MEDIA_LIST_UPDATED') { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 350); }
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => { browser.runtime.onMessage.removeListener(onMsg); if (timer) clearTimeout(timer); };
  }, []);

  // Geser FAB (pointer) — reposisi seluruh widget; klik dibedakan dari geser.
  const onMove = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    const x = Math.min(window.innerWidth - 56, Math.max(6, d.ox + dx));
    const y = Math.min(window.innerHeight - 56, Math.max(6, d.oy + dy));
    setPos({ x, y });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (drag.current?.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
    drag.current = null;
  };
  const onFabDown = (e: PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onFabClick = () => { if (suppressClick.current) return; setOpen((v) => !v); };

  const listed = useMemo(() => items.filter(listable), [items]);
  if (listed.length === 0) return null; // sembunyi total saat tak ada media

  const wrapStyle = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
    : undefined;

  return (
    <div class="wrap" ref={wrapRef} style={wrapStyle}>
      {open && (
        <div class="panel" role="dialog" aria-label="UVPD">
          <div class="head">
            <span class="dot" /><b>UVPD</b><span class="n">{listed.length}</span>
            <button class="x" onClick={() => setOpen(false)} aria-label={t('media.clear')}><Icon.close size={15} /></button>
          </div>
          <div class="list">
            {listed.map((m) => <CompactCard key={m.id} media={m} />)}
          </div>
        </div>
      )}
      <button class="fab" aria-label="UVPD" aria-expanded={open} onPointerDown={onFabDown} onClick={onFabClick}>
        <Icon.film size={21} />
        <span class="badge">{listed.length}</span>
      </button>
    </div>
  );
}

/** Pasang dropdown ke Shadow DOM host (top frame). Idempoten. */
export function mountDropdown(): void {
  if (window.top !== window) return; // hanya frame utama
  if (document.getElementById(HOST_ID)) return;
  const attach = () => {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial;'; // putus pewarisan CSS situs
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    (document.body || document.documentElement).appendChild(host);
    render(<Dropdown />, mount);
  };
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
}
