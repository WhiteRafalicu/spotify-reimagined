// Settings shared by the shelf page and the extension (separate bundles, same page): kept in
// localStorage, and announced with a window event so both apply changes live.
export const DEFAULTS = {
  home: true, // the shelf replaces Spotify's Home
  hideSidebar: true, // hide the Your Library sidebar
  discCover: true, // the player bar's cover is a spinning CD
  tvCorner: true, // the TV corner under the shelf
  dust: true, // dust drifting in the light
  sway: true, // the camera and the open case drift and lean toward the pointer
  cursorLight: true, // a lamp follows the pointer across the shelf
  glints: true, // star glints on bright highlights of the open case
  theme: 'walnut', // walnut | birch | minimal
  lang: 'auto', // auto (Spotify's language) or a code from i18n.js
};
const KEY = 'cd-shelf:settings';
const EVENT = 'cd-shelf:settings';

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}
export function onSettings(fn) {
  const h = (e) => fn({ ...DEFAULTS, ...e.detail });
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
