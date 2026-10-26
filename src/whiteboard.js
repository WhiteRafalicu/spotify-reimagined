// A whiteboard on the wall of the TV corner, with the current song's lyrics in marker, kept in
// time with the music: the current line is written on as it starts, past lines fade to an erased
// smudge, and the next line waits underneath in red.
import * as THREE from 'three';
import { t as tr } from './i18n';

const CANVAS = [1024, 768]; // the board's 4:3 writing surface
const MARKER = '"CDS Permanent Marker", "Permanent Marker", "Comic Sans MS", cursive';
// For lines the marker can't write (Romanian ș, Polish ą, Vietnamese, Cyrillic, …) a second hand,
// used for the whole line so letters don't switch fonts mid-word. Scripts neither font has
// (Chinese, Japanese, Korean, Thai, Arabic, …) come from the system's fonts.
const HAND = '"CDS Pangolin", "Segoe Print", "Comic Sans MS", system-ui, sans-serif';
// What Permanent Marker has glyphs for (Basic Latin, Latin-1 and a few more), plus notes and spaces.
const MARKER_CHARS = /^[\s\u0020-\u007e\u00a0-\u00ff\u0131\u0141\u0142\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u02c6\u02c7\u02d8-\u02dd\u2013\u2014\u2018-\u201a\u201c-\u201e\u2022\u2026\u2030\u2039\u203a\u2044\u20ac\u2212\u266a\u266b]*$/;
const handFor = (text) => (MARKER_CHARS.test(text) ? MARKER : HAND);
const INK = { black: '#1d1d1f' }; // one black marker; the next line is just lighter
// A line is written out across the first part of the time it's sung (until the next line starts),
// but no slower than this per character, so it keeps up with fast singing and a line followed by a
// long pause doesn't crawl. In 'line' mode it appears whole instead.
const WRITE_SHARE = 0.6;
const MS_PER_CHAR_MAX = 70;

// Letters as you'd count them (an emoji, a Korean syllable or a Thai letter with its marks is one),
// so a line written out halfway never shows half a character.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letters = (text) => Array.from(graphemes.segment(text), (x) => x.segment);

