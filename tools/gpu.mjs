const v = await (await fetch('http://localhost:9222/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const g = msg.result?.gpu;
  console.log(JSON.stringify({ status: g?.featureStatus, devices: g?.devices?.map((d) => d.deviceString || d.vendorString), cmd: msg.result?.commandLine }, null, 1));
  process.exit(0);
};
ws.send(JSON.stringify({ id: 1, method: 'SystemInfo.getInfo' }));
