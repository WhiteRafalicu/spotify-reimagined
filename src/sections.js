// Record-store sections: pinned favourites first, then the rest grouped by the current sort (months
// for recently added, how long ago for recently played, A–Z for artist or title), each group headed
// by a divider card on the shelf (see shelf3d.js placeDividers).
import { locale, t } from './i18n';

// Fewer discs than this: no dividers, they'd only break up a short shelf.
const MIN_FOR_DIVIDERS = 16;

const letter = (s) => {
  const c = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : /\p{L}/u.test(c) ? c : '#';
};

function monthLabel(iso, years) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '…';
  if (years) return String(d.getFullYear());
  const m = new Intl.DateTimeFormat(locale(), { month: 'short' }).format(d).replace('.', '');
  return `${m[0].toUpperCase()}${m.slice(1)} ’${String(d.getFullYear()).slice(2)}`;
}

function playedLabel(iso, now) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(+d)) return t('secNotYet');
  const days = (now - d) / 864e5;
  if (days < 1 && new Date(now).toDateString() === d.toDateString()) return t('secToday');
  if (days < 7) return t('secWeek');
  if (days < 31) return t('secMonth');
  return t('secEarlier');
}

// list: already filtered and sorted. Returns { items, dividers: [{ at, label }] }.
export function sections(list, sort, { pins = [], dividers = true } = {}) {
  const pinned = pins.map((uri) => list.find((i) => i.uri === uri)).filter(Boolean);
  const pinnedSet = new Set(pinned.map((i) => i.uri));
  const rest = list.filter((i) => !pinnedSet.has(i.uri));
  const items = [...pinned, ...rest];
  const out = [];
  if (pinned.length) out.push({ at: 0, label: '★' });
  if (!dividers || list.length < MIN_FOR_DIVIDERS) return { items, dividers: out };
  const now = Date.now();
  let key;
  if (sort === 'recent') {
    const months = new Set(rest.map((i) => (i.addedAt || '').slice(0, 7)));
    const years = months.size > 18;
    key = (i) => monthLabel(i.addedAt, years);
  } else if (sort === 'played') key = (i) => playedLabel(i.playedAt, now);
  else if (sort === 'artist') key = (i) => letter(i.artist);
  else key = (i) => letter(i.name);
  let last = null;
  rest.forEach((item, k) => {
    const label = key(item);
    if (label !== last) out.push({ at: pinned.length + k, label });
    last = label;
  });
  return { items, dividers: out };
}
