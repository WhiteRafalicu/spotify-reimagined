// node tools/smoke.mjs [--json]: after a Spotify (or Spicetify) update, checks every Spotify and
// Spicetify API the shelf relies on, against the running client (Spotify started with
// --remote-debugging-port=9222 and the shelf installed). Read-only: nothing is played, saved or
// changed. Prints PASS / WARN / FAIL per check; exits 1 if anything failed.
const asJson = process.argv.includes('--json');
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
if (!page) {
  console.error('No Spotify page on :9222 (start Spotify with --remote-debugging-port=9222).');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  pend[d.id]?.(d);
};
await new Promise((r) => (ws.onopen = r));
const run = (fn) =>
  new Promise((resolve) => {
    const i = ++id;
    pend[i] = (d) => {
      const r = d.result;
      if (r?.exceptionDetails) resolve({ ok: false, detail: r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text });
      else resolve(r?.result?.value ?? { ok: false, detail: 'no result' });
    };
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(${fn})()`, awaitPromise: true, returnByValue: true } }));
  });

// Each check runs in the page and returns { ok: true | false | 'warn', detail }.
const CHECKS = [
  ['Spicetify is loaded', async () => ({ ok: typeof Spicetify === 'object' && !!Spicetify.Player, detail: `Spicetify ${Spicetify.Config?.version}, Spotify ${Spicetify.Platform?.version}` })],
  [
    'React, ReactDOM and History',
    async () => ({ ok: !!(Spicetify.React?.createElement && Spicetify.ReactDOM?.createPortal && Spicetify.Platform?.History?.push), detail: '' }),
  ],
  [
    'The shelf is running',
    async () => {
      const t0 = performance.now();
      // Opens the shelf if it isn't showing, and goes back to where you were afterwards.
      const H = Spicetify.Platform.History;
      const back = !window.__cdShelf ? H.location?.pathname : null;
      if (back) H.push('/cd-shelf');
      while (!window.__cdShelf && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
      const s = window.__cdShelf;
      if (!s) return { ok: false, detail: document.querySelector('.cds-root')?.textContent?.slice(0, 160) || 'no shelf after 20 s' };
      await new Promise((r) => setTimeout(r, 1500));
      const d = s.debug();
      if (back) H.push(back);
      return { ok: d.n > 0 ? true : 'warn', detail: `${d.n} discs, ${d.rowCount} rows, quality ${s.quality.tier} on ${s.quality.gpu}` };
    },
  ],
  [
    'WebGL2',
    async () => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return { ok: !!gl, detail: gl ? gl.getParameter(gl.VERSION) : 'unavailable (see Troubleshooting in the README)' };
    },
  ],
  [
    'Library: albums and playlists',
    async () => {
      const L = Spicetify.Platform.LibraryAPI;
      const a = await L.getContents({ filters: ['0'], limit: 5, offset: 0 });
      const p = await L.getContents({ filters: ['2'], limit: 5, offset: 0, flattenTree: true });
      const al = a.items?.[0];
      const fields = al ? ['uri', 'name', 'images', 'addedAt', 'albumType'].filter((k) => !(k in al)) : [];
      return { ok: fields.length ? 'warn' : !!(a.items && p.items), detail: `${a.totalLength} albums, ${p.totalLength} playlists${fields.length ? `; album items lack ${fields}` : ''}` };
    },
  ],
  ['Library change events', async () => ({ ok: typeof Spicetify.Platform.LibraryAPI.getEvents === 'function' ? true : 'warn', detail: 'LibraryAPI.getEvents (live updates when saving albums)' })],
  [
    'Album tracks (GraphQL queryAlbumTracks)',
    async () => {
      const L = Spicetify.Platform.LibraryAPI;
      const a = (await L.getContents({ filters: ['0'], limit: 1, offset: 0 })).items?.[0];
      if (!a) return { ok: 'warn', detail: 'no saved album to try' };
      const G = Spicetify.GraphQL;
      const r = await G.Request(G.Definitions.queryAlbumTracks, { uri: a.uri, offset: 0, limit: 5 });
      const n = r?.data?.albumUnion?.tracksV2?.items?.length || 0;
      return { ok: n > 0, detail: `${n} tracks of "${a.name}"` };
    },
  ],
  [
    'Liner notes (GraphQL getAlbum)',
    async () => {
      const a = (await Spicetify.Platform.LibraryAPI.getContents({ filters: ['0'], limit: 1, offset: 0 })).items?.[0];
      if (!a) return { ok: 'warn', detail: 'no saved album to try' };
      const G = Spicetify.GraphQL;
      const r = await G.Request(G.Definitions.getAlbum, { uri: a.uri, locale: '', offset: 0, limit: 1 });
      const u = r?.data?.albumUnion;
      return { ok: u?.date ? true : 'warn', detail: u ? `released ${u.date?.isoString?.slice(0, 10)}, label ${u.label ? 'yes' : 'none'}, ${u.copyright?.items?.length || 0} copyright lines` : 'no album data' };
    },
  ],
  [
    'Playlists (PlaylistAPI)',
    async () => {
      const p = (await Spicetify.Platform.LibraryAPI.getContents({ filters: ['2'], limit: 1, offset: 0, flattenTree: true })).items?.find((x) => x.type === 'playlist');
      if (!p) return { ok: 'warn', detail: 'no saved playlist to try' };
      const c = await Spicetify.Platform.PlaylistAPI.getContents(p.uri, { limit: 5 });
      const m = await Spicetify.Platform.PlaylistAPI.getMetadata(p.uri);
      return { ok: !!(c?.items && m), detail: `${c?.items?.length} items, metadata ${m ? 'ok' : 'missing'}` };
    },
  ],
  ['Play history (PlayHistoryAPI)', async () => ({ ok: typeof Spicetify.Platform.PlayHistoryAPI?.getContents === 'function' ? true : 'warn', detail: 'tops up small shelves' })],
  [
    'Lyrics (spclient color-lyrics)',
    async () => {
      const token = Spicetify.Platform?.AuthorizationAPI?.getState?.()?.token?.accessToken;
      // A well-known track with synced lyrics (The Weeknd, Blinding Lights).
      const url = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/0VjIjW4GlUZAMYd2vXMi3b?format=json&vocalRemoval=false&market=from_token';
      let route = 'CosmosAsync';
      let ly = null;
      try {
        ly = (await Spicetify.CosmosAsync.get(url))?.lyrics;
      } catch (e) {
        route = `fetch + token (CosmosAsync: ${String(e?.message || e).slice(-40)})`;
        const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'app-platform': 'WebPlayer' } });
        if (r.status !== 200) return { ok: r.status === 404 ? 'warn' : false, detail: `HTTP ${r.status} via ${route}` };
        ly = (await r.json())?.lyrics;
      }
      return { ok: ly?.lines?.length > 0, detail: `${ly?.lines?.length || 0} lines, ${ly?.syncType}, via ${route}` };
    },
  ],
  ['Canvas videos (GraphQL canvas)', async () => ({ ok: Spicetify.GraphQL?.Definitions?.canvas ? true : 'warn', detail: 'the TV mirrors Canvas videos' })],
  [
    'Covers (i.scdn.co)',
    async () => {
      const a = (await Spicetify.Platform.LibraryAPI.getContents({ filters: ['0'], limit: 1, offset: 0 })).items?.[0];
      const u = a?.images?.[0]?.url?.replace('spotify:image:', 'https://i.scdn.co/image/');
      if (!u) return { ok: 'warn', detail: 'no cover to try' };
      const r = await fetch(u);
      return { ok: r.ok, detail: `HTTP ${r.status}, ${r.headers.get('content-type')}` };
    },
  ],
  [
    'Player API surface (not called)',
    async () => {
      const P = Spicetify.Player;
      const need = ['playUri', 'togglePlay', 'play', 'pause', 'next', 'back', 'seek', 'getProgress', 'getDuration', 'getVolume', 'setVolume', 'isPlaying', 'addEventListener', 'removeEventListener'];
      const missing = need.filter((k) => typeof P[k] !== 'function');
      const ctx = Spicetify.Platform?.PlayerAPI?._contextPlayer ?? P.origin?._contextPlayer;
      const clock = typeof ctx?.getPositionState === 'function';
      return { ok: missing.length ? false : clock ? true : 'warn', detail: missing.length ? `missing ${missing}` : clock ? 'all present, position clock ok' : 'present; no _contextPlayer.getPositionState (lyrics timing falls back)' };
    },
  ],
  ['Account name (UserAPI)', async () => ({ ok: typeof Spicetify.Platform?.UserAPI?.getUser === 'function' ? true : 'warn', detail: 'shelfie caption' })],
  [
    'Player bar disc and sidebar (extension)',
    async () => {
      const b = document.body.className;
      return { ok: /cds-/.test(b) ? true : 'warn', detail: `body classes: ${b.split(' ').filter((c) => c.startsWith('cds-')).join(' ') || 'none (extension not loaded, or options off)'}` };
    },
  ],
  [
    'No new shelf errors',
    async () => {
      const log = (window.__cdsDiagLog || []).filter((e) => e.level !== 'warn');
      return { ok: log.length ? 'warn' : true, detail: log.length ? log.slice(-3).map((e) => e.msg.slice(0, 120)).join(' | ') : 'diagnostics log clean' };
    },
  ],
];

const results = [];
for (const [name, fn] of CHECKS) {
  const t0 = Date.now();
  const r = await run(fn.toString());
  results.push({ name, ok: r.ok, detail: r.detail || '', ms: Date.now() - t0 });
}
ws.close();
if (asJson) console.log(JSON.stringify(results, null, 1));
else {
  const tag = (ok) => (ok === true ? '\x1b[32mPASS\x1b[0m' : ok === 'warn' ? '\x1b[33mWARN\x1b[0m' : '\x1b[31mFAIL\x1b[0m');
  for (const r of results) console.log(`${tag(r.ok)}  ${r.name.padEnd(42)} ${r.detail}`);
  const failed = results.filter((r) => r.ok !== true && r.ok !== 'warn').length;
  const warned = results.filter((r) => r.ok === 'warn').length;
  console.log(`\n${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
}
process.exit(results.some((r) => r.ok !== true && r.ok !== 'warn') ? 1 : 0);
