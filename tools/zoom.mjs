// node tools/zoom.mjs <cssX> <cssY> <deltaY> [times]: Ctrl + mouse wheel at a point (zooms the shelf).
const [x, y, dy, times = '1'] = process.argv.slice(2).map(Number);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend[d.id]?.(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
for (let i = 0; i < times; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, modifiers: 2 });
  await new Promise((r) => setTimeout(r, 40));
}
process.exit(0);
