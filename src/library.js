// Reading the library and playing from it, through the APIs Spicetify exposes on the desktop client.

const toHttps = (url) => {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('spotify:image:')) return `https://i.scdn.co/image/${url.slice(14)}`;
  if (url.startsWith('spotify:mosaic:')) return `https://mosaic.scdn.co/640/${url.slice(15).split(':').join('')}`;
  return null;
};

// Album images arrive at 300 px. The case wants the 640 px print of the same image.
const large = (url) => url && url.replace('ab67616d00001e02', 'ab67616d0000b273');

// A blank CD-R for playlists without a cover: the name written on in marker.
function blankCover(name) {
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

async function allContents(filter) {
  const L = Spicetify.Platform.LibraryAPI;
  const out = [];
  for (let offset = 0; ; offset += 50) {
    const r = await L.getContents({ filters: [filter], limit: 50, offset, flattenTree: true });
    out.push(...r.items);
    if (!r.items.length || out.length >= r.totalLength) break;
  }
  return out;
}

export async function loadLibrary() {
  const [albums, playlists] = await Promise.all([allContents('0'), allContents('2')]);
  const items = [];
  for (const a of albums) {
    if (a.type !== 'album') continue;
    const img = toHttps(a.images?.[0]?.url);
    items.push({
      kind: 'album',
      uri: a.uri,
      name: a.name,
      artist: (a.artists || []).map((x) => x.name).join(', '),
      albumType: a.albumType,
      thumb: img,
      art: large(img),
      addedAt: a.addedAt,
      playedAt: a.lastPlayedAt,
    });
  }
  for (const p of playlists) {
    if (p.type !== 'playlist') continue;
    const img = toHttps(p.images?.[0]?.url) || blankCover(p.name);
    items.push({
      kind: 'playlist',
      uri: p.uri,
      name: p.name,
      artist: p.owner?.name || '',
      thumb: img,
      art: img,
      blank: !p.images?.length,
      addedAt: p.addedAt,
      playedAt: p.lastPlayedAt,
    });
  }
  return items;
}

// A case for whatever is playing when it isn't on the shelf: the playlist from the player's
// context, or the album of the current track.
export function itemFromPlayer(uri) {
  const d = Spicetify.Player.data;
  const t = d?.item;
  const meta = d?.context?.metadata || {};
  if (uri.startsWith('spotify:playlist:') && d?.context?.uri === uri) {
    const art = meta.image_url ? toHttps(`spotify:image:${meta.image_url}`) : null;
    const name = meta.context_description || 'Playlist';
    return { kind: 'playlist', uri, name, artist: meta.context_owner || '', thumb: art || blankCover(name), art: art || blankCover(name) };
  }
  const album = t?.album;
  if (!album) return null;
  const img = toHttps((album.images || []).find((i) => i.label === 'large')?.url || album.images?.[0]?.url);
  return {
    kind: 'album',
    uri: album.uri,
    name: album.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    thumb: img,
    art: large(img),
  };
}

export async function loadTracks(item) {
  if (item.kind === 'album') {
    const G = Spicetify.GraphQL;
    const r = await G.Request(G.Definitions.queryAlbumTracks, { uri: item.uri, offset: 0, limit: 300 });
    return (r?.data?.albumUnion?.tracksV2?.items || []).map(({ track: t }) => ({
      uri: t.uri,
      name: t.name,
      artist: (t.artists?.items || []).map((a) => a.profile?.name).join(', '),
      ms: t.duration?.totalMilliseconds,
    }));
  }
  const r = await Spicetify.Platform.PlaylistAPI.getContents(item.uri, { limit: 5000 });
  // Keep each track's position in the playlist: skipping non-track items would otherwise shift
  // the index the player is asked to start from.
  return (r?.items || [])
    .map((t, at) => ({ t, at }))
    .filter(({ t }) => t.type === 'track' || t.type === 'episode')
    .map(({ t, at }) => ({
      at,
      uri: t.uri,
      name: t.name,
      artist: (t.artists || []).map((a) => a.name).join(', '),
      ms: t.duration?.milliseconds,
    }));
}

export function nowPlaying() {
  const d = Spicetify.Player.data;
  return {
    context: d?.context?.uri || null,
    track: d?.item?.uri || null,
    playing: !!Spicetify.Player.isPlaying(),
  };
}

export function playFrom(item, index) {
  const t = item.tracks?.[index];
  return Spicetify.Player.playUri(item.uri, {}, { skipTo: { index: t?.at ?? index, uri: t?.uri } });
}

export function playOrPause(item) {
  const now = nowPlaying();
  if (now.context === item.uri) return Spicetify.Player.togglePlay();
  return Spicetify.Player.playUri(item.uri);
}

export function openPage(item) {
  const [, type, id] = item.uri.split(':');
  Spicetify.Platform.History.push(`/${type}/${id}`);
}

// What the TV needs about the current track.
export function nowTrack() {
  const d = Spicetify.Player.data;
  const t = d?.item;
  if (!t) return null;
  const img = toHttps((t.album?.images || []).find((i) => i.label === 'xlarge' || i.label === 'large')?.url || t.album?.images?.[0]?.url);
  let playing = false;
  try {
    playing = !!Spicetify.Player.isPlaying();
  } catch {}
  return {
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    art: large(img),
    duration: t.duration?.milliseconds || 0,
    playing,
  };
}

// The track's Spotify Canvas (its short looping video), downloaded as a same-origin blob URL so
// WebGL may use it as a texture. Null when the track has none (most tracks don't).
const canvasCache = new Map();
// Canvas files are H.264 MP4, which Spotify's own Chromium (as of 1.2.96) can't decode: Spotify
// plays them through a native video surface instead. Only fetch them where they'd actually play.
const playsH264 = (() => {
  try {
    return document.createElement('video').canPlayType('video/mp4; codecs="avc1.4D401F"') !== '';
  } catch {
    return false;
  }
})();

export async function canvasFor(trackUri) {
  if (!playsH264) return null;
  if (canvasCache.has(trackUri)) return canvasCache.get(trackUri);
  const G = Spicetify.GraphQL;
  let url = null;
  try {
    const r = await G.Request(G.Definitions.canvas, { trackUri });
    const c = r?.data?.trackUnion?.canvas;
    if (c?.url && /video/i.test(c.type || '') && c.url.startsWith('https://')) {
      const res = await fetch(c.url);
      if (res.ok) url = URL.createObjectURL(await res.blob());
    }
  } catch (e) {
    console.warn('[cd-shelf] canvas', e);
  }
  // Keep only a handful of videos around.
  if (canvasCache.size > 6) {
    const [oldest, old] = canvasCache.entries().next().value;
    if (old) URL.revokeObjectURL(old);
    canvasCache.delete(oldest);
  }
  canvasCache.set(trackUri, url);
  return url;
}

// Synced lyrics from Spotify's own lyrics service (what its Lyrics view uses). Returns
// { synced, lines: [{ t: ms, text }] } or null when the track has none.
const lyricsCache = new Map();
export async function lyricsFor(trackUri) {
  if (lyricsCache.has(trackUri)) return lyricsCache.get(trackUri);
  let out = null;
  try {
    const id = trackUri.split(':')[2];
    const r = await Spicetify.CosmosAsync.get(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`,
    );
    const ly = r?.lyrics;
    if (ly?.lines?.length) {
      out = {
        synced: ly.syncType === 'LINE_SYNCED',
        lines: ly.lines.map((l) => ({ t: Number(l.startTimeMs) || 0, text: (l.words || '').trim() })),
      };
    }
  } catch {
    // 404 means the track simply has no lyrics.
  }
  if (lyricsCache.size > 30) lyricsCache.delete(lyricsCache.keys().next().value);
  lyricsCache.set(trackUri, out);
  return out;
}

// A playback clock that matches what you hear. Spicetify.Player.getProgress() is an estimate
// that runs a few hundred ms ahead of the audio, so (like Liquid Lyrics) this polls the player's
// native position, timestamps it when the value changes, extrapolates from there, and eases the
// shown time toward it so it never jumps.
export function createPlayerClock() {
  const player = () => Spicetify.Platform?.PlayerAPI?._contextPlayer ?? Spicetify.Player?.origin?._contextPlayer;
  const track = () => Spicetify.Player.data?.item?.uri || '';
  const playing = () => {
    try {
      return !!Spicetify.Player.isPlaying();
    } catch {
      return false;
    }
  };
  let native = null; // { pos, at, track }
  let shown = null; // { pos, at, track }
  let polling = false;
  let polledAt = 0;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const t0 = performance.now();
      const st = await player()?.getPositionState?.({});
      const t1 = performance.now();
      const pos = Number(st?.position);
      const id = track();
      if (Number.isFinite(pos) && pos >= 0 && (!native || pos !== native.pos || native.track !== id)) native = { pos, at: (t0 + t1) / 2, track: id };
    } catch {}
    polling = false;
  }
  return function now() {
    const t = performance.now();
    if (t - polledAt > 100) {
      polledAt = t;
      poll();
    }
    const id = track();
    const going = playing();
    let estimate;
    if (native && native.track === id && t - native.at < 2500) estimate = native.pos + (going ? t - native.at : 0);
    else {
      let p = 0;
      try {
        p = Spicetify.Player.getProgress();
      } catch {}
      estimate = Math.max(0, p - 300);
    }
    if (!shown || shown.track !== id) shown = { pos: estimate, at: t, track: id };
    else {
      const predicted = shown.pos + (going ? t - shown.at : 0);
      const gap = estimate - predicted;
      const step = Math.min(120, t - shown.at);
      shown = { pos: Math.abs(gap) > 900 ? estimate : predicted + gap * (1 - Math.exp(-step / 320)), at: t, track: id };
    }
    return shown.pos;
  };
}
