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
  wall: '', // '' = the look's own wall colour, or a colour from WALLS
  glass: 'classic', // clear | classic | smoky | blue: the cases' plastic (see GLASS)
  lyrics: 'write', // write | line | karaoke: written out, whole lines, or whole lines inked in word by word
  size: 'normal', // small | normal | large | huge: how big the cases are on screen
  speed: 'normal', // slow | normal | fast: cases leaving the shelf, opening, closing and going back
  theme: 'walnut', // walnut | birch | minimal
  lang: 'auto', // auto (Spotify's language) or a code from i18n.js
};
// How much faster than normal each animation speed runs.
export const SPEEDS = { slow: 0.7, normal: 1, fast: 1.8 };
// Wall colours offered besides the look's own.
export const WALLS = ['#141414', '#2a2f3a', '#23332b', '#3a2a2a', '#3b3346', '#5a4632', '#cfc6b8', '#ece8e1'];
// Case plastic: how much of each colour (r, g, b) it absorbs per mm, so how clear and what tint.
export const GLASS = {
  clear: [0.0004, 0.0003, 0.0003],
  classic: [0.0042, 0.003, 0.0026],
  smoky: [0.12, 0.125, 0.13],
  blue: [0.2, 0.09, 0.025],
};
// Shelf size: how much taller a row is on screen than at normal.
export const SIZES = { small: 0.8, normal: 1, large: 1.3, huge: 1.7 };
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
