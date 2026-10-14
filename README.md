# CD Shelf

A [Spicetify](https://spicetify.app) custom app that turns your Spotify library into a rack of CD
jewel cases. Your saved albums and playlists stand spine-out on wooden shelves in a three.js room.
The cases cast shadows, a key light has dust drifting through it, and a warm lamp follows your
pointer. Everything moves on springs: hover a case and it slides out and turns to show its cover
while its neighbours lean away, filtering drops cases off the shelf and glides the rest into place,
and whatever is playing pulses a green LED. Scroll to move along the shelves. Click it and the case rises off the shelf as a real-time, refracting
3D jewel case and swings open: the cover is the booklet, the inside of the booklet is the tracklist,
and the disc is printed with the art.

| Do this | And this happens |
| --- | --- |
| Click a spine | Pull the case out and open it |
| Click a track on the booklet | Play the album/playlist from that track |
| Click the disc | Play or pause it (it spins while it plays) |
| Drag the case | Turn it |
| Click the case | Close or reopen it |
| Click outside the case, **Esc** or "Back to the shelf" | Put it back |

Playlists without a cover become blank CD-Rs with the name written on in marker.

The companion extension (`src/extension.js`, loaded on every page) makes the shelf part of Spotify itself:

- **Saving updates the shelf.** Save an album or playlist anywhere in Spotify and its disc appears in front of the shelf showing its cover, squares up and slides into its slot while the row makes room. The lamp picks it out and a caption names it. Removing one takes its disc off the shelf.
- **A TV corner under the shelf.** Scroll past the last board and the camera comes down to a table on a plank floor (`assets/table.glb`; without it, a walnut media stand is built instead). On it, a CRT TV plays the current track like a music channel: the cover drifting across the tube, slot-mask phosphors, scanlines, a rolling bar, static when the track changes, and a green on-screen display with the channel number, track and artist (and ❚❚ PAUSE). Its light spills onto the room. The PS2 stands beside the TV with its controller resting on top (with the stand, the PS2 sits in a cubby and your five newest discs lie stacked in the other). At the bottom of the scroll the camera holds a close-up on the table top, backing off only as far as it must to fit the TV and the PS2 across a narrow window. Click the TV to play or pause. On the wall behind the PS2 hangs a whiteboard with the song's lyrics in marker, in time with the music: each line is written out as it's sung, the previous line fades to an erased smudge, and the next waits underneath in red. The lyrics come from Spotify's own synced-lyrics service (the one its Lyrics view uses).
- **Art deco lighting.** A warm gold key light over a deep emerald-teal fill, brass picture-light bars under every board pooling light onto the spines, a gold-and-teal split-tone grade and a warm bias light behind the TV washing the wall. The palette lives in the `LIGHT` block in `src/shelf3d.js`.
- **The library sidebar is gone.** The shelf is the library, and the main view takes its space.
- **The shelf is Home.** Spotify opens on it, and the Home button leads to it. "Spotify home" on the shelf still gets you to the original Home.
- **The player bar cover is a CD.** It spins while music plays. Clicking it opens the case of whatever's playing (shift-click keeps Spotify's own behaviour).

## Install

```bash
npm install
npm run build
mkdir -p ~/.config/spicetify/CustomApps/cd-shelf
cp dist/index.js dist/extension.js dist/manifest.json ~/.config/spicetify/CustomApps/cd-shelf/
spicetify config custom_apps cd-shelf
spicetify apply
```

It appears as **CD Shelf** (a disc icon) in Spotify's left bar.

### NVIDIA on Linux

