// node tools/lyricsboard.mjs <outDir> [trackUri ...]: renders real Spotify lyrics on the whiteboard
// (through __cdShelf.previewLyrics, nothing is played) and saves the board canvas as PNGs: the
// longest line of each track fully written (<n>-full.png) and half written (<n>-half.png).
// The TV corner must be on screen (the board only redraws while it's in view).
import fs from 'node:fs';
const DEFAULT = {
  ja: 'spotify:track:6MCjmGYlw6mQVWRFVgBRvB', // 夜に駆ける — YOASOBI
  ko: 'spotify:track:2j1fFjWHCI9KJSwcuYAOyF', // Spring Day — BTS
  ru: 'spotify:track:4iRg9tHDgmRPvv56IC46Pl', // Группа крови — Kino
  ro: 'spotify:track:3wFqxEkZ9EjyBremhDs9Ej', // Visele — Irina Rimes
  zh: 'spotify:track:5pIcwtJYNJx93l420oR2Vm', // 晴天 — Jay Chou
  ar: 'spotify:track:6TYFcqqQVQPb3YsgfRhvqs', // Tamally Maak — Amr Diab
  vi: 'spotify:track:0XaY8eVU9eZO4OdIV6agx1', // Lạc Trôi — Sơn Tùng M-TP
  th: 'spotify:track:709lpRaz5QJnCaFSnvmNiU', // ความเชื่อ — Bodyslam
  en: 'spotify:track:2GYHyAoLWpkxLVa4oYTVko', // (fr) Alors on danse — Stromae
};
const [out, ...uris] = process.argv.slice(2);
const tracks = uris.length ? Object.fromEntries(uris.map((u, i) => [String(i), u])) : DEFAULT;
fs.mkdirSync(out, { recursive: true });
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend[d.id]?.(d); };
await new Promise((r) => (ws.onopen = r));
const evaluate = (expr) => new Promise((r) => { const i = ++id; pend[i] = (d) => r(d.result.result?.value ?? d.result.exceptionDetails?.exception?.description); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } })); });
for (const [tag, uri] of Object.entries(tracks)) {
  const res = await evaluate(`
    const id = ${JSON.stringify(uri)}.split(':')[2];
    const tok = Spicetify.Platform.AuthorizationAPI.getState().token.accessToken;
    const r = await fetch('https://spclient.wg.spotify.com/color-lyrics/v2/track/' + id + '?format=json&vocalRemoval=false&market=from_token', { headers: { authorization: 'Bearer ' + tok, 'app-platform': 'WebPlayer' } });
    if (!r.ok) return { err: r.status };
    const ly = (await r.json()).lyrics;
    const lyrics = { synced: true, rtl: !!ly.isRtlLanguage, lang: ly.language, lines: ly.lines.map((l) => ({ t: Number(l.startTimeMs) || 0, text: (l.words || '').trim() })) };
    let i = 0;
    lyrics.lines.forEach((l, k) => { if (k + 1 < lyrics.lines.length && l.text.length > lyrics.lines[i].text.length) i = k; });
    const t0 = lyrics.lines[i].t, t1 = lyrics.lines[i + 1]?.t ?? t0 + 4000;
    const shots = {};
    for (const [name, f] of [['half', 0.3], ['full', 0.97]]) {
      window.__cdShelf.previewLyrics({ name: ${JSON.stringify(tag)} + ' test' }, lyrics, t0 + (t1 - t0) * f);
      await new Promise((res) => setTimeout(res, 700));
      shots[name] = window.__cdShelf.boardSnapshot();
    }
    return { lang: lyrics.lang, rtl: lyrics.rtl, line: lyrics.lines[i].text, shots };`);
  if (!res || res.err || typeof res === 'string') { console.log(tag, 'error', res?.err ?? res); continue; }
  for (const [name, url] of Object.entries(res.shots)) fs.writeFileSync(`${out}/${tag}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(tag, res.lang, res.rtl ? 'rtl' : '', JSON.stringify(res.line));
}
process.exit(0);
