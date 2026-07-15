import { useEffect, useState } from 'preact/hooks';
import { browser } from '@/platform/browser';
import { sendUi } from '@/shared/messaging';
import { t } from '@/i18n';
import { sizeHuman } from '@/core/url-utils';
import { mediaKind, mediaDisplayName, mediaOrigin, mediaQualityLabel, formatDuration, mediaRelevanceScore } from '@/core/media-utils';
import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/ui/components/ThemeSwitcher';
import { Icon } from '@/ui/components/Icons';
import type { MediaItem } from '@/shared/types';
import './popup.css';

function kindOf(m: MediaItem): 'mse' | 'hls' | 'dash' | 'direct' | 'fragmented' {
  if (m.kind === 'fragmented') return 'fragmented';
  return /^blob:/i.test(m.url) ? 'mse' : mediaKind(m);
}

// Buka side panel (Chromium) atau sidebar (Firefox) dari popup (butuh gestur user).
async function openSidePanel(): Promise<void> {
  const c = chrome as unknown as { sidePanel?: { open: (o: { tabId?: number; windowId?: number }) => Promise<void> } };
  const b = browser as unknown as { sidebarAction?: { open: () => Promise<void> } };
  try {
    if (c.sidePanel?.open) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await c.sidePanel.open(tab?.id != null ? { tabId: tab.id } : { windowId: tab?.windowId as number });
    } else if (b.sidebarAction?.open) {
      await b.sidebarAction.open();
    }
    window.close();
  } catch {
    /* abaikan */
  }
}

export function Popup() {
  const [items, setItems] = useState<MediaItem[]>([]);

  useEffect(() => {
    (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const res = await sendUi<{ entries: MediaItem[] }>({ type: 'GET_MEDIA_LIST', payload: { tabId: tab?.id } });
      setItems((res?.entries || []).slice().sort((a, b) => mediaRelevanceScore(b) - mediaRelevanceScore(a)));
    })();
  }, []);

  function tokens(m: MediaItem): string[] {
    const out: string[] = [];
    const q = mediaQualityLabel(m); if (q) out.push(q);
    const d = formatDuration(m.duration); if (d) out.push(d);
    if (m.sizeBytes) out.push(sizeHuman(m.sizeBytes));
    if (m.variants?.length) out.push(t('token.qualities', { n: m.variants.length }));
    return out;
  }

  return (
    <div class="pop">
      <header class="pop__head">
        <span class="pop__logo"><Icon.film size={16} /></span>
        <div class="pop__titles">
          <div class="pop__name">{t('app.name')}</div>
          <div class="pop__count">{t('count.total', { total: items.length })}</div>
        </div>
        <button class="pbtn" title="Panel" onClick={openSidePanel}><Icon.sidebar size={15} /></button>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </header>

      {items.length === 0 ? (
        <p class="pop__empty">{t('popup.empty')}</p>
      ) : (
        <ul class="pop__list">
          {items.map((m) => {
            const kind = kindOf(m);
            return (
              <li key={m.id} class={`pcard ${m.protected ? 'is-protected' : ''}`}>
                <span class={`pcard__icon k-${kind}`}>{kind === 'hls' || kind === 'dash' ? <Icon.stream size={15} /> : <Icon.film size={15} />}</span>
                <div class="pcard__body">
                  <div class="pcard__title" title={m.url}>{m.title || mediaDisplayName(m)}</div>
                  <div class="pcard__meta">
                    <span class={`pbadge k-${kind}`}>{t(kind === 'direct' ? 'kindLabel.direct' : `kindLabel.${kind}`)}</span>
                    <span class="pmuted">{mediaOrigin(m)}</span>
                    {tokens(m).map((tok, i) => <span key={i} class="ptok">{tok}</span>)}
                  </div>
                </div>
                {m.protected ? (
                  <span class="pcard__lock"><Icon.shield size={13} /></span>
                ) : (
                  <div class="pcard__actions">
                    {kind !== 'mse' && kind !== 'fragmented' && <button class="pbtn" onClick={() => sendUi({ type: 'PLAY_MEDIA', payload: { id: m.id } })} title={t('media.play')}><Icon.play size={13} /></button>}
                    {(kind !== 'mse' || m.url.startsWith('mse://')) && <button class="pbtn pbtn--primary" onClick={() => sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id: m.id } })} title={t('media.download')}><Icon.download size={13} /></button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
