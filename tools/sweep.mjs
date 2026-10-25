// node tools/sweep.mjs <outDir> [x0 y0 x1 y1 ms]: drags the real mouse across the page like a person
// (a frame's worth of movement every 16 ms) while recording a screencast and the shelf's per-frame
// trace (__cdShelf.profile({ trace })). Writes frames/NNNN.jpg, frames.json (timestamps) and trace.json.
import fs from 'node:fs';
const [out, ...nums] = process.argv.slice(2);
const [x0, y0, x1, y1, ms] = nums.length ? nums.map(Number) : [150, 300, 800, 330, 3000];
fs.mkdirSync(`${out}/frames`, { recursive: true });
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
const frames = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) return pend[d.id]?.(d);
  if (d.method === 'Page.screencastFrame') {
    const n = frames.length;
    fs.writeFileSync(`${out}/frames/${String(n).padStart(4, '0')}.jpg`, Buffer.from(d.params.data, 'base64'));
    frames.push(d.params.metadata.timestamp);
    send('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
await new Promise((r) => setTimeout(r, 400));
await evaluate('window.__cdShelf?.profile({ trace: true }), 1');
await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
const t0 = Date.now();
for (;;) {
  const f = Math.min(1, (Date.now() - t0) / ms);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f });
  if (f >= 1) break;
  await new Promise((r) => setTimeout(r, 16));
}
await new Promise((r) => setTimeout(r, 600));
await send('Page.stopScreencast');
const trace = await evaluate('window.__cdShelf?.profile({ trace: false }) || []');
fs.writeFileSync(`${out}/trace.json`, JSON.stringify(trace));
fs.writeFileSync(`${out}/frames.json`, JSON.stringify(frames));
console.log(`frames ${frames.length}, trace ${trace?.length}`);
process.exit(0);
