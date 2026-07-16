// Router pesan kontrak §7 (Blueprint §5.4c) — satu titik masuk.
// Didaftarkan top-level & sinkron saat SW start (jebakan §9).
import { browser } from '@/platform/browser';
import { isContractMessage, type ContractMessage, type Diagnostics, type DiagChain } from '@/shared/contract';
import type { MediaRegistry } from '@/core/media-registry';
import type { MediaItem } from '@/shared/types';
import { getSettings, saveSettings, type Settings } from '@/shared/store';
import { buildFfmpegCommand } from '@/core/media-utils';
import {
  enqueue, cancelJob, pauseJob, resumeJob, removeJob, retryJob, reorder,
  setConcurrency, downloadSubtitle, getSnapshot, listDownloadsCompat,
} from './download-queue';

const DIAG_KEY = 'uvpd:diag';
const EMPTY_CHAIN: DiagChain = { main: false, bridge: false, background: false, offscreen: null };

export interface RouterDeps {
  registry: MediaRegistry;
  registerCandidate: (entry: Partial<MediaItem> & { url: string }, tabId?: number) => void;
  openPlayer: (id: string) => void;
}

// --- Diagnostik (Fase 0) di storage.session → tahan SW tidur (§9) ---
export async function getDiagnostics(): Promise<Diagnostics> {
  try {
    const res = await browser.storage.session.get(DIAG_KEY);
    return (res[DIAG_KEY] as Diagnostics) || { chain: { ...EMPTY_CHAIN }, message: '', ts: 0 };
  } catch {
    return { chain: { ...EMPTY_CHAIN }, message: '', ts: 0 };
  }
}
export async function patchDiagnostics(patch: Partial<DiagChain>, message?: string): Promise<Diagnostics> {
  const cur = await getDiagnostics();
  const next: Diagnostics = { chain: { ...cur.chain, ...patch }, message: message ?? cur.message, ts: Date.now() };
  try {
    await browser.storage.session.set({ [DIAG_KEY]: next });
  } catch {
    /* abaikan */
  }
  return next;
}

export function registerRouter(deps: RouterDeps): void {
  const { registry } = deps;

  browser.runtime.onMessage.addListener((
    raw: unknown,
    sender: { tab?: { id?: number } },
    sendResponse: (r?: unknown) => void,
  ) => {
    if (!isContractMessage(raw)) return false;
    const msg = raw as ContractMessage;

    switch (msg.type) {
      // --- Diagnostik Fase 0 ---
      case 'PING_CHAIN': {
        patchDiagnostics({ main: true, bridge: true, background: true }, 'Halo dari background 👋').then((d) => {
          broadcastHello(d);
          sendResponse({ ok: true, chain: d.chain });
        });
        return true;
      }
      case 'GET_DIAGNOSTICS': {
        getDiagnostics().then(sendResponse);
        return true;
      }

      // --- Deteksi (bridge → bg) ---
      case 'MEDIA_CANDIDATE': {
        if (msg.payload?.url) deps.registerCandidate(msg.payload as Partial<MediaItem> & { url: string }, sender.tab?.id);
        return false;
      }
      case 'DOM_TRACKS_FOUND': {
        // Trek sudah menyertai kandidat di Fase 1; sinyal ini dicadangkan untuk perluasan.
        return false;
      }

      // --- UI → bg ---
      case 'GET_MEDIA_LIST': {
        const tabId = msg.payload?.tabId ?? sender.tab?.id;
        sendResponse({ entries: registry.list(tabId) });
        return true;
      }
      case 'GET_MEDIA': {
        sendResponse(registry.get(msg.payload.id));
        return true;
      }
      case 'PLAY_MEDIA': {
        deps.openPlayer(msg.payload.id);
        return false;
      }
      case 'DOWNLOAD_MEDIA': {
        const m = registry.get(msg.payload.id);
        if (m) enqueue(m, { strategy: msg.payload.strategy, quality: msg.payload.quality });
        return false;
      }
      case 'DOWNLOAD_CANCEL': {
        cancelJob(msg.payload.id);
        return false;
      }
      case 'DOWNLOAD_PAUSE': {
        pauseJob(msg.payload.id);
        return false;
      }
      case 'DOWNLOAD_RESUME': {
        resumeJob(msg.payload.id);
        return false;
      }
      case 'DOWNLOAD_REMOVE': {
        removeJob(msg.payload.id);
        return false;
      }
      case 'DOWNLOAD_REORDER': {
        reorder(msg.payload.ids);
        return false;
      }
      case 'SET_CONCURRENCY': {
        setConcurrency(msg.payload.n);
        return false;
      }
      case 'DOWNLOAD_SUBTITLE': {
        const m = registry.get(msg.payload.id);
        if (m) downloadSubtitle(m, msg.payload.track);
        return false;
      }
      case 'DOWNLOAD_RETRY': {
        retryJob(msg.payload.id);
        return false;
      }
      case 'GET_DOWNLOADS': {
        sendResponse(listDownloadsCompat());
        return true;
      }
      case 'GET_QUEUE': {
        sendResponse(getSnapshot());
        return true;
      }
      case 'COPY_FFMPEG': {
        const m = registry.get(msg.payload.id);
        sendResponse(m ? buildFfmpegCommand(m.url) : '');
        return true;
      }
      case 'GET_SETTINGS': {
        getSettings().then(sendResponse);
        return true;
      }
      case 'UPDATE_SETTINGS': {
        getSettings().then((s) => saveSettings({ ...s, ...(msg.payload as Partial<Settings>) })).then(() => sendResponse(true));
        return true;
      }
      case 'TOGGLE_SITE': {
        getSettings().then((s) => {
          const set = new Set(s.disabledHosts);
          const host = msg.payload.host.toLowerCase();
          if (msg.payload.enabled) set.delete(host);
          else set.add(host);
          return saveSettings({ ...s, disabledHosts: Array.from(set) });
        }).then(() => sendResponse(true));
        return true;
      }
      case 'NOTIFY': {
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('icons/icon-48.png'),
          title: msg.payload.title,
          message: msg.payload.message,
        });
        return false;
      }
      default:
        return false;
    }
  });
}

function broadcastHello(d: Diagnostics): void {
  browser.runtime.sendMessage({ type: 'HELLO', payload: { message: d.message, chain: d.chain } }).catch(() => {});
}
