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
  await Promise.all([
    allContents('0', (a) => ((raw.albums = a), progress())).then((a) => (raw.albums = a)),
    allContents('2', (p) => ((raw.playlists = p), progress())).then((p) => (raw.playlists = p)),
  ]);
  if (pending) cancelAnimationFrame(pending);
  return toItems(raw.albums, raw.playlists);
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
