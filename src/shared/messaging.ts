// Wrapper messaging tipe-aman antar-konteks (kontrak §7).
import { browser } from '@/platform/browser';
import type { UiMessage, BridgeMessage, BroadcastMessage } from './contract';

/** UI/player → background. Bentuk pesan dicek saat kompilasi. */
export async function sendUi<T = unknown>(msg: UiMessage): Promise<T> {
  return (await browser.runtime.sendMessage(msg)) as T;
}

/** Content bridge → background. */
export async function sendBridge(msg: BridgeMessage): Promise<void> {
  try {
    await browser.runtime.sendMessage(msg);
  } catch {
    /* tak ada penerima — abaikan */
  }
}

/** Background → semua UI aktif (broadcast). */
export async function broadcast(msg: BroadcastMessage): Promise<void> {
  try {
    await browser.runtime.sendMessage(msg);
  } catch {
    /* tak ada penerima aktif — abaikan */
  }
}