On this machine Spotify's GPU process crashed a few seconds after every page load because of
hardware video decode (NVDEC via `LIBVA_DRIVER_NAME=nvidia`). After that, Chromium blocks WebGL for
the whole Spotify UI. `~/.config/spotify-flags.conf` (read by Arch's `/usr/bin/spotify` launcher)
fixes it:

```
--disable-accelerated-video-decode
--disable-domain-blocking-for-3d-apis
```

As a last resort the stage also falls back to an OffscreenCanvas when `<canvas>` WebGL is blocked.

## Develop

```bash
/opt/spotify/spotify --remote-debugging-port=9222 &   # Spotify with DevTools Protocol open
node tools/deploy.mjs        # build, splice into Spicetify's route chunk, reload Spotify
node tools/cdp.mjs eval 'return Spicetify.Player.data.item.name'
node tools/cdp.mjs shot out.png
```

- `src/app.jsx` is the header, the stage overlay and the player wiring.
- `src/shelf3d.js` is the three.js shelf room (springs, lights, dust, raycast hover). Every case on the shelf is the real cd-case tray and lid (built at `withDetail(3)`, about 22k triangles), instanced and drawn with the original rod and sheet glass shaders over each case's booklet, spine strip and printed disc. It renders in passes: opaque room, then glass refracting a copy of it, then dust, then tone mapping with a light vignette.
- Lighting lives in one `LIGHT` block in `src/shelf3d.js`: a warm-neutral directional key (the only shadow caster; 2048 map, PCF radius 9, its camera fitted to the unit and snapped to texels as you scroll), a weak cool fill, and hemisphere plus room-environment ambient. Contact shadows under every case and the creases where boards meet the sides and back are instanced multiply decals (two draws in all). The back panel carries baked compartment occlusion as an `aoMap`. The walnut is procedural: colour and roughness maps, rounded boards, clearcoat.
- A hovered case slides clear of the row (`CLEAR_Z`) before it turns, and turns square before it slides back, so its 146 mm depth never swings through its neighbours. In DevTools, `__cdShelf.debug()` shows its layout.
- `src/library.js` reads the library (`LibraryAPI`, GraphQL `queryAlbumTracks`, `PlaylistAPI`) and plays (`Player.playUri` with `skipTo`).
- `src/stage.js` is the jewel-case renderer: Ann Nguyen's `CaseStage`, rebuilt for one album with a booklet, hit testing and a rise-from-the-shelf entrance.
- `src/booklet.js` draws the tracklist page and maps clicks back to rows.
- `src/caseGeometry.js` and `src/shaders.js` come from the original, plus a dark studio, an album-tinted backdrop and the booklet material.

### The TV corner's models

The models are not in the source tree. Put optimized copies in `assets/` and the build bundles them; without them, the shelf builds without the corner. Optimize with:

```bash
npx gltf-transform optimize in.glb assets/crt_tv.glb --compress quantize --texture-compress webp --texture-size 1024 --simplify false
```

| File | Model | Author | Licence |
| --- | --- | --- | --- |
| `assets/crt_tv.glb` | [CRT TV](https://sketchfab.com/3d-models/crt-tv-7e19d474af4449e69c03dc661e7967dc) | Keon1x | Sketchfab Standard: use, don't redistribute the file |
| `assets/playstation_2.glb` | [PlayStation 2](https://sketchfab.com/3d-models/playstation-2-8c992e9f5c86496ca7bd7dfe109d3cc2) | Smoggybeard | CC BY-NC-SA 4.0 |
| `assets/ps2_controller.glb` | [PS2 Controller](https://sketchfab.com/3d-models/ps2-controller-9b0db71448a14907a6235c79bdce786a) | rhcreations | CC BY 4.0 |
| `assets/whiteboard.glb` | [School whiteboard 90cm × 120cm](https://sketchfab.com/3d-models/school-whiteboard-90cm-x-120cm-280856e261974ed093d9d15892ef045e) | Pedro-Martins | CC BY 4.0 |
| `assets/fonts/PermanentMarker-Regular.ttf` | [Permanent Marker](https://fonts.google.com/specimen/Permanent+Marker) | Font Diner | Apache 2.0 (`assets/fonts/LICENSE.txt`) |
| `assets/ashtray.glb` | [Ashtray with Cigarettes](https://sketchfab.com/3d-models/ashtray-with-cigarettes-6e9bfb5e4b1e42b791a51c40cb993306) | YJ_ | CC BY 4.0 |
| `assets/table.glb` | [table_d from FPS Creator Classic](https://sketchfab.com/3d-models/table-d-from-fps-creator-classic-ef3b5348530448289083e82251233aaa) | Garbage Raccoon | CC BY 4.0 |

Because the build embeds them, don't publish `dist/` from a build that includes them.

**How the TV gets the Canvas video:** Spotify Canvas loops are H.264 MP4 (Main profile, 1080×1920), and Spotify's bundled Chromium has no H.264 decoder, either in `<video>` or in WebCodecs. Spotify plays Canvas itself through a media stream in its Now Playing view's `<video>` (`[class*="canvasVideoContainer"] video`, a same-origin `blob:`). Twice a second the TV looks for that element. While it's showing a Canvas, the TV mirrors its frames as a `VideoTexture`; it only reads them, so Spotify keeps playing and pausing it. When there's no Canvas, the TV shows the cover art, music-channel style. `canvasFor` would download Canvas files directly if Spotify ever ships H.264.

## Performance

Measured in Spotify on an RTX 3050 Ti laptop, with 102 discs:

| | Before | After |
| --- | --- | --- |
| Frames rendered while idle | every frame | 30 fps (15 when Spotify isn't focused) |
| Draw calls per frame | 715 | 25 (38 at the TV) |
| CPU per rendered frame | 7–8 ms | 2–3 ms |

What does it:

- **Frame throttling:** full frame rate while anything moves or the pointer is active, 30 fps when the room only idles (dust, drift, the TV's flicker), and 15 fps while Spotify isn't the focused window.
- **On-demand shadows:** the shadow map only re-renders when a shadow caster moves.
- **Texture arrays:** covers and spines live in two arrays (one layer per case), so the booklet, spine, and both disc faces of every case are four instanced draws in all. The glass was already instanced.
- **Settled cases are skipped:** no spring maths and no matrix writes. Rows outside the camera's view aren't drawn.
- **TV corner:** its area light and picture are skipped while it's off-screen (shader variants are pre-compiled, so scrolling to it doesn't hitch). The mirrored Canvas is copied into a 384×288 canvas rather than uploading 1080×1920 frames. Its models load once the shelf is up and the page is idle.

In DevTools, `__cdShelf.perf()` reports fps, CPU ms per frame and draw calls since the last call. With the shelf closed, Spotify itself uses about 28–30% of this GPU (its own UI and other extensions), so measure against that.

## Credit

The jewel case (the geometry, the refraction and diffraction shaders, the open and close motion) is
[cd-case](https://github.com/annnguyentt/vibe-coding/tree/main/cd-case) by **Ann Nguyen**
([@ann_nnng](https://x.com/ann_nnng)). Its original README is in `ORIGINAL_README.md`.
