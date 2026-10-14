// A whiteboard on the wall of the TV corner, with the current song's lyrics in marker, kept in
// time with the music: the current line is written on as it starts, past lines fade to an erased
// smudge, and the next line waits underneath in red.
import * as THREE from 'three';

const CANVAS = [1024, 768]; // the board's 4:3 writing surface
const MARKER = '"CDS Permanent Marker", "Permanent Marker", "Comic Sans MS", cursive';
const INK = { black: '#1d1d1f' }; // one black marker; the next line is just lighter
// A line is written out across most of the time it's sung (until the next line starts), but no
// slower than this per character, so a line followed by a long pause doesn't crawl.
const WRITE_SHARE = 0.85;
const MS_PER_CHAR_MAX = 110;

function wrap(g, text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Shrinks the font until the text fits in `maxLines` lines.
function fitText(g, text, width, size, maxLines, min = 30) {
  for (let s = size; s >= min; s -= 4) {
    g.font = `${s}px ${MARKER}`;
    const lines = wrap(g, text, width);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  g.font = `${min}px ${MARKER}`;
  return { size: min, lines: wrap(g, text, width).slice(0, maxLines) };
}

export function createWhiteboard({ own, loader, asset, font, lyricsFor, getProgress, onReady }) {
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
  const state = { track: null, info: null, lyrics: undefined, key: '', fontReady: false, size: new THREE.Vector3(480, 360, 28) };

  // The marker font, loaded from the bundle under our own name so it can't clash.
  if (font) {
    const face = new FontFace('CDS Permanent Marker', `url(${font})`);
    face
      .load()
      .then((f) => {
        document.fonts.add(f);
        state.fontReady = true;
        state.key = '';
      })
      .catch(() => (state.fontReady = true));
  } else state.fontReady = true;

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

  function setTrack(info) {
    if (!info || info.uri === state.track) return;
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
      g.font = `52px ${MARKER}`;
      g.fillText(state.lyrics === undefined ? 'listening…' : 'no lyrics for this one', 60, H / 2 + 10);
      g.font = `140px ${MARKER}`;
      g.fillStyle = INK.black;
      g.globalAlpha = 0.6;
      g.fillText('♫', W - 220, H - 120);
      g.globalAlpha = 1;
      return;
    }
    const lines = ly.lines;
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
      const prev = fitText(g, text(at.i - 1), W - 140, 44, 2, 28);
      prev.lines.forEach((l, k) => g.fillText(l, 64 + k * 6, 170 + k * prev.size * 1.05));
      g.restore();
    }
    // The current line, being written out. Everything stays in the top part of the board: the PS2
    // and its controller stand in front of the bottom.
    const cur = text(at.i);
    let below = 330;
    if (cur) {
      const fit = fitText(g, cur, W - 130, 76, 3, 40);
      const total = fit.lines.reduce((a, l) => a + l.length, 0);
      let left = Math.ceil(total * reveal);
      g.fillStyle = INK.black;
      const top = 290 - ((fit.lines.length - 1) * fit.size) / 3;
      below = top + (fit.lines.length - 1) * fit.size * 1.12 + fit.size * 0.95;
      fit.lines.forEach((l, k) => {
        const part = l.slice(0, Math.max(0, left));
        left -= l.length;
        if (!part) return;
        // A slight tilt per line, the way handwriting drifts.
        g.save();
        g.translate(62, top + k * fit.size * 1.12);
        g.rotate(-0.012 + k * 0.006);
        g.fillText(part, 0, 0);
        g.restore();
      });
    } else if (at.i < 0) {
      g.fillStyle = INK.black;
      g.globalAlpha = 0.7;
      g.font = `60px ${MARKER}`;
      g.fillText('♪ …', 62, 300);
      g.globalAlpha = 1;
    }
    // What's next, waiting underneath in a lighter hand.
    const next = text(at.i + 1);
    if (next) {
      g.fillStyle = INK.black;
      g.globalAlpha = 0.42;
      const nf = fitText(g, next, W - 160, 40, 2, 26);
      const y0 = Math.min(below + 26, H * 0.66);
      nf.lines.forEach((l, k) => g.fillText(l, 66, y0 + k * nf.size * 1.05));
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
      const ms = getProgress();
      at = lineAt(ly, ms, duration);
      const chars = (ly.lines[at.i]?.text || '').length || 1;
      const span = Math.max(250, Math.min((at.next - at.start) * WRITE_SHARE, chars * MS_PER_CHAR_MAX));
      reveal = ly.synced && at.i >= 0 ? Math.min(1, Math.max(0, (ms - at.start) / span)) : 1;
      // Redraw only when the picture changes: a new line, or another letter written out.
      key = `${state.track}|${at.i}|${Math.round(reveal * chars)}`;
    } else key = `${state.track}|${ly === undefined ? 'loading' : 'none'}`;
    state.current = ly && at.i >= 0 ? { i: at.i, text: ly.lines[at.i].text, reveal: +reveal.toFixed(2) } : null;
    if (key === state.key) return;
    state.key = key;
    draw(ly, at, reveal);
    tex.needsUpdate = true;
  }

  return {
    group,
    setTrack,
    update,
    get current() {
      return state.current;
    },
    get size() {
      return state.size;
    },
  };
}
