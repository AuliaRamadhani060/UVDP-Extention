// CompactCard (M6) — kartu media RINGKAS yang dipakai BERSAMA popup & dropdown
// in-page (anti-duplikasi). Preact murni + inline SVG (Icon) + kelas `uv-cc-*`
// yang di-styling oleh COMPACT_CARD_CSS. Warna via token `--rs-*` yang disediakan
// masing-masing surface (popup: globals.css; dropdown: :host di Shadow DOM).
// Aksi lewat jalur bersama `shared/actions`.
import { mediaActions, copyUrl } from '@/shared/actions';
import { mediaKind, mediaDisplayName, mediaOrigin, mediaQualityLabel } from '@/core/media-utils';
import { t } from '@/i18n';
import { Icon } from './Icons';
import type { MediaItem } from '@/shared/types';

export type CompactKind = 'direct' | 'hls' | 'dash' | 'mse' | 'fragmented';
function kindOf(m: MediaItem): CompactKind {
  if (m.kind === 'fragmented') return 'fragmented';
  return /^blob:/i.test(m.url) ? 'mse' : mediaKind(m);
}
const KIND_VAR: Record<CompactKind, string> = {
  direct: 'var(--direct)', hls: 'var(--hls)', dash: 'var(--dash)', mse: 'var(--mse)', fragmented: 'var(--frag)',
};
const KIND_KEY: Record<CompactKind, string> = {
  direct: 'kindLabel.direct', hls: 'kindLabel.hls', dash: 'kindLabel.dash', mse: 'kindLabel.mse', fragmented: 'kindLabel.fragmented',
};

export function CompactCard({ media }: { media: MediaItem }) {
  const kind = kindOf(media);
  const color = KIND_VAR[kind];
  const stream = kind === 'hls' || kind === 'dash' || kind === 'fragmented';
  const canPlay = !media.protected && kind !== 'fragmented' && !(kind === 'mse' && /^blob:/i.test(media.url));
  const canDl = !media.protected && !(kind === 'mse' && !/^mse:\/\//.test(media.url));
  const variants = (media.variants || []).filter((v) => v.url && (v.resolution || v.height));
  const q = mediaQualityLabel(media);

  return (
    <div class="uv-cc">
      <div class="uv-cc__thumb" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${color} 32%, var(--rs-card)) 0%, var(--rs-card) 74%)` }}>
        {media.poster
          ? <img src={media.poster} alt="" loading="lazy" />
          : <span class="uv-cc__thumb-ic" style={{ color }}>{stream ? <Icon.stream size={16} /> : <Icon.film size={16} />}</span>}
        {q && <span class="uv-cc__q-badge">{q}</span>}
      </div>

      <div class="uv-cc__body">
        <div class="uv-cc__title" title={media.url}>{media.title || mediaDisplayName(media)}</div>
        <div class="uv-cc__meta">
          <span class="uv-cc__badge" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>{t(KIND_KEY[kind])}</span>
          <span class="uv-cc__origin">{mediaOrigin(media)}</span>
        </div>
      </div>

      {media.protected ? (
        <span class="uv-cc__lock" title={t('media.protected')}><Icon.shield size={13} /></span>
      ) : (
        <div class="uv-cc__acts">
          {canPlay && <button class="uv-cc__btn" title={t('media.play')} aria-label={t('media.play')} onClick={() => mediaActions.play(media.id)}><Icon.play size={13} /></button>}
          {canDl && <button class="uv-cc__btn uv-cc__btn--pri" title={t('media.download')} aria-label={t('media.download')} onClick={() => mediaActions.openDownloader(media.id)}><Icon.download size={13} /></button>}
          {canDl && variants.length > 1 && (
            <select class="uv-cc__qsel" title={t('sort.quality')} aria-label={t('sort.quality')}
              onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) mediaActions.quickDownload(media.id, { quality: v }); (e.target as HTMLSelectElement).value = ''; }}>
              <option value="">{t('sort.quality')}</option>
              {variants.slice().reverse().map((v, i) => { const lb = v.resolution || `${v.height}p`; return <option key={i} value={lb}>{lb}</option>; })}
            </select>
          )}
          <button class="uv-cc__btn" title={t('media.copyLink')} aria-label={t('media.copyLink')} onClick={() => copyUrl(media.url)}><Icon.copy size={13} /></button>
        </div>
      )}
    </div>
  );
}

// CSS bersama — di-inject di popup (globals) & shadow root dropdown. Semua warna
// via token --rs-* yang disediakan surface; fokus keyboard & reduced-motion dijaga.
export const COMPACT_CARD_CSS = `
.uv-cc{display:flex;align-items:center;gap:9px;padding:8px;border-radius:11px;
  background:var(--rs-card);border:1px solid var(--rs-line);transition:border-color .15s,transform .15s}
.uv-cc:hover{border-color:color-mix(in oklab,var(--rs-accent) 55%,var(--rs-line))}
.uv-cc__thumb{position:relative;width:58px;height:36px;flex:none;border-radius:7px;overflow:hidden;
  display:grid;place-items:center;background:var(--rs-card)}
.uv-cc__thumb img{width:100%;height:100%;object-fit:cover}
.uv-cc__q-badge{position:absolute;right:3px;bottom:3px;font:600 8.5px var(--font-mono,ui-monospace,monospace);
  padding:1px 4px;border-radius:4px;background:rgba(8,10,15,.72);color:var(--rs-tx)}
.uv-cc__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.uv-cc__title{font-size:12.5px;font-weight:600;color:var(--rs-tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uv-cc__meta{display:flex;align-items:center;gap:6px;min-width:0}
.uv-cc__badge{font:700 9px var(--font-mono,ui-monospace,monospace);text-transform:uppercase;letter-spacing:.03em;
  padding:1px 6px;border-radius:5px;flex:none}
.uv-cc__origin{font:400 10px var(--font-mono,ui-monospace,monospace);color:var(--rs-tx-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uv-cc__acts{display:flex;align-items:center;gap:3px;flex:none}
.uv-cc__btn{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;cursor:pointer;
  border:1px solid var(--rs-line);background:var(--rs-card-hi);color:var(--rs-tx-2)}
.uv-cc__btn:hover{background:color-mix(in oklab,var(--rs-accent) 18%,var(--rs-card-hi));color:var(--rs-tx)}
.uv-cc__btn--pri{background:var(--rs-accent);border-color:var(--rs-accent);color:#08111d}
.uv-cc__btn--pri:hover{filter:brightness(1.08);background:var(--rs-accent);color:#08111d}
.uv-cc__btn:focus-visible,.uv-cc__qsel:focus-visible{outline:2px solid var(--rs-accent);outline-offset:1px}
.uv-cc__qsel{height:28px;max-width:76px;font-size:11px;border-radius:7px;cursor:pointer;
  border:1px solid var(--rs-line);background:var(--rs-card-hi);color:var(--rs-tx-2)}
.uv-cc__lock{display:grid;place-items:center;width:28px;color:var(--rs-tx-3)}
@media (prefers-reduced-motion:reduce){.uv-cc{transition:none}}
`;
