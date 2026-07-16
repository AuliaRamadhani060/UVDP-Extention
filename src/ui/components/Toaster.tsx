import { Toaster as Sonner } from 'sonner';

/** Notifikasi in-UI (sonner) bergaya Ruang Sinyal. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      theme="dark"
      closeButton
      toastOptions={{ style: { fontFamily: 'var(--font-body)', background: 'var(--rs-panel)', border: '1px solid var(--rs-line-2)', color: 'var(--rs-tx)' } }}
    />
  );
}
