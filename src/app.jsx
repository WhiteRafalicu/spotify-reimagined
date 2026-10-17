// CD Shelf: your Spotify library as a rack of jewel cases. Pull one out to open it and play.
import { createShelf } from './shelf3d';
import { createStage } from './stage';
import { canvasFor, itemFromPlayer, loadLibrary, loadTracks, lyricsFor, nowPlaying, nowTrack, openPage, playFrom, playOrPause, createPlayerClock } from './library';
import assets from './assets.gen';
import css from './style.css';
import { DEFAULTS, getSettings, onSettings, setSettings } from './settings';

const { useEffect, useMemo, useRef, useState, useCallback } = Spicetify.React;

const PULL_MS = 420;

function injectStyle() {
  if (document.getElementById('cd-shelf-style')) return;
  const el = document.createElement('style');
  el.id = 'cd-shelf-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function usePlayer() {
  const [now, setNow] = useState(nowPlaying);
  useEffect(() => {
    const update = () => setNow(nowPlaying());
    Spicetify.Player.addEventListener('songchange', update);
    Spicetify.Player.addEventListener('onplaypause', update);
    return () => {
      Spicetify.Player.removeEventListener('songchange', update);
      Spicetify.Player.removeEventListener('onplaypause', update);
    };
  }, []);
  return now;
}

