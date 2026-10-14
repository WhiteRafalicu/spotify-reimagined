// node tools/cpuprof.mjs <seconds>: reloads Spotify's page, opens the shelf, profiles the main thread
// and prints the functions with the most self time (by source file).
const secs = Number(process.argv[2] || 6);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend[d.id]?.(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 200 });
await send('Page.reload');
await new Promise((r) => setTimeout(r, 7000));
await send('Profiler.start');
await send('Runtime.evaluate', { expression: 'Spicetify.Platform.History.push("/cd-shelf")' });
await new Promise((r) => setTimeout(r, secs * 1000));
const { result } = await send('Profiler.stop');
const p = result.profile;
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
p.samples.forEach((sid, i) => self.set(sid, (self.get(sid) || 0) + (dt[i] || 0)));
const agg = new Map();
for (const [nid, us] of self) {
  const n = byId.get(nid);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} @ ${(f.url.split('/').pop() || f.url).slice(0, 40)}:${f.lineNumber}`;
  agg.set(key, (agg.get(key) || 0) + us);
}
const rows = [...agg].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 22);
for (const [k, us] of rows) console.log((us / 1000).toFixed(1).padStart(8) + ' ms  ' + k);
console.log('(program)', ((agg.get('(program) @ :-1') || 0) / 1000).toFixed(0), 'ms; (garbage collector)', ((agg.get('(garbage collector) @ :-1') || 0) / 1000).toFixed(0), 'ms');
process.exit(0);
