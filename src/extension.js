// CD Shelf's companion extension, loaded on every page: the shelf becomes Spotify's home, and the
// now-playing cover in the player bar becomes a disc that spins while music plays. Clicking the
// disc opens its jewel case on the shelf (shift-click keeps Spotify's own behaviour).
import './diagnostics';
import css from './extension.css';
import { getSettings, onSettings } from './settings';

const SHELF = '/cd-shelf';

function whenReady(cb) {
  const ok = () => window.Spicetify?.Player?.addEventListener && Spicetify.Platform?.History;
  if (ok()) cb();
  else setTimeout(() => whenReady(cb), 200);
}

whenReady(() => {
  const History = Spicetify.Platform.History;

  const style = document.createElement('style');
  style.id = 'cd-shelf-ext-style';
  style.textContent = css;
  document.head.appendChild(style);

  // Each change can be switched off in the shelf's settings.
  let settings = getSettings();
  const applyClasses = () => {
    document.body.classList.toggle('cds-hide-sidebar', settings.hideSidebar);
    document.body.classList.toggle('cds-disc', settings.discCover);
  };
  applyClasses();
  onSettings((next) => {
    settings = next;
    applyClasses();
  });

  // Home is the shelf. The shelf's "Spotify home" button navigates with cdsHome to get through.
  const toShelf = (loc) => {
    if (settings.home && loc?.pathname === '/' && !loc.state?.cdsHome) History.replace(SHELF);
  };
  toShelf(History.location);
  History.listen(toShelf);

  document.addEventListener(
    'click',
    (e) => {
      const button = e.target.closest?.('[data-testid="cover-art-button"]');
      if (!settings.discCover || !button || e.shiftKey || !button.closest('.Root__now-playing-bar, footer, [data-testid="now-playing-bar"]'))
        return;
      const uri = Spicetify.Player.data?.context?.uri || Spicetify.Player.data?.item?.album?.uri;
      if (!uri) return;
      e.preventDefault();
      e.stopPropagation();
      History.push(SHELF, { cdsOpen: uri, at: Date.now() });
    },
    true,
  );

  // isPlaying() throws until the player has its first state, so this runs last and guarded.
  const sync = () => {
    let playing = false;
    try {
      playing = !!Spicetify.Player.isPlaying();
    } catch {}
    document.body.classList.toggle('cds-playing', playing);
  };
  Spicetify.Player.addEventListener('onplaypause', sync);
  Spicetify.Player.addEventListener('songchange', sync);
  sync();
});
