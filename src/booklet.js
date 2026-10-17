import { t as tr } from './i18n';
// The inside page of the booklet: a tracklist drawn on a 1024² canvas, and the same layout
// read back to turn a click on the page into a track index. Up to 40 tracks fit on the page in
// one or two columns; longer tracklists become a single column that scrolls.

const SIZE = 1024;
const MARGIN = 78;
const TOP = 250;
const BOTTOM = SIZE - 86;
const MAX_ROWS = 40;
const SINGLE_COLUMN = 16;
const SCROLL_ROW = 46;
const VIEW = BOTTOM - TOP;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const hitRow = (rows) => (x, y) => {
  for (const row of rows) if (x >= row.x - 10 && x < row.x + row.w + 10 && y >= row.y && y < row.y + row.h) return row.i;
  return -1;
};

function scrollingLayout(tracks, scroll) {
  const maxScroll = Math.max(0, tracks.length * SCROLL_ROW - VIEW);
  const sc = clamp(scroll, 0, maxScroll);
  const first = Math.floor(sc / SCROLL_ROW);
  const last = Math.min(tracks.length - 1, Math.ceil((sc + VIEW) / SCROLL_ROW));
  const rows = [];
  for (let i = first; i <= last; i++)
    rows.push({ i, x: MARGIN, y: TOP + i * SCROLL_ROW - sc, w: SIZE - MARGIN * 2 - 26, h: SCROLL_ROW });
  const inRows = hitRow(rows);
  return {
    rows,
    rowH: SCROLL_ROW,
    more: 0,
    scrollable: true,
    scroll: sc,
    maxScroll,
    rowAt: (x, y) => (y < TOP || y >= BOTTOM ? -1 : inRows(x, y)),
  };
}

// The scroll that brings track i to the middle of the page (0 when the page doesn't scroll).
export function scrollToTrack(album, i) {
  const n = album.tracks?.length || 0;
  if (n <= MAX_ROWS || i < 0) return 0;
  return clamp(i * SCROLL_ROW - VIEW / 2 + SCROLL_ROW / 2, 0, Math.max(0, n * SCROLL_ROW - VIEW));
}

const FONT = '"SpotifyMixUI", "CircularSp", "Helvetica Neue", Arial, sans-serif';

export function bookletLayout(album, scroll = 0) {
  const tracks = album.tracks || [];
  if (tracks.length > MAX_ROWS) return scrollingLayout(tracks, scroll);
  const shown = Math.min(tracks.length, MAX_ROWS);
  const cols = shown > SINGLE_COLUMN ? 2 : 1;
  const perCol = Math.max(1, Math.ceil(shown / cols));
  const rowH = Math.min(50, (BOTTOM - TOP) / perCol);
  const gap = 36;
  const colW = (SIZE - MARGIN * 2 - gap * (cols - 1)) / cols;
  const rows = [];
  for (let i = 0; i < shown; i++) {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    rows.push({ i, x: MARGIN + c * (colW + gap), y: TOP + r * rowH, w: colW, h: rowH });
  }
  return { rows, rowH, more: tracks.length - shown, scrollable: false, scroll: 0, maxScroll: 0, rowAt: hitRow(rows) };
}

