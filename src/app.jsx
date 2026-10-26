// CD Shelf: your Spotify library as a rack of jewel cases. Pull one out to open it and play.
import { copyDiagnostics } from './diagnostics';
import { createShelf } from './shelf3d';
import { sections } from './sections';
import { createStage } from './stage';
import { recentAlbums, retry, canvasFor, itemFromPlayer, loadLibrary, loadTracks, lyricsFor, nowPlaying, nowTrack, openPage, playFrom, playOrPause, createPlayerClock, lyricsRoute } from './library';
import assets from './assets.gen';
import css from './style.css';
import { DEFAULTS, GLASS, SIZES, SPEEDS, WALLS, getSettings, onSettings, setSettings } from './settings';
import { LANGUAGE_NAMES, t } from './i18n';

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

function Stage({ item, now, effects, onClose, onShown, onConsole, pinned, onPin }) {
  const box = useRef(null);
  const stage = useRef(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // The case animates itself away only once it's up and running; until then (or if it never gets
  // there) closing just closes.
  const live3d = useRef(false);
  const close = () => (live3d.current && stage.current ? stage.current.leave() : onClose());
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
        live3d.current = true;
        clearTimeout(giveUp);
        setReady(true);
        setTimeout(() => onShown?.(), 400);
        setTimeout(() => s?.setOpen(true), 250);
      },
      onFail: () => {
        live3d.current = false;
        setFailed(true);
      },
      effects,
    });
    // Never leave an invisible stage over the page: if the case can't be shown, go back to the shelf.
    const giveUp = setTimeout(() => {
      if (live3d.current) return;
      console.warn('[cd-shelf] the case never became ready; back to the shelf');
      onClose();
    }, 12000);
    stage.current = s;
    window.__cdStage = s; // handy from DevTools
    retry(() => loadTracks(item))
      .then((tracks) => {
        album.tracks = tracks;
        s?.refresh();
      })
      .catch((e) => {
        console.error('[cd-shelf] tracks', e);
        album.tracks = null;
        album.tracksFailed = true;
        s?.refresh();
      });
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        playOrPause(album);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(giveUp);
      window.removeEventListener('keydown', onKey);
      s?.dispose();
      stage.current = null;
    };
  }, [item.uri]);

  useEffect(() => {
    stage.current?.setEffects(effects);
  }, [effects.sway, effects.glints, effects.speed]);

  const live = now.context === item.uri;
  // Portalled to <body>: Spotify's view containers are transformed, which would pin a fixed
  // overlay to them instead of to the window.
  return Spicetify.ReactDOM.createPortal(
    <div className={`cds-stage${ready ? ' is-ready' : ''}`} style={rect || undefined}>
      <div className="cds-stage-gl" ref={box} />
      <div className="cds-hud">
        <button className="cds-chip" onClick={close}>
          {t('back')}
        </button>
        <button className="cds-chip" onClick={() => openPage(item)}>
          {item.kind === 'playlist' ? t('openPlaylist') : t('openAlbum')}
        </button>
        <button className="cds-chip is-play" onClick={() => playOrPause(item)}>
          {live && now.playing ? t('pause') : t('play')}
        </button>
        <button className={`cds-chip${pinned ? ' is-on' : ''}`} onClick={() => onPin(item)} aria-pressed={pinned}>
          {pinned ? t('pinned') : t('pin')}
        </button>
        {onConsole && (
          <button className="cds-chip" onClick={() => onConsole(item)}>
            {t('playInConsole')}
          </button>
        )}
      </div>
      <p className="cds-hint">
        {failed
          ? t('caseFailed')
          : open
            ? t('hintOpen')
            : t('hintClosed')}
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


// Choices are drawn in the page instead of native <select> popups: those are separate OS widgets,
// and in Spotify they can close without taking the click (the choice seems to reset).
function Segmented({ value, options, onChange, label }) {
  return (
    <div className="cds-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={`cds-seg-btn${v === value ? ' is-on' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Swatches({ value, colors, onChange, label, themeLabel }) {
  return (
    <div className="cds-swatches" role="radiogroup" aria-label={label}>
      {['', ...colors].map((c) => (
        <button
          key={c || 'theme'}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c || themeLabel}
          title={c || themeLabel}
          className={`cds-swatch${c === value ? ' is-on' : ''}${c ? '' : ' is-theme'}`}
          style={c ? { background: c } : undefined}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function Menu({ value, options, onChange, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    box.current?.querySelector('.is-on')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const current = options.find(([v]) => v === value);
  return (
    <div className={`cds-menu-box ${className}`} ref={box}>
      <button type="button" className="cds-chip cds-menu-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {current ? current[1] : value}
      </button>
      {open && (
        <div className="cds-menu" role="listbox" aria-label={label}>
          {options.map(([v, text]) => (
            <button
              key={v}
              type="button"
              role="option"
              aria-selected={v === value}
              className={`cds-menu-item${v === value ? ' is-on' : ''}`}
              onClick={() => {
                onChange(v);
                setOpen(false);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ settings, quality, setQuality, tier, onClose, onDiagnostics }) {
  const set = (k, v) => setSettings({ [k]: v });
  const toggle = (k, label, hint) => (
    <label key={k} className="cds-toggle">
      <input type="checkbox" checked={settings[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>
        {t(label)}
        {hint && <small>{t(hint)}</small>}
      </span>
    </label>
  );
  // A labelled row of choices; `keys` are setting values, labelled by t(prefix + Capitalised).
  const choice = (k, label, prefix, keys, hint) => (
    <div key={k} className="cds-toggle is-stacked">
      <span>
        {t(label)}
        {hint && <small>{hint}</small>}
      </span>
      <Segmented label={t(label)} value={settings[k]} onChange={(v) => set(k, v)} options={keys.map((v) => [v, t(prefix + v[0].toUpperCase() + v.slice(1))])} />
    </div>
  );
  const heading = (label) => <h3 className="cds-settings-section">{t(label)}</h3>;
  return (
    <div className="cds-settings" role="dialog" aria-label={t('settingsLabel')}>
      <div className="cds-settings-head">
        <b>{t('settings')}</b>
        <button className="cds-chip" onClick={onClose} aria-label={t('closeSettings')}>
          ✕
        </button>
      </div>
      <div className="cds-settings-body">
        {heading('secShelf')}
        {toggle('home', 'setHome', 'setHomeHint')}
        {toggle('hideSidebar', 'setSidebar', 'setSidebarHint')}
        {toggle('discCover', 'setDisc', 'setDiscHint')}
        {toggle('tvCorner', 'setCorner', 'setCornerHint')}
        {toggle('dividers', 'setDividers', 'setDividersHint')}
        {choice('size', 'size', 'size', ['small', 'normal', 'large', 'huge'], t('sizeHint'))}

        {heading('secLook')}
        {choice('theme', 'look', 'look', ['walnut', 'birch', 'minimal'])}
        <div className="cds-toggle is-stacked">
          <span>{t('wallColor')}</span>
          <Swatches label={t('wallColor')} themeLabel={t('wallTheme')} value={settings.wall || ''} colors={WALLS} onChange={(v) => set('wall', v)} />
        </div>
        {choice('glass', 'glass', 'glass', ['clear', 'classic', 'smoky', 'blue'])}

        {heading('secMotion')}
        {choice('speed', 'speed', 'speed', ['slow', 'normal', 'fast'])}
        {toggle('sway', 'setSway', 'setSwayHint')}
        {toggle('cursorLight', 'setCursorLight', '')}
        {toggle('glints', 'setGlints', '')}
        {toggle('dust', 'setDust', '')}

        {heading('secLyrics')}
        {choice('lyrics', 'lyricsMode', 'lyrics', ['write', 'line', 'karaoke'], t('lyricsHint'))}

        {heading('secGeneral')}
        <div className="cds-toggle">
          <span>{t('language')}</span>
          <Menu label={t('language')} value={settings.lang} onChange={(v) => set('lang', v)} options={[['auto', t('langAuto')], ...Object.entries(LANGUAGE_NAMES)]} />
        </div>
        <div className="cds-toggle is-stacked">
          <span>
            {t('quality')}
            <small>{t('qualityHint', { now: tier && quality === 'auto' ? t('qualityNow', { tier: t('q' + tier[0].toUpperCase() + tier.slice(1)) }) : '' })}</small>
          </span>
          <Segmented
            label={t('quality')}
            value={quality}
            onChange={setQuality}
            options={[
              ['auto', t('qAuto')],
              ['high', t('qHigh')],
              ['medium', t('qMedium')],
              ['low', t('qLow')],
            ]}
          />
        </div>
        <div className="cds-toggle">
          <span>
            {t('diag')}
            <small>{t('diagHint')}</small>
          </span>
          <button type="button" className="cds-chip" onClick={onDiagnostics}>
            {t('diagCopy')}
          </button>
        </div>
      </div>
      <div className="cds-settings-foot">
        <button
          className="cds-chip"
          onClick={() => {
            setSettings({ home: false, hideSidebar: false, discCover: false });
            Spicetify.Platform.History.push('/', { cdsHome: true });
          }}
        >
          {t('classic')}
        </button>
        <button className="cds-chip" onClick={() => setSettings({ ...DEFAULTS, pins: getSettings().pins })}>
          {t('reset')}
        </button>
      </div>
      <p className="cds-settings-note">{t('settingsNote')}</p>
    </div>
  );
}

// A shelf with fewer than this many discs is topped up with recently played albums.
const SPARSE = 12;
async function withSuggestions(items) {
  if (items.length >= SPARSE) return items;
  const extra = await recentAlbums(items.map((i) => i.uri), SPARSE * 2 - items.length);
  return [...items, ...extra];
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
  const loadAll = useCallback(() => {
    setError(null);
    retry(() => loadLibrary((partial) => setItems((cur) => (cur && cur.length >= partial.length ? cur : partial))))
      .then(withSuggestions)
      .then(setItems)
      .catch((e) => {
        console.error('[cd-shelf]', e);
        setError(String(e?.message || e));
      });
  }, []);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [onStage, setOnStage] = useState(null);
  const [hover, setHover] = useState(null);
  const [failed, setFailed] = useState(false);
  const [host, setHost] = useState(null);
  const [notice, setNotice] = useState(null);
  const lidPaused = useRef(false);
  // A diagnostics report the clipboard refused, shown so it can be copied by hand.
  const [diagText, setDiagText] = useState(null);
  const [shelfie, setShelfie] = useState(null); // the PNG blob being shown
  const takeShelfie = async () => {
    const bmp = await shelf.current?.shelfie();
    if (!bmp) return;
    let user = null;
    try {
      user = (await Spicetify.Platform?.UserAPI?.getUser?.())?.displayName || null;
    } catch {}
    setShelfie(await composeShelfie(bmp, { count: shelved.items.length, user }));
  };
  const [quality, setQuality] = useState(() => {
    try {
      return localStorage.getItem('cd-shelf:quality') || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [tier, setTier] = useState(null);
  const [settings, setSettingsState] = useState(getSettings);
  // Remembered between sessions (it shapes the shelf's sections).
  const sort = SORTS[settings.sort] ? settings.sort : 'recent';
  const setSort = (v) => setSettings({ sort: v });
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => onSettings(setSettingsState), []);
  // The TV corner is built with the scene, so switching it rebuilds the scene (see the mount effect).
  // A lost GPU context (a GPU reset) also rebuilds it: glGen counts those.
  const [glGen, setGlGen] = useState(0);
  const cornerKey = `${settings.tvCorner ? 'corner' : 'nocorner'}|${settings.theme}|${glGen}`;
  const arrivals = useRef(null);
  const now = usePlayer();
  const worldRef = useRef(null);
  const shelf = useRef(null);

  useEffect(() => {
    injectStyle();
    // Pages appear as they arrive, so a big library doesn't sit on an empty shelf.
    loadAll();
    // The 3D room fills Spotify's main view, above the page's own scroller.
    setHost(document.querySelector('.Root__main-view') || document.body);
  }, []);

  const suggestedCount = useMemo(() => (items || []).filter((i) => i.suggested).length, [items]);
  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => filter === 'all' || i.kind === filter)
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.artist.toLowerCase().includes(q))
      .sort(SORTS[sort]);
  }, [items, filter, sort, query]);
  // Sections (pinned first, then dividers by the sort); not while searching, where it's just results.
  const shelved = useMemo(
    () => sections(shown, sort, { pins: settings.pins || [], dividers: settings.dividers && !query.trim() }),
    [shown, sort, settings.pins, settings.dividers, query],
  );

  const pull = useCallback((item) => {
    shelf.current?.pullOut(item.uri);
    setHover(null);
    setTimeout(() => setOnStage(item), PULL_MS / (SPEEDS[getSettings().speed] || 1));
  }, []);
  // Put the case back, glide down to the TV corner, load the disc into the PlayStation, play it.
  const playInConsole = useCallback(async (item) => {
    setOnStage(null);
    shelf.current?.setPaused(false);
    shelf.current?.putBack();
    const ok = await shelf.current?.playInConsole(item);
    if (ok) playFrom(item, 0);
  }, []);
  const shelve = useCallback(() => {
    setOnStage(null);
    shelf.current?.setPaused(false);
    shelf.current?.putBack();
    worldRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!worldRef.current) return;
    const handlers = {
      onPick: (item) => pull(item),
      onHover: setHover,
      // The TV's on-screen controls (see corner.js tvZone).
      // The monitor's VOL buttons work Spotify's volume.
      volume: {
        get: () => Spicetify.Player.getVolume(),
        set: (v) => Spicetify.Player.setVolume(v),
      },
      // The PlayStation's lid: open pauses, closing plays on (only if it was playing).
      onLid: (open) => {
        const P = Spicetify.Player;
        if (open) {
          lidPaused.current = P.isPlaying();
          if (lidPaused.current) P.pause();
        } else if (lidPaused.current) {
          lidPaused.current = false;
          P.play();
        }
      },
      onTv: ({ zone, frac } = {}) => {
        const P = Spicetify.Player;
        if (zone === 'prev') P.back();
        else if (zone === 'next') P.next();
        else if (zone === 'seek') P.seek(Math.round(frac * (P.getDuration() || 0)));
        else P.togglePlay();
      },
      onLost: () => {
        console.warn('[cd-shelf] WebGL context lost: rebuilding the shelf');
        setOnStage(null);
        setGlGen((g) => g + 1);
      },
    };
    let s;
    if (parked && (parked.cornerKey !== cornerKey || parked.shelf.lost)) {
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
        sway: settings.sway,
        cursorLight: settings.cursorLight,
        theme: settings.theme,
        onQualityDrop: (to) => {
          setTier(to);
          setNotice({ name: t('qualityDropped', { tier: t('q' + to[0].toUpperCase() + to.slice(1)) }), artist: t('qualityDroppedHint') });
          setTimeout(() => setNotice(null), 6000);
        },
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
    shelf.current?.setEffects({ sway: settings.sway, cursorLight: settings.cursorLight, speed: SPEEDS[settings.speed] || 1, size: SIZES[settings.size] || 1, lyricsMode: settings.lyrics, wall: settings.wall || '', glass: GLASS[settings.glass] || GLASS.classic });
  }, [settings.sway, settings.cursorLight, settings.speed, settings.size, settings.lyrics, settings.wall, settings.glass, host, cornerKey]);
  useEffect(() => {
    if (!items) return;
    shelf.current?.setItems(shelved.items, { arrivals: arrivals.current, dividers: shelved.dividers });
    arrivals.current = null;
  }, [shelved, host, cornerKey]);

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
          .then(withSuggestions)
          .then((next) => {
            const before = new Set((itemsRef.current || []).map((i) => i.uri));
            const added = next.filter((i) => !before.has(i.uri));
            arrivals.current = new Set(added.map((i) => i.uri));
            setItems(next);
            if (!added.length) return;
            setNotice(added.length === 1 ? { name: added[0].name, artist: t('added') } : { name: t('addedMany', { n: added.length }), artist: t('added') });
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
    <div className={`cds-world is-${settings.theme}`}>
      <div
        className="cds-world-gl"
        ref={worldRef}
        tabIndex={0}
        role="application"
        aria-label={t('shelfLabel')}
        aria-describedby="cds-caption"
      />
      <header className="cds-head">
        <div>
          <h1>{t('title')}</h1>
          <p>
            {items ? t('discs', { shown: shown.length, total: items.length }) : t('loading')}
            {suggestedCount > 0 && t('suggested', { n: suggestedCount })}
          </p>
        </div>
        <div className="cds-tools">
          <input className="cds-search" placeholder={t('find')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {[
            ['all', t('all')],
            ['album', t('albums')],
            ['playlist', t('playlists')],
          ].map(([k, label]) => (
            <button key={k} className={`cds-chip${filter === k ? ' is-on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
          <Menu
            label={t('sort')}
            value={sort}
            onChange={setSort}
            options={[
              ['recent', t('sortRecent')],
              ['played', t('sortPlayed')],
              ['artist', t('sortArtist')],
              ['name', t('sortTitle')],
            ]}
          />
          <button className="cds-chip" onClick={() => Spicetify.Platform.History.push('/', { cdsHome: true })}>
            {t('spotifyHome')}
          </button>
          <button className="cds-chip" onClick={takeShelfie} aria-label={t('shelfie')} title={t('shelfie')}>
            📷
          </button>
          <button className={`cds-chip${showSettings ? ' is-on' : ''}`} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            {t('settings')}
          </button>
        </div>
      </header>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          quality={quality}
          setQuality={setQuality}
          tier={tier}
          onClose={() => setShowSettings(false)}
          onDiagnostics={async () => {
            const { ok, report } = await copyDiagnostics({ shelf: shelf.current, settings, quality, items, lyricsRoute: lyricsRoute() });
            if (!ok) return setDiagText(report);
            setNotice({ name: t('diagCopied'), artist: t('diagCopiedHint') });
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}
      {diagText && <DiagnosticsBox text={diagText} onClose={() => setDiagText(null)} />}
      {shelfie && <ShelfieBox blob={shelfie} onClose={() => setShelfie(null)} />}
      <div id="cds-caption" aria-live="polite" className={`cds-caption${hover || notice ? ' is-on' : ''}`}>
        {(hover || notice) && (
          <>
            <b>{(hover || notice).name}</b>
            <span>
              {(hover || notice).artist}
              {hover?.suggested ? t('notSaved') : ''}
            </span>
          </>
        )}
      </div>
      {error && (
        <div className="cds-empty is-action">
          <p>{t('libraryError', { error })}</p>
          <button className="cds-chip" onClick={loadAll}>
            {t('tryAgain')}
          </button>
        </div>
      )}
      {failed && (
        <p className="cds-empty">
          {t('noWebgl')}
        </p>
      )}
      {items && !shown.length && <p className="cds-empty">{t('noMatch')}</p>}
    </div>
  );

  return (
    <div className="cds-root">
      {host && Spicetify.ReactDOM.createPortal(world, host)}
      {onStage && (
        <Stage
          key={onStage.uri}
          item={onStage}
          now={now}
          onConsole={settings.tvCorner && shelf.current?.hasConsole ? playInConsole : null}
          pinned={(settings.pins || []).includes(onStage.uri)}
          onPin={(item) => {
            const pins = settings.pins || [];
            setSettings({ pins: pins.includes(item.uri) ? pins.filter((u) => u !== item.uri) : [item.uri, ...pins] });
          }}
          effects={{ sway: settings.sway, glints: settings.glints, speed: SPEEDS[settings.speed] || 1, glass: GLASS[settings.glass] || GLASS.classic }} onClose={shelve} onShown={() => shelf.current?.setPaused(true)} />
      )}
    </div>
  );
}

// The shelfie: the render, with a caption strip under it.
async function composeShelfie(bitmap, { count, user }) {
  const W = bitmap.width;
  const strip = Math.round(W * 0.055);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = bitmap.height + strip;
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  g.fillStyle = '#121110';
  g.fillRect(0, bitmap.height, W, strip);
  const pad = strip * 0.45;
  g.textBaseline = 'middle';
  g.fillStyle = '#f2ece2';
  g.font = `${Math.round(strip * 0.5)}px "CDS Permanent Marker", "Permanent Marker", "Comic Sans MS", cursive`;
  const title = user ? t('shelfieTitleOf', { user }) : t('shelfieTitle');
  g.fillText(title, pad, bitmap.height + strip / 2);
  const tw = g.measureText(title).width;
  g.fillStyle = 'rgba(242,236,226,0.6)';
  g.font = `600 ${Math.round(strip * 0.3)}px "SpotifyMixUI", "CircularSp", Arial, sans-serif`;
  g.fillText(t('discsCount', { n: count }), pad * 2 + tw, bitmap.height + strip / 2 + strip * 0.04);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(242,236,226,0.4)';
  g.fillText('spotify-reimagined', W - pad, bitmap.height + strip / 2 + strip * 0.04);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

function ShelfieBox({ blob, onClose }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [done, setDone] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setDone(t('shelfieCopied'));
    } catch {
      setDone(t('shelfieCopyFailed'));
    }
  };
  const save = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `cd-shelf-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDone(t('shelfieSaved'));
  };
  return (
    <div className="cds-diag cds-shelfie" role="dialog" aria-label={t('shelfie')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="cds-settings-head">
        <b>{t('shelfie')}</b>
        <button className="cds-chip" onClick={onClose} aria-label={t('closeSettings')}>
          ✕
        </button>
      </div>
      <img src={url} alt={t('shelfie')} />
      <div className="cds-tools">
        <button className="cds-chip is-play" onClick={copy} autoFocus>
          {t('shelfieCopy')}
        </button>
        <button className="cds-chip" onClick={save}>
          {t('shelfieSave')}
        </button>
        {done && <span className="cds-settings-note">{done}</span>}
      </div>
    </div>
  );
}

// When the clipboard can't be used: the report in a box, selected, ready for Ctrl+C.
function DiagnosticsBox({ text, onClose }) {
  const area = useRef(null);
  useEffect(() => {
    area.current?.focus();
    area.current?.select();
  }, []);
  return (
    <div className="cds-diag" role="dialog" aria-label={t('diag')}>
      <div className="cds-settings-head">
        <b>{t('diag')}</b>
        <button className="cds-chip" onClick={onClose} aria-label={t('closeSettings')}>
          ✕
        </button>
      </div>
      <p className="cds-settings-note">{t('diagManual')}</p>
      <textarea ref={area} readOnly value={text} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
    </div>
  );
}

// If anything in the shelf throws while rendering, show a way out instead of a blank page.
class Guard extends Spicetify.React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[cd-shelf] crashed', error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cds-root cds-crash">
        <h1>{t('crashTitle')}</h1>
        <p>{String(this.state.error?.message || this.state.error)}</p>
        <div className="cds-tools">
          <button className="cds-chip is-play" onClick={() => this.setState({ error: null })}>
            {t('tryAgain')}
          </button>
          <button className="cds-chip" onClick={() => Spicetify.Platform.History.push('/', { cdsHome: true })}>
            {t('spotifyHome')}
          </button>
          <button
            className="cds-chip"
            onClick={async () => {
              const { ok, report } = await copyDiagnostics({ shelf: window.__cdShelf, settings: getSettings(), lyricsRoute: lyricsRoute() });
              this.setState({ diag: ok ? null : report, copied: ok });
            }}
          >
            {this.state.copied ? t('diagCopied') : t('diagCopy')}
          </button>
        </div>
        <p className="cds-settings-note">{t('crashNote')}</p>
        {this.state.diag && <DiagnosticsBox text={this.state.diag} onClose={() => this.setState({ diag: null })} />}
      </div>
    );
  }
}

export default function render() {
  return (
    <Guard>
      <App />
    </Guard>
  );
}
