// node tools/serve-assets.mjs [port]: serves ./assets with CORS, standing in for a CDN in tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const port = Number(process.argv[2] || 8766);
const root = join(process.cwd(), 'assets');
const types = { '.glb': 'model/gltf-binary', '.ttf': 'font/ttf' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path.replace(/^\/assets/, '')));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
    console.log('200', path);
  } catch {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    console.log('404', path);
  }
}).listen(port, '127.0.0.1');
