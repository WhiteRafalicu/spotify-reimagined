import { t as tr } from './i18n';
// The inside page of the booklet, drawn on a 1024² canvas, with three pages behind tabs at the foot:
// the tracklist (its layout read back to turn a click into a track index; up to 40 tracks in one or
// two columns, longer lists scroll), the liner notes, and the lyrics.

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

// The page tabs at the foot, right-aligned: [Tracks] [Notes] [Lyrics].
export const PAGES = ['tracks', 'notes', 'lyrics'];
const TAB_Y = SIZE - 60;
function tabBoxes(g) {
  g.font = `700 22px ${FONT}`;
  const boxes = [];
  let x = SIZE - MARGIN;
  for (let i = PAGES.length - 1; i >= 0; i--) {
    const w = g.measureText(tr(`page_${PAGES[i]}`)).width + 28;
    x -= w;
    boxes.unshift({ i, x, w, y: TAB_Y - 22, h: 40 });
    x -= 8;
  }
  return boxes;
}
const measurer = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
// Which tab (page index) a point on the page is on, or -1.
export function tabAt(x, y) {
  if (!measurer) return -1;
  for (const b of tabBoxes(measurer)) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b.i;
  return -1;
}
function drawTabs(g, current, hoverTab) {
  for (const b of tabBoxes(g)) {
    const on = b.i === current;
    g.fillStyle = on ? 'rgba(255,255,255,0.92)' : b.i === hoverTab ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, 20);
    g.fill();
    g.fillStyle = on ? '#111' : 'rgba(255,255,255,0.8)';
    g.textAlign = 'center';
    g.fillText(tr(`page_${PAGES[b.i]}`), b.x + b.w / 2, b.y + 28);
  }
  g.textAlign = 'left';
}
// Wraps text into lines no wider than `width`.
function lines(g, text, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function drawNotes(g, album) {
  const n = album.notes;
  let y = TOP + 30;
  const label = (k, v) => {
    if (!v) return;
    g.font = `600 20px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(k.toUpperCase(), MARGIN, y);
    g.font = `500 28px ${FONT}`;
    g.fillStyle = '#fff';
    for (const l of lines(g, v, SIZE - MARGIN * 2).slice(0, 4)) {
      y += 36;
      g.fillText(l, MARGIN, y);
    }
    y += 44;
  };
  if (!n) {
    g.font = `500 28px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(album.notesFailed ? tr('notesNone') : tr('reading'), MARGIN, y);
    return;
  }
  const total = (album.tracks || []).reduce((a, t) => a + (t.ms || 0), 0);
  const count = album.tracks ? tr(album.tracks.length === 1 ? 'bookletOne' : 'booklet', { n: album.tracks.length, min: Math.round(total / 60000) }) : '';
  if (album.kind === 'album') {
    if (n.date) {
      const d = new Date(n.date);
      const opts = n.precision === 'YEAR' ? { year: 'numeric' } : n.precision === 'MONTH' ? { year: 'numeric', month: 'long' } : { year: 'numeric', month: 'long', day: 'numeric' };
      label(tr('notesReleased'), new Intl.DateTimeFormat(undefined, opts).format(d));
    }
    label(tr('notesLabel'), n.label);
    label(tr('notesLength'), [n.discs > 1 ? tr('notesDiscs', { n: n.discs }) : '', count].filter(Boolean).join(' · '));
    if (n.artists.length > 1) label(tr('notesArtists'), n.artists.join(', '));
    // The ℗ and © lines, small, at the foot of the notes, as on the back of a booklet.
    g.font = `500 18px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    let fy = Math.max(y, BOTTOM - 150);
    for (const c of n.copyrights) {
      const mark = c.type === 'P' ? '℗' : c.type === 'C' ? '©' : '';
      for (const l of lines(g, c.text.startsWith(mark) ? c.text : `${mark} ${c.text}`, SIZE - MARGIN * 2).slice(0, 2)) {
        if (fy > BOTTOM - 40) break;
        g.fillText(l, MARGIN, fy);
        fy += 24;
      }
      fy += 6;
    }
  } else {
    label(tr('notesBy'), n.owner);
    label(tr('notesLength'), count);
    label(tr('notesAbout'), n.description);
  }
}

function drawLyrics(g, album, page) {
  const ly = page.lyrics;
  g.font = `500 28px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  if (ly === undefined) return g.fillText(tr('reading'), MARGIN, TOP + 30);
  if (!ly?.lines?.length) return g.fillText(tr('noLyrics'), MARGIN, TOP + 30);
  g.font = `600 20px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillText((page.lyricsTrack || '').toUpperCase(), MARGIN, TOP + 4);
  // As many columns and as small as it takes (down to 15 px) to fit; what's left over is cut.
  const texts = ly.lines.map((l) => (l.text && l.text !== '♪' ? l.text : '♪'));
  let size = 26;
  let cols = 1;
  for (;;) {
    const per = Math.floor((BOTTOM - TOP - 40) / (size * 1.3));
    if (texts.length <= per * cols || (cols === 2 && size <= 15)) break;
    if (cols === 1 && size <= 20) {
      cols = 2;
      size = 24;
    } else size -= 1;
  }
  const lineH = size * 1.3;
  const per = Math.floor((BOTTOM - TOP - 40) / lineH);
  const colW = (SIZE - MARGIN * 2 - 30 * (cols - 1)) / cols;
  g.textAlign = ly.rtl ? 'right' : 'left';
  texts.slice(0, per * cols).forEach((text, i) => {
    const c = Math.floor(i / per);
    const x = MARGIN + c * (colW + 30) + (ly.rtl ? colW : 0);
    const y = TOP + 40 + (i % per) * lineH;
    const now = i === page.lyricsLine;
    g.font = `${now ? 700 : 500} ${size}px ${FONT}`;
    g.fillStyle = now ? '#1ed760' : i < page.lyricsLine ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)';
    g.fillText(fit(g, text, colW), x, y);
  });
  g.textAlign = 'left';
}

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

export function drawBooklet(canvas, album, paper, pg) {
  const { hover, playing, scroll = 0, index: pageIndex = 0, hoverTab = -1 } = pg;
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

  if (pageIndex !== 0) {
    if (pageIndex === 1) drawNotes(g, album);
    else drawLyrics(g, album, pg);
    drawTabs(g, pageIndex, hoverTab);
    return;
  }
  const lay = bookletLayout(album, scroll);
  if (!album.tracks) {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = `500 28px ${FONT}`;
    g.fillText(album.tracksFailed ? tr('tracksFailed') : tr('reading'), MARGIN, TOP + 40);
    if (album.tracksFailed) g.fillText(tr('tracksFailedHint'), MARGIN, TOP + 84);
    drawTabs(g, 0, hoverTab);
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
  const foot = tr(album.tracks.length === 1 ? 'bookletOne' : 'booklet', { n: album.tracks.length, min: Math.round(total / 60000) }) + (lay.scrollable ? tr('scrollMore') : '');
  g.fillText(fit(g, foot, SIZE - MARGIN * 2 - 330), MARGIN, SIZE - 46);
  drawTabs(g, 0, hoverTab);
}
