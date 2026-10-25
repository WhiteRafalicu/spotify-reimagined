// node tools/flaky.mjs <seconds> [failsPerUrl=2] [pattern=*i.scdn.co/image/*]: makes the cover CDN
// flaky. The first N requests for each matching URL fail with a network error; later ones go
// through. For testing cover retries. Prints a line per failed/passed request.
const [secs = '30', fails = '2', pattern = '*i.scdn.co/image/*'] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const seen = new Map();
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = d.params;
  const n = (seen.get(request.url) || 0) + 1;
  seen.set(request.url, n);
  const short = request.url.split('/').pop().slice(-12);
  if (n <= Number(fails)) {
    console.log(`fail #${n} ${short}`);
    send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
  } else {
    console.log(`pass #${n} ${short}`);
    send('Fetch.continueRequest', { requestId });
  }
};
await new Promise((r) => (ws.onopen = r));
send('Fetch.enable', { patterns: [{ urlPattern: pattern }] });
setTimeout(() => {
  send('Fetch.disable');
  setTimeout(() => process.exit(0), 200);
}, Number(secs) * 1000);
