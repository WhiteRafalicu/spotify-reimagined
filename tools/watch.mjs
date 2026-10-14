// node tools/watch.mjs '<js to run>' <seconds> : runs JS, then prints console + exceptions for N seconds.
const [code, secs = '6'] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (/cd-shelf|THREE|shader/i.test(text) && !/Liquid/.test(text)) console.log(`[${msg.params.type}]`, text.slice(0, 1500));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', msg.params.exceptionDetails.exception?.description?.slice(0, 1500));
  } else if (msg.method === 'Log.entryAdded') {
    if (!/404/.test(msg.params.entry.text)) console.log('[log]', msg.params.entry.level, msg.params.entry.text.slice(0, 600));
  } else if (msg.id === 3) console.log('[eval]', JSON.stringify(msg.result?.result?.value ?? msg.result?.exceptionDetails?.exception?.description));
};
await new Promise((r) => (ws.onopen = r));
send('Runtime.enable');
send('Log.enable');
send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
setTimeout(() => process.exit(0), Number(secs) * 1000);
