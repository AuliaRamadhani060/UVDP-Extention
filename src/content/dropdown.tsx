// Dropdown in-page (M3) — quick-list media melayang, di dalam SHADOW DOM agar CSS
// situs tak bocor (Aturan Keras). Floating button + panel daftar media tab ini,
// live dari broadcast registry, aksi lewat jalur bersama `shared/actions`.
// UI minimal (poles = M6). Hanya dipasang di top frame & bila host tidak dinonaktifkan.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { mediaActions, copyUrl } from '@/shared/actions';
import { mediaKind, mediaDisplayName, mediaOrigin } from '@/core/media-utils';
import { t } from '@/i18n';
import { Icon } from '@/ui/components/Icons';
import type { MediaItem } from '@/shared/types';
import type { BroadcastMessage } from '@/shared/contract';

const HOST_ID = 'uvpd-inpage-dropdown';

// CSS self-contained (tak bergantung globals) — hidup di dalam shadow root.
const CSS = `
:host, * { box-sizing: border-box; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
.fab { width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
  background: #5b8def; color: #08111d; display: grid; place-items: center;
  box-shadow: 0 6px 20px rgba(0,0,0,.35); position: relative; }
.fab:hover { filter: brightness(1.08); }
.badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 9px; background: #ff5d6c; color: #fff; font-size: 11px; font-weight: 700;
  display: grid; place-items: center; }
.panel { position: absolute; right: 0; bottom: 56px; width: 320px; max-height: 60vh; overflow: auto;
  background: #12161d; color: #eaeef5; border: 1px solid #2a2f3a; border-radius: 12px;
  box-shadow: 0 16px 44px rgba(0,0,0,.5); padding: 8px; }
.head { display: flex; align-items: center; gap: 8px; padding: 4px 6px 8px; }
.head b { font-size: 13px; flex: 1; }
.x { background: none; border: none; color: #8a94a4; cursor: pointer; display: grid; place-items: center; }
.x:hover { color: #fff; }
.item { display: flex; align-items: center; gap: 8px; padding: 7px; border-radius: 8px; }
.item:hover { background: #1a1f28; }
.ic { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; flex: none;
  background: #232936; color: #9fb4d6; }
.ic.stream { color: #5b8def; }
.body { flex: 1; min-width: 0; }
.title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.origin { font-size: 10px; color: #8a94a4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acts { display: flex; gap: 2px; flex: none; }
.b { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: #c7cdd6; cursor: pointer; display: grid; place-items: center; }
.b:hover { background: #2a3140; color: #fff; }
.b.dl { color: #5b8def; }
.lock { color: #ff5d6c; display: grid; place-items: center; width: 28px; }
.empty { padding: 14px; text-align: center; color: #8a94a4; font-size: 12px; }
`;

function kindOf(m: MediaItem): 'mse' | 'hls' | 'dash' | 'direct' | 'fragmented' {
  if (m.kind === 'fragmented') return 'fragmented';
  return /^blob:/i.test(m.url) ? 'mse' : mediaKind(m);
}

function Dropdown() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [open, setOpen] = useState(false);

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

  const listed = useMemo(() => items.filter((m) => kindOf(m) !== 'mse' || /^mse:\/\//.test(m.url)), [items]);
  if (listed.length === 0) return null; // sembunyi total saat tak ada media

  return (
    <div class="wrap">
      {open && (
        <div class="panel" role="dialog" aria-label="UVPD">
          <div class="head">
            <b>UVPD — {listed.length}</b>
            <button class="x" onClick={() => setOpen(false)} aria-label="close"><Icon.close size={15} /></button>
          </div>
          {listed.map((m) => {
            const kind = kindOf(m);
            const stream = kind === 'hls' || kind === 'dash' || kind === 'fragmented';
            const canPlay = !m.protected && kind !== 'fragmented';
            const canDl = !m.protected;
            return (
              <div class="item" key={m.id}>
                <span class={`ic ${stream ? 'stream' : ''}`}>{stream ? <Icon.stream size={14} /> : <Icon.film size={14} />}</span>
                <div class="body">
                  <div class="title" title={m.url}>{m.title || mediaDisplayName(m)}</div>
                  <div class="origin">{mediaOrigin(m)}</div>
                </div>
                {m.protected ? (
                  <span class="lock" title={t('media.protected')}><Icon.shield size={13} /></span>
                ) : (
                  <div class="acts">
                    {canPlay && <button class="b" title={t('media.play')} onClick={() => mediaActions.play(m.id)}><Icon.play size={13} /></button>}
                    {canDl && <button class="b dl" title={t('media.download')} onClick={() => mediaActions.openDownloader(m.id)}><Icon.download size={13} /></button>}
                    <button class="b" title={t('media.copyLink')} onClick={() => copyUrl(m.url)}><Icon.copy size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button class="fab" onClick={() => setOpen((v) => !v)} aria-label="UVPD" aria-expanded={open}>
        <Icon.film size={20} />
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
