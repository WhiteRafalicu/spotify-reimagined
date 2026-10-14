// node tools/emulate.mjs <deviceScaleFactor|off>: emulates a high-density screen in Spotify.
const [dsf] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data)); ws.send(JSON.stringify({ id: 1, method, params })); });
if (dsf === 'off') await send('Emulation.clearDeviceMetricsOverride');
else await send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: Number(dsf), mobile: false });
console.log('emulation', dsf);
process.exit(0);
