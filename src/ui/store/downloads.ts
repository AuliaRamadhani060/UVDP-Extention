// Store antrean unduhan (U4) — terhubung ke background lewat Port streaming.
// Menerima snapshot QUEUE penuh tiap perubahan; aksi dikirim via sendUi.
import { create } from 'zustand';
import { useEffect } from 'react';
import { browser } from '@/platform/browser';
import { sendUi } from '@/shared/messaging';
import { DOWNLOAD_PORT } from '@/shared/contract';
import type { QueueJobView, QueueSnapshot, DownloadStrategy } from '@/shared/contract';

const SPARK_MAX = 40;

interface QueueState {
  jobs: QueueJobView[];
  history: QueueJobView[];
  concurrency: number;
  connected: boolean;
  spark: Record<string, number[]>; // sampel kecepatan per-job untuk sparkline
  ingest: (snap: QueueSnapshot) => void;
  setConnected: (v: boolean) => void;
  // aksi
  download: (id: string, opts?: { strategy?: DownloadStrategy; quality?: string }) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  setConcurrency: (n: number) => void;
  subtitle: (id: string, track: number) => void;
  merge: (id: string) => void;
  saveSeparate: (id: string) => void;
}

export const useQueue = create<QueueState>((set, get) => ({
  jobs: [],
  history: [],
  concurrency: 3,
  connected: false,
  spark: {},
  ingest: (snap) => {
    const prev = get().spark;
    const next: Record<string, number[]> = {};
    for (const j of snap.jobs) {
      if (j.status === 'downloading') {
        const arr = (prev[j.id] || []).concat(Math.round(j.speed));
        next[j.id] = arr.length > SPARK_MAX ? arr.slice(arr.length - SPARK_MAX) : arr;
      }
    }
    set({ jobs: snap.jobs, history: snap.history, concurrency: snap.concurrency, spark: next });
  },
  setConnected: (connected) => set({ connected }),
  download: (id, opts) => { sendUi({ type: 'DOWNLOAD_MEDIA', payload: { id, strategy: opts?.strategy, quality: opts?.quality } }); },
  pause: (id) => { sendUi({ type: 'DOWNLOAD_PAUSE', payload: { id } }); },
  resume: (id) => { sendUi({ type: 'DOWNLOAD_RESUME', payload: { id } }); },
  cancel: (id) => { sendUi({ type: 'DOWNLOAD_CANCEL', payload: { id } }); },
  retry: (id) => { sendUi({ type: 'DOWNLOAD_RETRY', payload: { id } }); },
  remove: (id) => { sendUi({ type: 'DOWNLOAD_REMOVE', payload: { id } }); },
  reorder: (ids) => { sendUi({ type: 'DOWNLOAD_REORDER', payload: { ids } }); },
  setConcurrency: (n) => { set({ concurrency: n }); sendUi({ type: 'SET_CONCURRENCY', payload: { n } }); },
  subtitle: (id, track) => { sendUi({ type: 'DOWNLOAD_SUBTITLE', payload: { id, track } }); },
  merge: (id) => { sendUi({ type: 'DOWNLOAD_MERGE', payload: { id } }); },
  saveSeparate: (id) => { sendUi({ type: 'DOWNLOAD_SAVE_SEPARATE', payload: { id } }); },
}));

interface PortLike { onMessage: { addListener: (cb: (m: unknown) => void) => void }; onDisconnect: { addListener: (cb: () => void) => void }; disconnect: () => void }

/** Buka Port ke background & jaga tetap tersambung. Panggil sekali di root UI. */
export function useQueueBridge(): void {
  useEffect(() => {
    let port: PortLike | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        port = browser.runtime.connect({ name: DOWNLOAD_PORT }) as unknown as PortLike;
        useQueue.getState().setConnected(true);
        port.onMessage.addListener((raw: unknown) => {
          const msg = raw as QueueSnapshot;
          if (msg?.type === 'QUEUE') useQueue.getState().ingest(msg);
        });
        port.onDisconnect.addListener(() => {
          useQueue.getState().setConnected(false);
          if (!closed) { retry = setTimeout(connect, 1000); } // SW tidur → sambung ulang
        });
      } catch {
        if (!closed) retry = setTimeout(connect, 1000);
      }
    };
    connect();
    // Snapshot awal (bila Port belum sempat push).
    sendUi<QueueSnapshot>({ type: 'GET_QUEUE' }).then((s) => { if (s?.type === 'QUEUE') useQueue.getState().ingest(s); }).catch(() => {});

    return () => { closed = true; if (retry) clearTimeout(retry); try { port?.disconnect(); } catch { /* */ } };
  }, []);
}
