// "Copy diagnostics": everything that helps fix a bug report, as plain text to paste into an issue.
// Recent [cd-shelf] warnings and errors are kept from the start (console.warn/error are watched for
// messages that begin with "[cd-shelf]"), along with uncaught errors from this app and GPU resets.

/* global __CDS_VERSION__ */
const VERSION = typeof __CDS_VERSION__ === 'string' ? __CDS_VERSION__ : 'dev';
const MAX = 60;
// Shared by the app and the extension (two bundles, one page).
const born = (window.__cdsDiagBorn ||= Date.now());
const entries = (window.__cdsDiagLog ||= []);

const text = (a) => {
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n    ${a.stack.split('\n').slice(1, 4).join('\n    ').trim()}` : ''}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};

export function record(level, ...args) {
  entries.push({ at: Date.now(), level, msg: args.map(text).join(' ').slice(0, 600) });
  if (entries.length > MAX) entries.shift();
}

// Installed once per page (the custom app and the extension share the page).
if (!window.__cdsDiagHooked) {
  window.__cdsDiagHooked = true;
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[cd-shelf]')) record(level, ...args);
      original(...args);
    };
  }
  window.addEventListener('error', (e) => {
    if (/cd-shelf/.test(e.filename || '') || /cd-shelf/.test(e.error?.stack || '')) record('uncaught', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (/cd-shelf/.test(e.reason?.stack || '')) record('unhandled', e.reason);
  });
}

function os() {
  const ua = navigator.userAgent;
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return /Wayland/i.test(ua) ? 'Linux (Wayland)' : 'Linux';
  return ua;
}

function webgl() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'unavailable';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return `WebGL2, ${r}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

const ago = (at) => `${((at - born) / 1000).toFixed(1)}s`;

// `shelf` is the running shelf (or null), `extra` any key/values worth adding.
export function collect({ shelf, settings, quality, items, lyricsRoute, extra = {} } = {}) {
  const lines = [];
  const add = (k, v) => v !== undefined && v !== null && v !== '' && lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  lines.push('### CD Shelf diagnostics');
  add('App', VERSION);
  add('Spotify', Spicetify.Platform?.version);
  add('Spicetify', Spicetify.Config?.version);
  add('Theme / extensions', [Spicetify.Config?.current_theme, ...(Spicetify.Config?.extensions || [])].filter(Boolean).join(', '));
  add('OS', os());
  add('Language', `${navigator.language} (Spotify ${Spicetify.Platform?.Session?.locale?.getLocale?.() || Spicetify.Locale?.getLocale?.() || '?'})`);
  add('Screen', `${innerWidth}x${innerHeight} css px, devicePixelRatio ${devicePixelRatio.toFixed(2)}`);
  add('GPU', webgl());
  if (shelf) {
    try {
      const q = shelf.quality;
      add('Quality', `${quality} -> ${q.tier}, render scale ${q.scale}`);
      const p = shelf.perf();
      add('Frame', `${p.fps} fps, ${p.cpuMsPerFrame} ms cpu, ${p.calls} draw calls, ${p.triangles} triangles`);
      const d = shelf.debug();
      add('Shelf', `${d.n} discs, ${d.perRow} per row, ${d.rowCount} rows, first frame ${d.firstFrameMs} ms`);
      add('Corner', d.screen ? { kind: d.screen.kind, live: d.screen.live, timing: d.screen.timing, board: d.screen.board?.text ? 'lyrics' : 'none' } : 'off');
    } catch (e) {
      add('Shelf', `error: ${e.message}`);
    }
  } else add('Shelf', 'not running');
  add('Library', items ? `${items.length} items (${items.filter((i) => i.kind === 'album').length} albums)` : 'not loaded');
  add('Lyrics route', lyricsRoute);
  add('Settings', settings);
  for (const [k, v] of Object.entries(extra)) add(k, v);
  add('Uptime', ago(Date.now()));
  lines.push('', `Recent log (${entries.length}):`);
  if (!entries.length) lines.push('  (nothing)');
  for (const e of entries) lines.push(`  [${ago(e.at)}] ${e.level}: ${e.msg}`);
  return lines.join('\n');
}

// Copies the report; resolves true, or false when the clipboard refused (the caller shows it instead).
export async function copyDiagnostics(opts) {
  const report = collect(opts);
  try {
    await navigator.clipboard.writeText(report);
    return { ok: true, report };
  } catch {
    return { ok: false, report };
  }
}
