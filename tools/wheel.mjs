// node tools/wheel.mjs <cssX> <cssY> <deltaY> [times]: real mouse wheel at CSS px (scaled by zoom).
const [x, y, dy, times = '1'] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend[d.id]?.(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const dpr = (await send('Runtime.evaluate', { expression: 'devicePixelRatio', returnByValue: true })).result.result.value;
const X = Number(x), Y = Number(y); void dpr; // CDP input is in CSS px
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: X, y: Y });
for (let i = 0; i < Number(times); i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: X, y: Y, deltaX: 0, deltaY: Number(dy) });
  await new Promise((r) => setTimeout(r, 60));
}
process.exit(0);
