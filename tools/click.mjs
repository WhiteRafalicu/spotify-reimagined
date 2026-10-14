// node tools/click.mjs <cssX> <cssY> [move-only]: real mouse in CSS px (scaled by Spotify's zoom).
const [x, y, moveOnly] = process.argv.slice(2);
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
if (!moveOnly) {
  await new Promise((r) => setTimeout(r, 150));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: X, y: Y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: X, y: Y, button: 'left', clickCount: 1 });
}
process.exit(0);
