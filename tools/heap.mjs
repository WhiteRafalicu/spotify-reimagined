// Prints the page's real JS heap use (performance.memory is rounded by Chrome).
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id === 1) {
    console.log(((d.result?.usedSize || 0) / 1e6).toFixed(0) + 'MB');
    process.exit(0);
  }
};
ws.send(JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }));
