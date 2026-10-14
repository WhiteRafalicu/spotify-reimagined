// Installs a pre-load hook that records who creates WebGL contexts and who loses them, then reloads.
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const pend = {};
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (pend[msg.id]) pend[msg.id](msg); };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__gl = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const ctx = orig.call(this, type, ...a);
    if (/webgl/.test(type)) {
      window.__gl.push({ t: performance.now() | 0, type, ok: !!ctx, w: this.width, h: this.height, stack: new Error().stack.split('\\n').slice(2, 7).join(' | ') });
      if (ctx) this.addEventListener('webglcontextlost', () => window.__gl.push({ t: performance.now() | 0, lost: true, stack: 'canvas ' + this.width + 'x' + this.height + ' ' + (this.className || this.parentElement?.className || '') }));
    }
    return ctx;
  };
` });
await send('Page.reload', { ignoreCache: false });
setTimeout(() => process.exit(0), 500);
