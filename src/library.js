// Reading the library and playing from it, through the APIs Spicetify exposes on the desktop client.

import { blankCoverFor } from './cover';
import { t } from './i18n';

const toHttps = (url) => {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('spotify:image:')) return `https://i.scdn.co/image/${url.slice(14)}`;
  if (url.startsWith('spotify:mosaic:')) return `https://mosaic.scdn.co/640/${url.slice(15).split(':').join('')}`;
  return null;
};

// Album images arrive at 300 px. The case wants the 640 px print of the same image.
const large = (url) => url && url.replace('ab67616d00001e02', 'ab67616d0000b273');


// Pages of 500; onPage() after each, so a big library starts filling the shelf right away.
async function allContents(filter, onPage) {
  const L = Spicetify.Platform.LibraryAPI;
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const r = await L.getContents({ filters: [filter], limit: 500, offset, flattenTree: true });
    out.push(...r.items);
    onPage?.(out);
    if (!r.items.length || out.length >= r.totalLength) break;
  }
  return out;
}

export async function loadLibrary(onProgress) {
  const raw = { albums: [], playlists: [] };
  let pending = 0;
  const progress = () => {
    if (!onProgress || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      onProgress(toItems(raw.albums, raw.playlists));
    });
  };
  const [, , liked] = await Promise.all([
    allContents('0', (a) => ((raw.albums = a), progress())).then((a) => (raw.albums = a)),
    allContents('2', (p) => ((raw.playlists = p), progress())).then((p) => (raw.playlists = p)),
    likedItem().catch(() => null),
  ]);
  if (pending) cancelAnimationFrame(pending);
  return [...(liked ? [liked] : []), ...toItems(raw.albums, raw.playlists)];
}

// Liked Songs, as a gold box set: the collection's own context URI (so it plays like Spotify's
// Liked Songs page), a gold cover drawn here, and the account's name on the spine.
async function likedItem() {
  const first = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 1, offset: 0 });
  if (!first?.items?.length) return null;
  const user = await Spicetify.Platform.UserAPI.getUser();
  if (!user?.username) return null;
  const cover = goldCover();
  return {
    kind: 'liked',
    uri: `spotify:user:${user.username}:collection`,
    name: t('likedSongs'),
    artist: user.displayName || user.username,
    thumb: cover,
    art: cover,
  };
}

// A gold foil cover with an embossed heart.
let gold = null;
function goldCover() {
  if (gold) return gold;
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  const g = c.getContext('2d');
  const foil = g.createLinearGradient(0, 0, 640, 640);
  foil.addColorStop(0, '#f7e3a1');
  foil.addColorStop(0.28, '#c9a043');
  foil.addColorStop(0.5, '#fff1bf');
  foil.addColorStop(0.72, '#b8892f');
  foil.addColorStop(1, '#e9cd7c');
  g.fillStyle = foil;
  g.fillRect(0, 0, 640, 640);
  // Brushed-metal streaks.
  g.globalAlpha = 0.07;
  for (let y = 0; y < 640; y += 3) {
    g.fillStyle = y % 6 ? '#000' : '#fff';
    g.fillRect(0, y, 640, 1);
  }
  g.globalAlpha = 1;
  const heart = (x, y, s) => {
    g.beginPath();
    g.moveTo(x, y + s * 0.3);
    g.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.05, x - s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x + s * 0.5, y - s * 0.05, x, y, x, y + s * 0.3);
    g.closePath();
  };
  // Embossed: a dark offset below, a light one above, then the heart in deeper gold.
  for (const [dx, dy, col] of [
    [4, 6, 'rgba(90,60,10,0.45)'],
    [-3, -3, 'rgba(255,248,220,0.7)'],
  ]) {
    heart(320 + dx, 150 + dy, 300);
    g.fillStyle = col;
    g.fill();
  }
  heart(320, 150, 300);
  const deep = g.createLinearGradient(170, 150, 470, 450);
  deep.addColorStop(0, '#d8b056');
  deep.addColorStop(1, '#a87a22');
  g.fillStyle = deep;
  g.fill();
  g.fillStyle = 'rgba(70,45,5,0.85)';
  g.textAlign = 'center';
  g.font = '800 54px "SpotifyMixUI", "CircularSp", "Helvetica Neue", Arial, sans-serif';
  g.fillText(t('likedSongs').toUpperCase(), 320, 545);
  gold = c.toDataURL('image/jpeg', 0.92);
  return gold;
}

