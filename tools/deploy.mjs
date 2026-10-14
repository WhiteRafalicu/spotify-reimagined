// Dev loop: rebuild, splice the bundle into Spicetify's generated route chunk, copy to the
// CustomApps folder too (so the next `spicetify apply` keeps it), and reload Spotify's page.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

execSync('node build.mjs', { stdio: 'inherit', env: process.env });
const bundle = readFileSync('dist/index.js', 'utf8');
const route = '/opt/spotify/Apps/xpui/spicetify-routes-cd-shelf.js';
const old = readFileSync(route, 'utf8');
const start = old.search(/var cdshelf\s*=/);
const endMark = 'const render=()=>cdshelf.default();';
const end = old.lastIndexOf(endMark) + endMark.length;
if (start < 0 || end < endMark.length) throw new Error('route chunk layout changed; run spicetify apply');
writeFileSync(route, old.slice(0, start) + bundle.trimEnd() + old.slice(end));
copyFileSync('dist/extension.js', '/opt/spotify/Apps/xpui/extensions/cd-shelf/extension.js');
for (const f of ['index.js', 'extension.js', 'manifest.json'])
  copyFileSync(`dist/${f}`, `${homedir()}/.config/spicetify/CustomApps/cd-shelf/${f}`);
if (!process.argv.includes('--no-reload')) {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('xpui'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
  await new Promise((r) => setTimeout(r, 300));
  console.log('deployed + reloaded');
}
process.exit(0);
