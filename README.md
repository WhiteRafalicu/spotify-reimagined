# Spotify Reimagined

Your Spotify library as a shelf of CDs. A [Spicetify](https://spicetify.app) custom app for the
Spotify desktop app, built with three.js.

Your saved albums and playlists stand spine-out on walnut shelves, as real refracting jewel cases
under art deco lighting. Hover one and it slides out to show its cover; click it and it rises off the
shelf and swings open: the cover is the booklet, the tracklist is printed inside it, and the disc
spins while it plays. Scroll past the last shelf to a table where an old TV plays the song's Canvas
video and a whiteboard writes out the lyrics in marker, in time with the music.

## Install

You need the Spotify desktop app with [Spicetify](https://spicetify.app/docs/getting-started)
installed. Then run one line:

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/WhiteRafalicu/spotify-reimagined/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/WhiteRafalicu/spotify-reimagined/main/install.ps1 | iex
```

Spotify restarts and opens on the shelf. To uninstall:

```bash
spicetify config custom_apps cd-shelf-
spicetify apply
```

## What it does

| Do this | And this happens |
| --- | --- |
| Hover a spine | The case slides out and turns to show its cover |
| Click a spine | Pull the case out and open it |
| Click a track on the booklet | Play the album or playlist from that track (long lists scroll) |
| Click the disc | Play or pause (it spins while it plays) |
| Drag the case | Turn it |
| Click outside the case or press **Esc** | Put it back |
| Click the TV | Play or pause |

- **The shelf is your library and your home page.** Spotify opens on it; the library sidebar is
  hidden. "Spotify home" in the header gets you to the original Home.
- **It stays in sync.** Save an album anywhere in Spotify and its disc slides onto the shelf; remove
  one and it leaves. Whatever is playing has a green LED on its spine.
- **The player bar's cover is a spinning CD.** Click it to open that album's case.
- **The TV corner.** The TV mirrors the Canvas video Spotify shows in its Now Playing sidebar (keep
  the sidebar open for it), or the cover art, music-channel style, through a CRT effect. The
  whiteboard shows Spotify's synced lyrics.
- **Search, filter and sort** in the header. Playlists without a cover become hand-labelled CD-Rs.
- **Settings** in the header: switch off any of it (the shelf as Home, the hidden sidebar, the
  spinning CD, the TV corner, the dust), pick a quality level, or press **Back to classic Spotify**
  to undo every change to Spotify's own interface in one click. The shelf stays one click away.
- **Quality**, also in Settings: Auto picks a level for your GPU, and the resolution adapts to keep it
  smooth. See [Performance](#performance).

## Troubleshooting

- **Nothing changed after installing:** run `spicetify apply` again. After Spotify updates itself,
  run `spicetify backup apply`.
- **"WebGL is unavailable":** on Linux with an NVIDIA GPU, hardware video decode can crash Spotify's
  GPU process and disable WebGL. Start Spotify with `--disable-accelerated-video-decode` (on Arch,
  put it in `~/.config/spotify-flags.conf`).
- **Slow:** pick Quality: Low in the header.

## Build from source

```bash
npm install
npm run build                     # embeds whatever models are in assets/ (see below)
mkdir -p "$(dirname "$(spicetify -c)")/CustomApps/cd-shelf"
cp dist/index.js dist/extension.js dist/manifest.json "$(dirname "$(spicetify -c)")/CustomApps/cd-shelf/"
spicetify config custom_apps cd-shelf
spicetify apply
```

Developing (Linux): start Spotify with the DevTools Protocol open, then rebuild and hot-reload it.

```bash
/opt/spotify/spotify --remote-debugging-port=9222 &   # Spotify with DevTools Protocol open
node tools/deploy.mjs        # build, splice into Spicetify's route chunk, reload Spotify
node tools/cdp.mjs eval 'return Spicetify.Player.data.item.name'
node tools/cdp.mjs shot out.png
```

- `src/app.jsx` is the header, the stage overlay and the player wiring.
- `src/shelf3d.js` is the three.js shelf room (springs, lights, dust, raycast hover). Every case on the shelf is the real cd-case tray and lid (a shelf build of 9k triangles; hovered and pulled cases use the full 40k build), instanced and drawn with the original rod and sheet glass shaders over each case's booklet, spine strip and printed disc. It renders in passes: opaque room, then glass refracting a copy of it, then dust, then tone mapping with a light vignette.
- Lighting lives in one `LIGHT` block in `src/shelf3d.js`: a warm-neutral directional key (the only shadow caster; 2048 map, PCF radius 9, its camera fitted to the unit and snapped to texels as you scroll), a weak cool fill, and hemisphere plus room-environment ambient. Contact shadows under every case and the creases where boards meet the sides and back are instanced multiply decals (two draws in all). The back panel carries baked compartment occlusion as an `aoMap`. The walnut is procedural: colour and roughness maps, rounded boards, clearcoat.
- A hovered case slides clear of the row (`CLEAR_Z`) before it turns, and turns square before it slides back, so its 146 mm depth never swings through its neighbours. In DevTools, `__cdShelf.debug()` shows its layout.
- `src/library.js` reads the library (`LibraryAPI`, GraphQL `queryAlbumTracks`, `PlaylistAPI`) and plays (`Player.playUri` with `skipTo`).
- `src/stage.js` is the jewel-case renderer: Ann Nguyen's `CaseStage`, rebuilt for one album with a booklet, hit testing and a rise-from-the-shelf entrance.
- `src/booklet.js` draws the tracklist page and maps clicks back to rows.
- `src/caseGeometry.js` and `src/shaders.js` come from the original, plus a dark studio, an album-tinted backdrop and the booklet material.

### The TV corner's models

`release-assets/` holds the models that may be shared (with their licences in `release-assets/LICENSES.md`); release builds load them from there through jsDelivr. For your own build, put optimized copies in `assets/` (not committed) and the build embeds them; without them, the shelf builds without the corner. Optimize with:

```bash
npx gltf-transform optimize in.glb assets/crt_tv.glb --compress meshopt --texture-compress webp --texture-size 512 --simplify false
# heavier models (ashtray 0.25, whiteboard 0.25):
npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 512 --simplify true --simplify-ratio 0.2 --simplify-error 0.002
```

| File | Model | Author | Licence |
| --- | --- | --- | --- |
| `pvm_ps1.glb` | [Sony PVM-1341 &#124;&#124; Sony Playstation](https://sketchfab.com/3d-models/sony-pvm-1341-sony-playstation-5f80311f1a4646ef9673f20ee6dc6245) | dark_igorek | CC BY 4.0 |
| `whiteboard.glb` | [School whiteboard 90cm × 120cm](https://sketchfab.com/3d-models/school-whiteboard-90cm-x-120cm-280856e261974ed093d9d15892ef045e) | Pedro-Martins | CC BY 4.0 |
| `ashtray.glb` | [Ashtray with Cigarettes](https://sketchfab.com/3d-models/ashtray-with-cigarettes-6e9bfb5e4b1e42b791a51c40cb993306) | YJ_ | CC BY 4.0 |
| `table.glb` | [table_d from FPS Creator Classic](https://sketchfab.com/3d-models/table-d-from-fps-creator-classic-ef3b5348530448289083e82251233aaa) | Garbage Raccoon | CC BY 4.0 |
| `fonts/PermanentMarker-Regular.ttf` | [Permanent Marker](https://fonts.google.com/specimen/Permanent+Marker) | Font Diner | Apache 2.0 |

The Sony set was prepared with Blender (`blender -b --python tools/optimize.py -- original.glb pvm_dec.glb`), then `gltf-transform optimize` (meshopt, 512 px WebP). `tools/split-pvm.py` can split it into separate pieces if you'd rather place them one by one.

Because the build embeds them, don't publish `dist/` from a build that includes them.

For a public release, host the assets folder (models you're allowed to redistribute) somewhere CORS-enabled, for example the repository itself through jsDelivr, and build with:

```bash
CDS_ASSET_BASE=https://cdn.jsdelivr.net/gh/<you>/cd-shelf@<tag>/assets npm run build
```

The app then fetches the models and the font from there, and the app file drops from about 3.6 MB to about 1 MB.

**How the TV gets the Canvas video:** Spotify Canvas loops are H.264 MP4 (Main profile, 1080×1920), and Spotify's bundled Chromium has no H.264 decoder, either in `<video>` or in WebCodecs. Spotify plays Canvas itself through a media stream in its Now Playing view's `<video>` (`[class*="canvasVideoContainer"] video`, a same-origin `blob:`). Twice a second the TV looks for that element. While it's showing a Canvas, the TV mirrors its frames as a `VideoTexture`; it only reads them, so Spotify keeps playing and pausing it. When there's no Canvas, the TV shows the cover art, music-channel style. `canvasFor` would download Canvas files directly if Spotify ever ships H.264.

## Performance

Measured in Spotify on an RTX 3050 Ti laptop with GPU timer queries (milliseconds of GPU work per frame):

| | Before the optimization pass | After |
| --- | --- | --- |
| 102 discs | 5.7 ms, 5.2 M triangles | **2.3 ms, 1.0 M triangles** |
| 102 discs at ~4× the pixels | 14.4 ms | **6.7 ms** |
| TV corner | 4.5 ms | **1.7 ms** |
| 2,000-disc library | 89.8 ms (8 fps), 165 M triangles | **3.4 ms (144 fps), 3.0 M triangles, 94 MB heap** |
| Idle, top of the shelf | 30 fps | **0 fps** (nothing is drawn until something changes) |

How:

- **Recycled cases.** Only the rows in view (plus one either side) hold a slot: glass instances, booklet, spine, disc, contact shadow and texture layers. Rows scrolling in reuse freed slots, so memory and drawing stay flat for any library size. A newly slotted case shows a neutral placeholder layer until its spine is written (a few milliseconds of writes per frame, more while the view is still), and the finished pixels are cached for cases seen recently.
- **Two builds of the case.** In the row only the hinge edge shows, so those cases use a shelf build of the cd-case geometry (rails, hinge, floor: 9k triangles). Hovered, pulled-out and arriving cases switch to the full build (40k) with the interior.
- **Quality presets.** Auto picks High, Medium or Low from the GPU (one lower on battery); the header's Quality menu overrides it. Presets set the resolution cap (2×/1.5×/1×), anti-aliasing (4×/2×/off), shadow resolution, light bounces inside the glass (4/3/2), dust, picture-light pools and the TV's area light.
- **Adaptive resolution.** The GPU time of each frame is measured (timer queries, or frame timing where those aren't available). Above budget the render scale steps down (to 50% at most), with plenty of headroom it steps back up.
- **Cheap lighting.** The picture-light pools are a diffuse term injected into the shelf's materials instead of six point lights. Lights are dimmed rather than switched off, so materials never recompile mid-scroll. Shadows of moving cases refresh at most 15 times a second, and the shadow area is three screens tall so scrolling rarely moves it.
- **Idle.** 30 fps for a few seconds after the last input or motion (15 fps unfocused), then nothing at all, unless the TV is on screen. With "reduce motion" turned on in the system settings, there's no camera drift and no dust.
- **The room appears fast.** The scene is parked, not destroyed, when you leave the shelf (released after 10 minutes away), so coming back draws in about 0.15 s with everything in place. Models are parsed once per Spotify session, start loading right after the shelf's first frames, all in parallel, and stay hidden until their textures are uploaded (one per idle moment) and their shaders compiled in the background, so they appear without a stall. Fresh load: room ready in about 0.6–1.0 s, no main-thread stalls after the shelf opens.
- **Lean assets.** Room models simplified (the Sony set 240k → 36.5k triangles in Blender; ashtray and whiteboard to a quarter) and meshopt-compressed, with 512 px textures (the room's objects are small on screen). Covers come from Spotify's own browser cache on later sessions.

For profiling, from DevTools: `__cdShelf.profile({ busy: true, timing: true })`, wait a few seconds, then `__cdShelf.profile()` returns GPU ms per pass, fps, CPU ms and triangles. `baseDpr` simulates a high-density screen. Spotify's own UI uses a share of the GPU too (about 28–30% on this laptop), so compare against the shelf closed.

### On a slow machine

- Pick **Quality: Low** in the header (no anti-aliasing, 1× resolution, simpler glass, no dust or extra lights).
- On Linux with NVIDIA, see "NVIDIA on Linux" above: hardware video decode can crash Spotify's GPU process and disable WebGL.
- Smaller Spotify windows render fewer pixels; the adaptive resolution does the rest.

## Credit

- The jewel case (its geometry, the refraction and diffraction shaders, and the open and close
  motion) is [cd-case](https://github.com/annnguyentt/vibe-coding/tree/main/cd-case) by
  **Ann Nguyen** ([@ann_nnng](https://x.com/ann_nnng)), built with
  [TypingMind](https://typingmind.com). Its original README is in `ORIGINAL_README.md`.
- The room's models and the marker font are by their authors, listed with their licences in
  [`release-assets/LICENSES.md`](release-assets/LICENSES.md).

## Licence

The code in this repository is [MIT](LICENSE). Ann Nguyen's case asks for credit when it's used or
remixed (above). The models and the font in `release-assets/` keep their own licences.

Not affiliated with Spotify. This changes how your own Spotify desktop app looks, through Spicetify.