const fmt = (ms) => {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function fit(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + '…').width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

export function drawBooklet(canvas, album, paper, { hover, playing, scroll = 0 }) {
  const g = canvas.getContext('2d');
  const [r, gr, b] = paper;
  const dark = (k) => `rgb(${Math.round(r * k)}, ${Math.round(gr * k)}, ${Math.round(b * k)})`;

  const bg = g.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, dark(0.42));
  bg.addColorStop(1, dark(0.22));
  g.fillStyle = bg;
  g.fillRect(0, 0, SIZE, SIZE);

  // Paper grain, so the page reads as print rather than a screen.
  g.globalAlpha = 0.05;
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = i & 1 ? '#fff' : '#000';
    g.fillRect((i * 7919) % SIZE, (i * 104729) % SIZE, 2, 2);
  }
  g.globalAlpha = 1;

  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `600 22px ${FONT}`;
  g.fillText(album.kind === 'playlist' ? tr('kindPlaylist') : ({ single: tr('kindSingle'), ep: tr('kindEp'), compilation: tr('kindCompilation') }[String(album.albumType || '').toLowerCase()] || tr('kindAlbum')), MARGIN, 108);

  g.fillStyle = '#fff';
  g.font = `800 54px ${FONT}`;
  g.fillText(fit(g, album.name, SIZE - MARGIN * 2), MARGIN, 168);
  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.font = `500 30px ${FONT}`;
  g.fillText(fit(g, album.artist || '', SIZE - MARGIN * 2), MARGIN, 210);

  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(MARGIN, TOP - 18, SIZE - MARGIN * 2, 2);

  const lay = bookletLayout(album, scroll);
  if (!album.tracks) {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = `500 28px ${FONT}`;
    g.fillText(album.tracksFailed ? tr('tracksFailed') : tr('reading'), MARGIN, TOP + 40);
    if (album.tracksFailed) g.fillText(tr('tracksFailedHint'), MARGIN, TOP + 84);
    return;
  }

  const size = Math.max(17, Math.min(27, lay.rowH * 0.52));
  if (lay.scrollable) {
    g.save();
    g.beginPath();
    g.rect(0, TOP - 4, SIZE, VIEW + 8);
    g.clip();
  }
  for (const row of lay.rows) {
    const t = album.tracks[row.i];
    const isPlaying = playing && t.uri === playing;
    const mid = row.y + row.h / 2 + size * 0.36;
    if (row.i === hover) {
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.beginPath();
      g.roundRect(row.x - 12, row.y + 2, row.w + 24, row.h - 4, 8);
      g.fill();
    }
    const accent = isPlaying ? '#1ed760' : null;
    g.font = `600 ${size * 0.85}px ${FONT}`;
    g.fillStyle = accent || 'rgba(255,255,255,0.5)';
    g.textAlign = 'right';
    g.fillText(isPlaying ? '▶' : String(row.i + 1), row.x + size * 1.3, mid);
    g.textAlign = 'right';
    const time = fmt(t.ms);
    g.font = `500 ${size * 0.85}px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(time, row.x + row.w, mid);
    g.textAlign = 'left';
    const left = row.x + size * 1.9;
    const room = row.w - size * 1.9 - g.measureText(time).width - 16;
    g.font = `600 ${size}px ${FONT}`;
    g.fillStyle = accent || '#fff';
    const name = fit(g, t.name, room);
    g.fillText(name, left, mid);
    if (album.kind === 'playlist' && t.artist) {
      const used = g.measureText(name + '  ').width;
      if (used < room - 40) {
        g.font = `500 ${size * 0.85}px ${FONT}`;
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.fillText(fit(g, t.artist, room - used), left + used, mid);
      }
    }
  }
  if (lay.scrollable) {
    g.restore();
    // Rows fade out at the edges of the page, and a thin bar shows where in the list you are.
    const edge = 34;
    for (const [y0, y1] of [
      [TOP - 4, TOP - 4 + edge],
      [BOTTOM + 4, BOTTOM + 4 - edge],
    ]) {
      const fade = g.createLinearGradient(0, y0, 0, y1);
      const show = y0 < y1 ? lay.scroll > 1 : lay.scroll < lay.maxScroll - 1;
      fade.addColorStop(0, show ? dark(0.3) : 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fade;
      g.fillRect(MARGIN - 14, Math.min(y0, y1), SIZE - MARGIN * 2 + 28, edge);
    }
    const trackX = SIZE - MARGIN - 6;
    const thumb = Math.max(48, (VIEW * VIEW) / (album.tracks.length * SCROLL_ROW));
    const at = TOP + (lay.maxScroll ? lay.scroll / lay.maxScroll : 0) * (VIEW - thumb);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.roundRect(trackX, TOP, 6, VIEW, 3);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.roundRect(trackX, at, 6, thumb, 3);
    g.fill();
  }
  g.textAlign = 'left';
  g.font = `500 22px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.45)';
  const total = album.tracks.reduce((a, t) => a + (t.ms || 0), 0);
  const foot = tr('booklet', { n: album.tracks.length, min: Math.round(total / 60000) }) + (lay.scrollable ? tr('scrollMore') : '');
  g.fillText(foot, MARGIN, SIZE - 46);
}
