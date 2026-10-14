// node tools/mouse.mjs <x> <y> [key]: moves the real mouse (so :hover applies), optional key press.
const [x, y, key] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
await new Promise((r) => (ws.onopen = r));
const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(x), y: Number(y) });
if (key) {
  send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
  send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
}
await new Promise((r) => setTimeout(r, 200));
process.exit(0);
