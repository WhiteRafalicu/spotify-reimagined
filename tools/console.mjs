// node tools/console.mjs <seconds>: prints the page's console messages and uncaught exceptions.
const secs = Number(process.argv[2] || 10);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Runtime.consoleAPICalled') {
    const text = d.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    console.log(`[${d.params.type}] ${text}`.slice(0, 600));
  } else if (d.method === 'Runtime.exceptionThrown') {
    const e = d.params.exceptionDetails;
    console.log(`[exception] ${e.exception?.description || e.text}`.slice(0, 1200));
  }
};
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
setTimeout(() => process.exit(0), secs * 1000);
