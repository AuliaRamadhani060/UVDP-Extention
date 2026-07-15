// Abstraksi lintas-browser. webextension-polyfill menyediakan `browser.*`
// berbasis Promise di Chromium sekaligus Firefox, jadi kode aplikasi tidak
// perlu bercabang antara `chrome.*` (callback) dan `browser.*` (promise).
import Browser from 'webextension-polyfill';

export const browser = Browser;
export default Browser;
