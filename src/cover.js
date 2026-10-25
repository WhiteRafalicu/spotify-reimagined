// Covers come from Spotify's image CDN, which now and then fails a request. Every cover load goes
// through here: a few tries per URL with a growing wait between them, then the next URL (the 640 px
// print falls back to the 300 px one), and last a blank CD-R with the name on it, so a case is never
// left empty and always opens.

// A blank CD-R for anything without a cover: the name written on in marker.
function drawBlankCover(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  const g = c.getContext('2d');
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const bg = g.createLinearGradient(0, 0, 640, 640);
  bg.addColorStop(0, `hsl(${hue} 18% 86%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 14% 74%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 640, 640);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 2;
  for (let y = 120; y < 600; y += 56) {
    g.beginPath();
    g.moveTo(60, y);
    g.lineTo(580, y);
    g.stroke();
  }
  g.fillStyle = `hsl(${hue} 70% 28%)`;
  g.font = '700 64px "Permanent Marker", "Comic Sans MS", "Segoe Print", cursive';
  g.textAlign = 'center';
  const words = name.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 500 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  lines.push(line);
  g.save();
  g.translate(320, 320 - (lines.length - 1) * 38);
  g.rotate(-0.06);
  lines.slice(0, 5).forEach((l, i) => g.fillText(l, 0, i * 76 + 20));
  g.restore();
  return c.toDataURL('image/jpeg', 0.9);
}

// Drawn once per name.
const blanks = new Map();
export function blankCoverFor(name) {
  if (!blanks.has(name)) blanks.set(name, drawBlankCover(name || ''));
  return blanks.get(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves { blob, fallback }: the first of `urls` that loads, or the blank cover (fallback: true).
// A 404 moves straight on to the next URL; network errors, timeouts, 429s and 5xx are retried.
// `within` (ms) caps the whole thing, for when someone is waiting on it.
export async function loadCover(urls, name, { tries = 3, wait = 700, within = 0 } = {}) {
  const until = within ? performance.now() + within : Infinity;
  const left = () => until - performance.now();
  for (const url of new Set(urls.filter(Boolean))) {
    for (let i = 0; i < tries && left() > 0; i++) {
      if (i) await sleep(Math.min(wait * 2 ** (i - 1), left()));
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(8000, left()))) });
        if (res.ok) return { blob: await res.blob(), fallback: false };
        if (res.status === 404 || res.status === 400) break;
      } catch {}
    }
  }
  console.warn('[cd-shelf] cover unavailable, using a blank one:', name);
  return { blob: await (await fetch(blankCoverFor(name))).blob(), fallback: true };
}