// All of Liked Songs (in pages; the API's total is unreliable), shaped like a playlist's tracks.
async function likedTracks() {
  const L = Spicetify.Platform.LibraryAPI;
  const out = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const r = await L.getTracks({ limit: 500, offset });
    const items = r?.items || [];
    out.push(...items);
    if (items.length < 500) break;
  }
  return out.map((t, at) => ({
    at,
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    ms: t.duration?.milliseconds,
  }));
}


function toItems(albums, playlists) {
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
    // A playlist can have an empty name; it's still somebody's mix.
    const name = p.name?.trim() || t('untitledMix');
    const img = toHttps(p.images?.[0]?.url) || blankCoverFor(name);
    items.push({
      kind: 'playlist',
      uri: p.uri,
      name,
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
    return { kind: 'playlist', uri, name, artist: meta.context_owner || '', thumb: art || blankCoverFor(name), art: art || blankCoverFor(name) };
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
  if (item.kind === 'liked') return likedTracks();
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
  // In pages of 5000 (a single request stops there), up to the playlist's total.
  const PA = Spicetify.Platform.PlaylistAPI;
  const all = [];
  for (let offset = 0; offset < 100000; offset += 5000) {
    const r = await PA.getContents(item.uri, { offset, limit: 5000 });
    const items = r?.items || [];
    all.push(...items);
    if (items.length < 5000 || all.length >= (r?.totalLength ?? Infinity)) break;
  }
  // Keep each track's position in the playlist: skipping non-track items would otherwise shift
  // the index the player is asked to start from.
  return all
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

// The liner notes: for an album its release, label and copyright lines; for a playlist its
// description and who made it. Null when there's nothing to say.
export async function loadNotes(item) {
  if (item.kind === 'liked') return { owner: item.artist, description: t('likedNotes') };
  if (item.kind === 'album') {
    const G = Spicetify.GraphQL;
    const r = await G.Request(G.Definitions.getAlbum, { uri: item.uri, locale: '', offset: 0, limit: 1 });
    const a = r?.data?.albumUnion;
    if (!a) return null;
    return {
      date: a.date?.isoString || null,
      precision: a.date?.precision || 'DAY',
      label: a.label || '',
      copyrights: (a.copyright?.items || []).map((c) => ({ type: c.type, text: c.text })),
      discs: a.discs?.totalCount || 1,
      artists: (a.artists?.items || []).map((x) => x.profile?.name).filter(Boolean),
    };
  }
  const m = await Spicetify.Platform.PlaylistAPI.getMetadata(item.uri);
  const strip = (h) => (h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").trim();
  return { description: strip(m?.description), owner: m?.owner?.displayName || m?.owner?.name || item.artist || '' };
}

// What plays next: the tracks you queued, then the rest of the album or playlist. Each entry keeps
// the queue's own object (ref) for skipTo.
export async function upNext(limit = 5) {
  const q = await Spicetify.Platform.PlayerAPI.getQueue();
  return [...(q?.queued || []), ...(q?.nextUp || [])]
    .filter((x) => x?.uri && !/^spotify:(delimiter|meta)/.test(x.uri))
    .slice(0, limit)
    .map((x) => ({
      name: x.name || '',
      artist: (x.artists || []).map((a) => a.name).join(', '),
      cover: toHttps(x.album?.images?.[0]?.url),
      ref: x,
    }));
}

// Jump to a track in the queue.
export function skipTo(ref) {
  return Spicetify.Platform.PlayerAPI.skipTo(ref);
}

export function nowPlaying() {
  const d = Spicetify.Player.data;
  return {
    context: d?.context?.uri || null,
    track: d?.item?.uri || null,
    playing: !!Spicetify.Player.isPlaying(),
    shuffle: !!Spicetify.Player.getShuffle?.(),
    repeat: Spicetify.Player.getRepeat?.() ?? 0, // 0 off, 1 the album or playlist, 2 the track
  };
}

// Shuffle from the case: if this album or playlist is playing, toggle shuffle; otherwise turn
// shuffle on and start it (Spotify then picks the order).
export async function shuffle(item) {
  const P = Spicetify.Player;
  if (nowPlaying().context === item.uri) return P.setShuffle(!P.getShuffle());
  P.setShuffle(true);
  return P.playUri(item.uri);
}

// Repeat, as Spotify's own button: off -> repeat all -> repeat one -> off. It's the player's setting,
// not this disc's, so it works whatever is playing.
export function cycleRepeat() {
  const P = Spicetify.Player;
  P.setRepeat(((P.getRepeat?.() ?? 0) + 1) % 3);
}

// Skip to the next track (only offered while this album or playlist is playing).
export function skip() {
  return Spicetify.Player.next();
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
  if (item.kind === 'liked') return Spicetify.Platform.History.push('/collection/tracks');
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

// GET from Spotify's internal API (spclient). Older clients route it through CosmosAsync; from
// Spotify 1.3 that answers "Resolver not found", so after the first such failure it goes straight
// to fetch() with the session's own token. Resolves the parsed JSON, or null for a 404.
let cosmosRoute = true;
// For diagnostics: which way lyrics are fetched.
export const lyricsRoute = () => (cosmosRoute ? 'CosmosAsync' : 'fetch + token');
async function spclientGet(path) {
  const url = `https://spclient.wg.spotify.com/${path}`;
  if (cosmosRoute) {
    try {
      return await Spicetify.CosmosAsync.get(url);
    } catch (e) {
      if (!/resolver not found/i.test(String(e?.message || e))) {
        if (/\b404\b/.test(String(e?.message || e))) return null;
        throw e;
      }
      cosmosRoute = false;
    }
  }
  const token = Spicetify.Platform?.AuthorizationAPI?.getState?.()?.token?.accessToken;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'app-platform': 'WebPlayer' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`spclient ${res.status}`);
  return res.json();
}

// Synced lyrics from Spotify's own lyrics service (what its Lyrics view uses). Returns
// { synced, rtl, lang, lines: [{ t: ms, text }] }, or null when the track has none. A failed
// request isn't remembered as "no lyrics", so the next try asks again.
const lyricsCache = new Map();
export async function lyricsFor(trackUri) {
  if (lyricsCache.has(trackUri)) return lyricsCache.get(trackUri);
  let out = null;
  try {
    const id = trackUri.split(':')[2];
    const r = await retry(() => spclientGet(`color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`), 2, 600);
    const ly = r?.lyrics;
    if (ly?.lines?.length) {
      out = {
        synced: ly.syncType === 'LINE_SYNCED' || ly.syncType === 'SYLLABLE_SYNCED',
        rtl: !!ly.isRtlLanguage,
        lang: ly.language || '',
        lines: ly.lines.map((l) => ({ t: Number(l.startTimeMs) || 0, text: (l.words || '').trim() })),
      };
    }
  } catch (e) {
    console.warn('[cd-shelf] lyrics', e);
    return null;
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

// Albums played recently that aren't saved, to fill a nearly empty shelf (newest first).
export async function recentAlbums(exclude, limit = 24) {
  try {
    const r = await Spicetify.Platform.PlayHistoryAPI.getContents({ limit: 100 });
    const out = [];
    const seen = new Set(exclude);
    for (const t of r?.items || []) {
      const a = t.album;
      if (!a?.uri || seen.has(a.uri)) continue;
      seen.add(a.uri);
      const img = toHttps((a.images || []).find((i) => i.width === 300)?.url || a.images?.[0]?.url);
      if (!img) continue;
      out.push({
        kind: 'album',
        uri: a.uri,
        name: a.name,
        artist: (t.artists || []).map((x) => x.name).join(', '),
        thumb: img,
        art: large(img),
        suggested: true,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn('[cd-shelf] play history', e);
    return [];
  }
}

// Retries a flaky internal call a couple of times before giving up.
export async function retry(fn, tries = 3, wait = 800) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait * (i + 1)));
    }
  }
}
