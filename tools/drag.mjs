// node tools/drag.mjs x0 y0 x1 y1 [steps]: a real mouse drag in CSS px (press, move in steps, release).
const [x0, y0, x1, y1, steps = 20] = process.argv.slice(2).map(Number);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  pend[d.id]?.(d);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= steps; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left', buttons: 1 });
  await new Promise((r) => setTimeout(r, 20));
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
process.exit(0);