const SORTS = {
  recent: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
  played: (a, b) => (b.playedAt || '').localeCompare(a.playedAt || ''),
  artist: (a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
};

function Stage({ item, now, onClose, onShown }) {
  const box = useRef(null);
  const stage = useRef(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);

  // Cover Spotify's main view only, so the sidebar and the player bar stay usable.
  useEffect(() => {
    const main = document.querySelector('.Root__main-view') || document.body;
    const update = () => {
      const r = main.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const album = { ...item, tracks: null };
    const s = createStage(box.current, album, {
      getSpin: () => nowRef.current.context === item.uri && nowRef.current.playing,
      getPlaying: () => (nowRef.current.context === item.uri ? nowRef.current.track : null),
      onOpen: setOpen,
      onPick: (i) => playFrom(album, i),
      onDisc: () => playOrPause(album),
      onDismiss: onClose,
      onReady: () => {
        setReady(true);
        setTimeout(() => onShown?.(), 400);
        setTimeout(() => s?.setOpen(true), 250);
      },
      onFail: () => setFailed(true),
    });
    stage.current = s;
    loadTracks(item)
      .then((tracks) => {
        album.tracks = tracks;
        s?.refresh();
      })
      .catch((e) => {
        console.error('[cd-shelf] tracks', e);
        album.tracks = [];
        s?.refresh();
      });
    const onKey = (e) => {
      if (e.key === 'Escape') s ? s.leave() : onClose();
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        playOrPause(album);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      s?.dispose();
      stage.current = null;
    };
  }, [item.uri]);

  const live = now.context === item.uri;
  // Portalled to <body>: Spotify's view containers are transformed, which would pin a fixed
  // overlay to them instead of to the window.
  return Spicetify.ReactDOM.createPortal(
    <div className={`cds-stage${ready ? ' is-ready' : ''}`} style={rect || undefined}>
      <div className="cds-stage-gl" ref={box} />
      <div className="cds-hud">
        <button className="cds-chip" onClick={() => (stage.current ? stage.current.leave() : onClose())}>
          ← Back to the shelf
        </button>
        <button className="cds-chip" onClick={() => openPage(item)}>
          Open {item.kind}
        </button>
        <button className="cds-chip is-play" onClick={() => playOrPause(item)}>
          {live && now.playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <p className="cds-hint">
        {failed
          ? 'WebGL is unavailable, so the case could not be drawn.'
          : open
            ? 'Click a track to play it · click the disc to play or pause · drag to turn · Esc to put it back'
            : 'Click the case to open it · drag to turn · Esc to put it back'}
      </p>
    </div>,
    document.body,
  );
}

// The shelf scene and the library survive closing the page: coming back reattaches them instead of
// rebuilding everything. A parked scene is released after a while to give its memory back.
const PARK_MS = 10 * 60 * 1000;
let parked = null; // { shelf, timer }
let keptItems = null;

const TOGGLES = [
  ['home', 'Open Spotify on the shelf', 'Replaces Home. Off: Home is Spotify’s own again.'],
  ['hideSidebar', 'Hide the Your Library sidebar', 'The shelf is your library.'],
  ['discCover', 'Spinning CD in the player bar', 'Click it to open the playing album’s case.'],
  ['tvCorner', 'TV corner under the shelf', 'The TV, the console and the lyrics whiteboard.'],
  ['dust', 'Dust in the light', ''],
];

function SettingsPanel({ settings, quality, setQuality, tier, onClose }) {
  const set = (k, v) => setSettings({ [k]: v });
  return (
    <div className="cds-settings" role="dialog" aria-label="CD Shelf settings">
      <div className="cds-settings-head">
        <b>Settings</b>
        <button className="cds-chip" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>
      {TOGGLES.map(([k, label, hint]) => (
        <label key={k} className="cds-toggle">
          <input type="checkbox" checked={settings[k]} onChange={(e) => set(k, e.target.checked)} />
          <span>
            {label}
            {hint && <small>{hint}</small>}
          </span>
        </label>
      ))}
      <label className="cds-toggle">
        <span>
          Quality
          <small>Auto picks a level for your GPU{tier && quality === 'auto' ? ` (now ${tier})` : ''}.</small>
        </span>
        <select className="cds-chip" value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="auto">Auto</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <div className="cds-settings-foot">
        <button
          className="cds-chip"
          onClick={() => {
            setSettings({ home: false, hideSidebar: false, discCover: false });
            Spicetify.Platform.History.push('/', { cdsHome: true });
          }}
        >
          Back to classic Spotify
        </button>
        <button className="cds-chip" onClick={() => setSettings({ ...DEFAULTS })}>
          Reset
        </button>
      </div>
      <p className="cds-settings-note">The shelf stays one click away (its disc icon in the top bar). To remove it completely, see the README.</p>
    </div>
  );
}

function App() {
  const [items, setItemsState] = useState(() => keptItems);
  const setItems = useCallback((v) => {
    setItemsState((cur) => {
      const next = typeof v === 'function' ? v(cur) : v;
      keptItems = next;
      return next;
    });
  }, []);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [query, setQuery] = useState('');
  const [onStage, setOnStage] = useState(null);
  const [hover, setHover] = useState(null);
  const [failed, setFailed] = useState(false);
  const [host, setHost] = useState(null);
  const [notice, setNotice] = useState(null);
  const [quality, setQuality] = useState(() => {
    try {
      return localStorage.getItem('cd-shelf:quality') || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [tier, setTier] = useState(null);
  const [settings, setSettingsState] = useState(getSettings);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => onSettings(setSettingsState), []);
  // The TV corner is built with the scene, so switching it rebuilds the scene (see the mount effect).
  const cornerKey = settings.tvCorner ? 'corner' : 'nocorner';
  const arrivals = useRef(null);
  const now = usePlayer();
  const worldRef = useRef(null);
  const shelf = useRef(null);

  useEffect(() => {
    injectStyle();
    // Pages appear as they arrive, so a big library doesn't sit on an empty shelf.
    loadLibrary((partial) => setItems((cur) => (cur && cur.length >= partial.length ? cur : partial)))
      .then(setItems)
      .catch((e) => {
        console.error('[cd-shelf]', e);
        setError(String(e?.message || e));
      });
    // The 3D room fills Spotify's main view, above the page's own scroller.
    setHost(document.querySelector('.Root__main-view') || document.body);
  }, []);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => filter === 'all' || i.kind === filter)
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.artist.toLowerCase().includes(q))
      .sort(SORTS[sort]);
  }, [items, filter, sort, query]);

  const pull = useCallback((item) => {
    shelf.current?.pullOut(item.uri);
    setHover(null);
    setTimeout(() => setOnStage(item), PULL_MS);
  }, []);
  const shelve = useCallback(() => {
    setOnStage(null);
    shelf.current?.setPaused(false);
    shelf.current?.putBack();
  }, []);

  useEffect(() => {
    if (!worldRef.current) return;
    const handlers = { onPick: (item) => pull(item), onHover: setHover, onTv: () => Spicetify.Player.togglePlay() };
    let s;
    if (parked && parked.cornerKey !== cornerKey) {
      clearTimeout(parked.timer);
      parked.shelf.dispose();
      parked = null;
    }
    if (parked) {
      clearTimeout(parked.timer);
      s = parked.shelf;
      parked = null;
      s.attach(worldRef.current, handlers);
    } else {
      s = createShelf(worldRef.current, {
        ...handlers,
        canvasFor,
        lyricsFor,
        getProgress: createPlayerClock(),
        assets,
        corner: settings.tvCorner,
        dust: settings.dust,
      });
    }
    s?.setNowPlaying(nowTrack());
    s?.setQuality(quality);
    if (s) setTier(s.quality.tier);
    if (!s) setFailed(true);
    shelf.current = s;
    window.__cdShelf = s; // handy from DevTools
    return () => {
      shelf.current = null;
      if (!s) return;
      s.detach();
      const mine = { shelf: s, cornerKey, timer: setTimeout(() => (s.dispose(), parked === mine && (parked = null)), PARK_MS) };
      parked = mine;
    };
  }, [host, cornerKey]);
  useEffect(() => {
    shelf.current?.setDust(settings.dust);
  }, [settings.dust, host, cornerKey]);
  useEffect(() => {
    if (!items) return;
    shelf.current?.setItems(shown, { arrivals: arrivals.current });
    arrivals.current = null;
  }, [shown, host, cornerKey]);

  // Saving (or removing) an album or playlist anywhere in Spotify updates the shelf: new discs
  // slide in from the front, removed ones leave.
  useEffect(() => {
    const events = Spicetify.Platform.LibraryAPI?.getEvents?.();
    if (!events?.addListener) return;
    let timer = 0;
    let hide = 0;
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadLibrary()
          .then((next) => {
            const before = new Set((itemsRef.current || []).map((i) => i.uri));
            const added = next.filter((i) => !before.has(i.uri));
            arrivals.current = new Set(added.map((i) => i.uri));
            setItems(next);
            if (!added.length) return;
            setNotice(added.length === 1 ? { name: added[0].name, artist: `added to the shelf` } : { name: `${added.length} discs`, artist: 'added to the shelf' });
            clearTimeout(hide);
            hide = setTimeout(() => setNotice(null), 3500);
          })
          .catch((e) => console.error('[cd-shelf] library update', e));
      }, 400);
    };
    events.addListener('update', onUpdate);
    return () => {
      clearTimeout(timer);
      clearTimeout(hide);
      events.removeListener('update', onUpdate);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('cd-shelf:quality', quality);
    } catch {}
    if (!shelf.current) return;
    shelf.current.setQuality(quality);
    setTier(shelf.current.quality.tier);
  }, [quality, cornerKey]);
  useEffect(() => {
    shelf.current?.setLive(now.context);
  }, [now.context, shown, host, cornerKey]);
  useEffect(() => {
    shelf.current?.setNowPlaying(nowTrack());
  }, [now.track, now.playing, host, cornerKey]);

  // The player bar's disc (see extension.js) opens a case by navigating here with { cdsOpen: uri }.
  const itemsRef = useRef(null);
  itemsRef.current = items;
  const wanted = useRef(null);
  const openUri = useCallback((uri) => {
    if (!itemsRef.current) {
      wanted.current = uri;
      return;
    }
    wanted.current = null;
    const found = itemsRef.current.find((i) => i.uri === uri);
    if (found) pull(found);
    else {
      const item = itemFromPlayer(uri);
      if (item) setOnStage(item);
    }
  }, []);
  useEffect(() => {
    const History = Spicetify.Platform.History;
    const handle = (loc) => {
      const uri = loc?.state?.cdsOpen;
      if (uri && loc.pathname.startsWith('/cd-shelf')) openUri(uri);
    };
    handle(History.location);
    return History.listen(handle);
  }, []);
  useEffect(() => {
    if (items && wanted.current && shelf.current) setTimeout(() => wanted.current && openUri(wanted.current), 700);
  }, [items, host]);

  const world = (
    <div className="cds-world">
      <div className="cds-world-gl" ref={worldRef} />
      <header className="cds-head">
        <div>
          <h1>CD Shelf</h1>
          <p>{items ? `${shown.length} of ${items.length} discs` : 'Dusting off the shelf…'}</p>
        </div>
        <div className="cds-tools">
          <input className="cds-search" placeholder="Find a disc" value={query} onChange={(e) => setQuery(e.target.value)} />
          {[
            ['all', 'All'],
            ['album', 'Albums'],
            ['playlist', 'Playlists'],
          ].map(([k, label]) => (
            <button key={k} className={`cds-chip${filter === k ? ' is-on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
          <select className="cds-chip" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Recently added</option>
            <option value="played">Recently played</option>
            <option value="artist">Artist</option>
            <option value="name">Title</option>
          </select>
          <button className="cds-chip" onClick={() => Spicetify.Platform.History.push('/', { cdsHome: true })}>
            Spotify home
          </button>
          <button className={`cds-chip${showSettings ? ' is-on' : ''}`} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            Settings
          </button>
        </div>
      </header>
      {showSettings && (
        <SettingsPanel settings={settings} quality={quality} setQuality={setQuality} tier={tier} onClose={() => setShowSettings(false)} />
      )}
      <div className={`cds-caption${hover || notice ? ' is-on' : ''}`}>
        {(hover || notice) && (
          <>
            <b>{(hover || notice).name}</b>
            <span>{(hover || notice).artist}</span>
          </>
        )}
      </div>
      {error && <p className="cds-empty">Couldn't read your library: {error}</p>}
      {failed && <p className="cds-empty">WebGL is unavailable, so the shelf could not be drawn.</p>}
      {items && !shown.length && <p className="cds-empty">No discs match.</p>}
    </div>
  );

  return (
    <div className="cds-root">
      {host && Spicetify.ReactDOM.createPortal(world, host)}
      {onStage && (
        <Stage key={onStage.uri} item={onStage} now={now} onClose={shelve} onShown={() => shelf.current?.setPaused(true)} />
      )}
    </div>
  );
}

export default function render() {
  return <App />;
}
