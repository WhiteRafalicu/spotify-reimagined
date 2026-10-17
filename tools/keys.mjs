// node tools/keys.mjs Key1 Key2 ...: real key presses into Spotify's focused element.
const keys = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pend[d.id]?.(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32 };
for (const key of keys) {
  const k = key === 'Space' ? ' ' : key;
  const base = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] || 0 };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k === 'Enter' || k === ' ') await send('Input.dispatchKeyEvent', { type: 'char', text: k === 'Enter' ? '\r' : ' ', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await new Promise((r) => setTimeout(r, 150));
}
process.exit(0);
