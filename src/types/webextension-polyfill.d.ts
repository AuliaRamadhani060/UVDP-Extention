// Shim tipe: petakan modul webextension-polyfill ke namespace global `browser`
// yang disediakan @types/firefox-webext-browser, sehingga `browser.*` bertipe penuh.
declare module 'webextension-polyfill' {
  const browser: typeof globalThis.browser;
  export default browser;
}