// Where a line may break: between words, which for Chinese, Japanese and Thai (no spaces) the
// browser's word segmenter finds. Punctuation stays with the word before it.
function breakable(text) {
  const out = [];
  for (const { segment, isWordLike } of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    const glue = !isWordLike && !/^\s+$/.test(segment);
    if (out.length && (glue || /^\s+$/.test(segment))) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out;
}

function wrap(g, text, width) {
  const lines = [];
  let line = '';
  const fits = (t) => g.measureText(t.trimEnd()).width <= width;
  for (const piece of breakable(text)) {
    if (line.trim() && !fits(line + piece)) {
      lines.push(line.trim());
      line = piece.trimStart();
    } else line += piece;
    // A single word wider than the board: break it between letters.
    if (!fits(line)) {
      let part = '';
      for (const ch of letters(line)) {
        if (part && !fits(part + ch)) {
          lines.push(part.trim());
          part = '';
        }
        part += ch;
      }
      line = part;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// Karaoke without word timing (Spotify only times lines): each word gets a share of the line's
// time by how many syllables it has (vowel groups; a character each for Chinese, Japanese and
// Korean), sung at no more than SYLLABLE_MS a syllable so a line before a long break doesn't crawl.
const SYLLABLE_MS = 380;
const VOWELS = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿāăąēĕėęěīĭįōŏőœūŭůűųаеёиоуыэюяіїєαεηιουω]+/giu;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/gu;
function syllables(word) {
  const cjk = word.match(CJK)?.length || 0;
  if (cjk) return cjk;
  const v = word.match(VOWELS)?.length || 0;
  return v || Math.max(1, Math.round(letters(word.trim()).length / 3));
}
// How much of `text` (as a share of its letters) has been sung `ms` into a line lasting `span`.
export function karaokeShare(text, ms, span) {
  const words = breakable(text);
  const w = words.map((x) => (x.trim() ? syllables(x) : 0));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const sing = Math.max(300, Math.min(span * 0.92, total * SYLLABLE_MS));
  let at = (Math.max(0, ms) / sing) * total; // syllables sung so far
  const all = letters(text).length || 1;
  let done = 0;
  for (let i = 0; i < words.length; i++) {
    const n = letters(words[i]).length;
    if (at >= w[i]) {
      done += n;
      at -= w[i];
    } else {
      done += n * (w[i] ? at / w[i] : 0);
      break;
    }
  }
  return Math.min(1, done / all);
}

// Shrinks the font until the text fits in `maxLines` lines.
function fitText(g, text, width, size, maxLines, min = 30, hand = handFor(text)) {
  for (let s = size; s >= min; s -= 4) {
    g.font = `${s}px ${hand}`;
    const lines = wrap(g, text, width);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  g.font = `${min}px ${hand}`;
  return { size: min, lines: wrap(g, text, width).slice(0, maxLines) };
}

export function createWhiteboard({ own, loader, asset, font, fontAlt, lyricsFor, getProgress, onReady }) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = CANVAS;
  const g = canvas.getContext('2d');
  const tex = own(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const ink = new THREE.Mesh(
    own(new THREE.PlaneGeometry(1, 1)),
    own(
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        roughness: 0.45,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    ),
  );
  const state = { track: null, info: null, lyrics: undefined, key: '', fontReady: false, mode: 'write', size: new THREE.Vector3(480, 360, 28) };

  // The two hands, loaded from the bundle under our own names so they can't clash.
  Promise.allSettled(
    [
      ['CDS Permanent Marker', font],
      ['CDS Pangolin', fontAlt],
    ]
      .filter(([, url]) => url)
      .map(([name, url]) => new FontFace(name, `url(${url})`).load().then((f) => document.fonts.add(f))),
  ).then(() => {
    state.fontReady = true;
    state.key = '';
  });

  loader.loadAsync(asset).then((gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.updateMatrixWorld(true);
    // Scale to 48 cm wide, rest its bottom on y = 0, back against z = 0 (the wall).
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const k = 480 / size.x;
    root.scale.multiplyScalar(k);
    root.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -box.min.z * k);
    root.updateMatrixWorld(true);
    group.add(root);
    state.size.copy(size).multiplyScalar(k);
    // The ink sits just in front of the white writing surface (the mesh with the whiteboard material).
    let surface = null;
    root.traverse((o) => {
      if (o.isMesh && /whiteboard/i.test(o.material?.name || '') && !/metal/i.test(o.material?.name || '')) surface = o;
    });
    const sb = new THREE.Box3().setFromObject(surface || root);
    const ss = sb.getSize(new THREE.Vector3());
    ink.scale.set(ss.x * 0.94, ss.y * 0.93, 1);
    ink.position.set((sb.min.x + sb.max.x) / 2, (sb.min.y + sb.max.y) / 2, sb.max.z + 0.4);
    group.add(ink);
    state.key = '';
    onReady?.();
  });

  // Debug: show given lyrics at a fixed time, without playing anything (__cdShelf.previewLyrics).
  function preview(info, lyrics, ms) {
    state.track = `preview:${info.name}`;
    state.info = info;
    state.lyrics = lyrics;
    state.previewMs = ms;
    state.key = '';
  }

  function setTrack(info) {
    if (!info || info.uri === state.track) return;
    state.previewMs = undefined;
    state.track = info.uri;
    state.info = info;
    state.lyrics = undefined; // loading
    state.key = '';
    const mine = info.uri;
    lyricsFor(info.uri).then((ly) => {
      if (state.track !== mine) return;
      state.lyrics = ly;
      state.key = '';
    });
  }

  // Which line is current, from the playback position (unsynced lyrics are spread over the song).
  function lineAt(ly, ms, duration) {
    const lines = ly.lines;
    if (!ly.synced) {
      const i = duration ? Math.min(lines.length - 1, Math.floor((ms / duration) * lines.length)) : 0;
      return { i, start: duration ? (i / lines.length) * duration : 0, next: duration ? ((i + 1) / lines.length) * duration : 1e9 };
    }
    let i = -1;
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].t <= ms) i = k;
      else break;
    }
    return { i, start: i >= 0 ? lines[i].t : 0, next: i + 1 < lines.length ? lines[i + 1].t : 1e9 };
  }

  function draw(ly, at, reveal) {
    const [W, H] = CANVAS;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    g.direction = 'ltr';
    g.textAlign = 'left';
    const info = state.info;
    // Header: the song, small, in black, with a hand-drawn underline.
    if (info) {
      g.fillStyle = INK.black;
      g.globalAlpha = 0.85;
      const head = fitText(g, `♪ ${info.name}`, W - 120, 40, 1, 26);
      g.fillText(head.lines[0] || '', 60, 82);
      const hw = Math.min(W - 120, g.measureText(head.lines[0] || '').width);
      g.strokeStyle = INK.black;
      g.lineWidth = 4;
      g.beginPath();
      for (let x = 0; x <= hw; x += 12) g.lineTo(60 + x, 96 + Math.sin(x * 0.05) * 2.5);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (!ly) {
      g.fillStyle = INK.black;
      const msg = state.lyrics === undefined ? tr('listening') : tr('noLyrics');
      g.font = `52px ${handFor(msg)}`;
      g.fillText(msg, 60, H / 2 + 10);
      g.font = `140px ${MARKER}`;
      g.fillStyle = INK.black;
      g.globalAlpha = 0.6;
      g.fillText('♫', W - 220, H - 120);
      g.globalAlpha = 1;
      return;
    }
    const lines = ly.lines;
    // Right-to-left lyrics (Arabic, Hebrew, …) are written from the right edge.
    const rtl = !!ly.rtl;
    g.direction = rtl ? 'rtl' : 'ltr';
    g.textAlign = rtl ? 'right' : 'left';
    const x = (left) => (rtl ? W - left : left);
    // One hand for the whole song, so it doesn't change from line to line.
    ly.hand ??= ly.lines.every((l) => MARKER_CHARS.test(l.text)) ? MARKER : HAND;
    const text = (k) => {
      if (k < 0 || k >= lines.length) return '';
      const t = lines[k].text;
      return !t || t === '♪' ? '♪ ♪ ♪' : t;
    };
    // The line just sung, half wiped off.
    if (at.i > 0) {
      g.save();
      g.globalAlpha = 0.16;
      g.filter = 'blur(2.5px)';
      g.fillStyle = INK.black;
      const prev = fitText(g, text(at.i - 1), W - 140, 44, 2, 28, ly.hand);
      prev.lines.forEach((l, k) => g.fillText(l, x(64 + k * 6), 170 + k * prev.size * 1.05));
      g.restore();
    }
    // The current line, being written out. Everything stays in the top part of the board: the PS2
    // and its controller stand in front of the bottom.
    const cur = text(at.i);
    let below = 330;
    if (cur) {
      const fit = fitText(g, cur, W - 130, 76, 3, 40, ly.hand);
      const split = fit.lines.map(letters);
      const total = split.reduce((a, l) => a + l.length, 0);
      let left = Math.ceil(total * reveal);
      g.fillStyle = INK.black;
      const top = 290 - ((fit.lines.length - 1) * fit.size) / 3;
      below = top + (fit.lines.length - 1) * fit.size * 1.12 + fit.size * 0.95;
      // Karaoke: the whole line waits in light ink; what's been sung is written over it in black.
      if (state.mode === 'karaoke' && ly.synced) {
        g.save();
        g.globalAlpha = 0.26;
        fit.lines.forEach((l, k) => {
          g.save();
          g.translate(x(62), top + k * fit.size * 1.12);
          g.rotate((rtl ? 1 : -1) * (0.012 - k * 0.006));
          g.fillText(l, 0, 0);
          g.restore();
        });
        g.restore();
      }
      split.forEach((l, k) => {
        const part = l.slice(0, Math.max(0, left)).join('');
        left -= l.length;
        if (!part) return;
        // A slight tilt per line, the way handwriting drifts.
        g.save();
        g.translate(x(62), top + k * fit.size * 1.12);
        g.rotate((rtl ? 1 : -1) * (0.012 - k * 0.006));
        g.fillText(part, 0, 0);
        g.restore();
      });
    } else if (at.i < 0) {
      g.fillStyle = INK.black;
      g.globalAlpha = 0.7;
      g.font = `60px ${MARKER}`;
      g.fillText('♪ …', x(62), 300);
      g.globalAlpha = 1;
    }
    // What's next, waiting underneath in a lighter hand.
    const next = text(at.i + 1);
    if (next) {
      g.fillStyle = INK.black;
      g.globalAlpha = 0.42;
      const nf = fitText(g, next, W - 160, 40, 2, 26, ly.hand);
      const y0 = Math.min(below + 26, H * 0.66);
      nf.lines.forEach((l, k) => g.fillText(l, x(66), y0 + k * nf.size * 1.05));
      g.globalAlpha = 1;
    }
  }

  function update(time, inView, duration) {
    if (!inView || !state.fontReady || !ink.parent) return;
    const ly = state.lyrics;
    let key;
    let at = { i: -1, start: 0, next: 1e9 };
    let reveal = 1;
    if (ly) {
      const ms = state.previewMs ?? getProgress();
      at = lineAt(ly, ms, duration);
      const chars = letters(ly.lines[at.i]?.text || '').length || 1;
      const span = Math.max(250, Math.min((at.next - at.start) * WRITE_SHARE, chars * MS_PER_CHAR_MAX));
      if (!ly.synced || at.i < 0 || state.mode === 'line') reveal = 1;
      else if (state.mode === 'karaoke') reveal = karaokeShare(ly.lines[at.i].text || '', ms - at.start, at.next - at.start);
      else reveal = Math.min(1, Math.max(0, (ms - at.start) / span));
      // Redraw only when the picture changes: a new line, or another letter written out.
      key = `${state.track}|${at.i}|${Math.round(reveal * chars)}`;
    } else key = `${state.track}|${ly === undefined ? 'loading' : 'none'}`;
    state.current = ly && at.i >= 0 ? { i: at.i, text: ly.lines[at.i].text, reveal: +reveal.toFixed(2) } : null;
    if (key === state.key) return false;
    state.key = key;
    draw(ly, at, reveal);
    tex.needsUpdate = true;
    return true;
  }

  return {
    group,
    setTrack,
    preview,
    // 'write': each line is written out as it's sung; 'line': it appears whole; 'karaoke': whole, in
    // light ink, and inked in word by word as it's sung.
    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      state.key = '';
    },
    snapshot: () => g.canvas.toDataURL('image/png'),
    update,
    get current() {
      return state.current;
    },
    get size() {
      return state.size;
    },
  };
}
