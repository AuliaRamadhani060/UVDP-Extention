// PlayerView (Manager) — panel player sederhana (reuse Player U0). Player pro = U3.
import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { Player } from '@/ui/player/Player';
import { mediaRelevanceScore } from '@/core/media-utils';
import { smartName, viewKind, kindLabel } from '@/ui/lib/media-view';
import { t } from '@/i18n';

export function PlayerView() {
  const media = useUvpd((s) => s.media);
  const selected = useUvpd((s) => s.selectedMediaId);
  const setSelected = useUvpd((s) => s.setSelected);

  const list = useMemo(
    () => Object.values(media).filter((m) => !m.protected && viewKind(m) !== 'mse').sort((a, b) => mediaRelevanceScore(b) - mediaRelevanceScore(a)),
    [media],
  );
  const id = selected && media[selected] ? selected : list[0]?.id;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Play size={15} style={{ color: 'var(--rs-accent)' }} />
        <select
          value={id || ''}
          onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
          aria-label={t('nav.player')}
          className="max-w-full flex-1 rounded-md px-2 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx)' }}
        >
          {list.length === 0 && <option value="">{t('empty.none')}</option>}
          {list.map((m) => <option key={m.id} value={m.id}>{kindLabel(viewKind(m))} · {smartName(m)}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rs-line)' }}>
        {id ? (
          <Player mediaId={id} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center" style={{ color: 'var(--rs-tx-3)' }}>
            <Play size={30} />
            <div className="text-[13px]">{t('empty.none')}</div>
            <div className="text-[12px]">{t('empty.hintNone')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
