// Tiny CDP client: node tools/cdp.mjs eval '<js expr>' | node tools/cdp.mjs shot out.png
const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await new Promise((r) => (ws.onopen = r));
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${arg} })()`, awaitPromise: true, returnByValue: true });
  const v = r.result?.result;
  if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  else console.log(typeof v?.value === 'string' ? v.value : JSON.stringify(v?.value, null, 1));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
}
ws.close();
process.exit(0);
