// MediaCard (§4.5) — kartu media kaya: thumbnail/gradien per-kind, judul pintar,
// strip provenance, tangga kualitas, aksi hover, dan progress unduhan.
import { useState, type ReactNode } from 'react';
import { Play, Download, Copy, Star, Terminal, ShieldAlert, Film, Radio, Captions } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { useQueue } from '@/ui/store/downloads';
import { ProvenanceStrip } from './ProvenanceStrip';
import { QualityLadder } from './QualityLadder';
import { viewKind, kindColorVar, kindLabel, smartName, metaTokens, mediaOrigin } from '@/ui/lib/media-view';
import { formatDuration } from '@/core/media-utils';
import { t } from '@/i18n';
import type { MediaItem } from '@/shared/types';

function IconBtn({ label, onClick, primary, active, children }: { label: string; onClick: () => void; primary?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={
        primary
          ? { background: 'var(--rs-accent)', color: '#08111d', fontWeight: 600 }
          : { background: 'var(--rs-card-hi)', color: active ? 'var(--warn)' : 'var(--rs-tx-2)', border: '1px solid var(--rs-line)' }
      }
    >
      {children}
    </button>
  );
}

export function MediaCard({ media, isMain }: { media: MediaItem; isMain?: boolean }) {
  const play = useUvpd((s) => s.play);
  const qDownload = useQueue((s) => s.download);
  const subtitle = useQueue((s) => s.subtitle);
  const copyFfmpeg = useUvpd((s) => s.copyFfmpeg);
  const toggleFavorite = useUvpd((s) => s.toggleFavorite);
  const fav = useUvpd((s) => s.favorites.includes(media.url));
  const dl = useUvpd((s) => s.downloads[media.id]);

  // Kualitas per-unduhan (untuk file multi-varian). undefined = terbaik (default).
  const variants = (media.variants || []).filter((v) => v.url && (v.resolution || v.height));
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const subs = media.subtitles || [];

  const k = viewKind(media);
  const color = kindColorVar(k);
  const isStream = k === 'hls' || k === 'dash';
  const canPlay = !media.protected && k !== 'fragmented' && !(k === 'mse' && /^blob:/i.test(media.url));
  const canDownload = !media.protected && !(k === 'mse' && !/^mse:\/\//.test(media.url));
  const dur = formatDuration(media.duration);
  const pct = dl && dl.total > 0 ? Math.round((dl.loaded / dl.total) * 100) : 0;

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-card transition-transform duration-200 hover:-translate-y-1"
      style={{ background: 'var(--rs-card)', border: `1px solid ${isMain ? 'var(--rs-accent)' : 'var(--rs-line)'}`, boxShadow: isMain ? '0 0 0 1px var(--rs-accent) inset' : undefined }}
    >
      {/* Thumbnail / gradien per-kind */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16 / 9', background: `linear-gradient(135deg, color-mix(in oklab, ${color} 30%, var(--rs-card)) 0%, var(--rs-card) 72%)` }}>
        {media.poster ? (
          <img src={media.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color }}>
            {isStream || k === 'fragmented' ? <Radio size={26} /> : <Film size={26} />}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded px-1.5 py-0.5 rs-mono text-[10px] font-bold" style={{ background: 'rgba(8,10,15,.7)', color }}>{kindLabel(k)}</span>
        {isMain && <span className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'var(--rs-accent)', color: '#08111d' }}>{t('badge.main')}</span>}
        {dur && <span className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 rs-mono text-[10px]" style={{ background: 'rgba(8,10,15,.7)', color: 'var(--rs-tx)' }}>{dur}</span>}
        {media.protected && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(8,10,15,.7)', color: 'var(--danger-rs)' }}>
            <ShieldAlert size={11} /> DRM
          </span>
        )}
        {/* Overlay aksi saat hover */}
        {canPlay && (
          <button
            type="button"
            onClick={() => play(media.id)}
            aria-label={t('media.play')}
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            style={{ background: 'rgba(8,10,15,.35)' }}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--rs-accent)', color: '#08111d' }}>
              <Play size={20} fill="currentColor" />
            </span>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-3" style={{ paddingBottom: '10px' }}>
        <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--rs-tx)' }} title={smartName(media)}>{smartName(media)}</div>
        <div className="flex items-center gap-2">
          <span className="truncate rs-mono text-[10px]" style={{ color: 'var(--rs-tx-3)' }}>{mediaOrigin(media)}</span>
        </div>
        <ProvenanceStrip media={media} />
        <QualityLadder media={media} />
        {metaTokens(media).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {metaTokens(media).map((tok, i) => (
              <span key={i} className="rs-mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--rs-card-hi)', color: 'var(--rs-tx-2)' }}>{tok}</span>
            ))}
          </div>
        )}

        {/* Aksi */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {canDownload && <IconBtn label={t('media.download')} onClick={() => qDownload(media.id, { quality })} primary><Download size={13} /> {t('media.download')}</IconBtn>}
          {canDownload && variants.length > 1 && (
            <select
              aria-label={t('sort.quality')}
              value={quality ?? ''}
              onChange={(e) => setQuality((e.target as HTMLSelectElement).value || undefined)}
              className="h-7 rounded-md px-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: 'var(--rs-card-hi)', color: 'var(--rs-tx-2)', border: '1px solid var(--rs-line)' }}
            >
              <option value="">{t('player.auto')}</option>
              {variants.slice().reverse().map((v, i) => {
                const label = v.resolution || `${v.height}p`;
                return <option key={i} value={label}>{label}</option>;
              })}
            </select>
          )}
          {subs.length > 0 && <IconBtn label={t('dl.subtitle')} onClick={() => subtitle(media.id, subs.findIndex((s) => s.default) >= 0 ? subs.findIndex((s) => s.default) : 0)}><Captions size={13} /></IconBtn>}
          {isStream && <IconBtn label={t('media.ffmpeg')} onClick={() => copyFfmpeg(media.id)}><Terminal size={13} /></IconBtn>}
          <IconBtn label={t('media.copyLink')} onClick={() => navigator.clipboard.writeText(media.url)}><Copy size={13} /></IconBtn>
          <IconBtn label={t('media.favorite')} onClick={() => toggleFavorite(media.url)} active={fav}><Star size={13} fill={fav ? 'currentColor' : 'none'} /></IconBtn>
          {media.protected && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--danger-rs)' }}><ShieldAlert size={12} /> {t('media.protected')}</span>}
        </div>

        {dl && dl.total > 0 && dl.status !== 'complete' && (
          <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--rs-line-2)' }}>
            <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: 'var(--rs-accent)' }} />
          </div>
        )}
      </div>
    </div>
  );
}
