// The TV corner under the shelf: a table (or a walnut media stand) on a plank floor, a CRT TV on top showing the
// current track's Spotify Canvas (or its album art, music-channel style), a PS2 in the cubby and its
// controller beside the TV. The screen's light spills onto the stand and the room.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CRT_FRAG, CRT_VERT } from './shaders';
import { createWhiteboard } from './whiteboard';

// Stand, in millimetres. Local origin: on the floor, centred, at the wall (+z comes out of the wall).
const STAND = { w: 760, d: 430, legs: 90, body: 300, slab: 20, side: 20, back: 6 };
STAND.top = STAND.legs + STAND.body; // 390: the TV stands here
const GAP_UNDER_SHELF = 90;
// Your table (assets/table.glb), scaled to this width; without it, the walnut stand above is built.
const TABLE_WIDTH = 900;

// The TV's screen glass, measured off the model (glTF units, its front faces +x): a 290 × 216 mm
// 4:3 tube centred at y = 0.1856, bulging from x = 0.184 at the corners to 0.205 in the middle.
const TUBE = { y: 0.1856, hw: 0.145, hh: 0.108, x0: 0.184, bulgeW: 0.0131, bulgeH: 0.008 };
// The model's own glass is cut out (so our tube shows through the bezel instead of fighting it for
// depth): any TV fragment inside the tube's outline, in the TV's own metre space, is discarded.
// toTv maps world space back into that space and is refreshed as the stand moves.
const toTv = { value: new THREE.Matrix4() };
function cutGlass(root) {
  const cut = `
    vec3 tvP = (uToTv * vec4(vCutWorld, 1.0)).xyz;
    if (tvP.x > ${(TUBE.x0 - 0.008).toFixed(4)} && abs(tvP.z) < ${(TUBE.hw * 0.996).toFixed(4)} && abs(tvP.y - ${TUBE.y.toFixed(4)}) < ${(TUBE.hh * 0.996).toFixed(4)}) discard;`;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uToTv = toTv;
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'varying vec3 vCutWorld;\nvoid main() {')
          .replace('#include <project_vertex>', '#include <project_vertex>\n  vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          'uniform mat4 uToTv;\nvarying vec3 vCutWorld;\nvoid main() {' + cut,
        );
      };
      m.customProgramCacheKey = () => 'cd-shelf-cut-glass';
      m.needsUpdate = true;
    }
  });
}

const loader = new GLTFLoader();

// Scales a loaded model so its largest horizontal extent is `width` mm, rests it on y = 0 and centres it.
function fit(root, width) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = width / Math.max(size.x, size.z);
  const holder = new THREE.Group();
  root.scale.multiplyScalar(k);
  root.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
  holder.add(root);
  holder.userData.size = size.multiplyScalar(k);
  return holder;
}

function shadows(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

function plankTexture(walnutCanvas) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const rows = 8;
  const h = c.height / rows;
  for (let r = 0; r < rows; r++) {
    // Each plank borrows a different strip of the walnut, staggered so the joints don't line up.
    const sy = ((r * 37) % 8) * (walnutCanvas.height / 8);
    const shift = ((r * 389) % 1024) - 512;
    for (const dx of [shift - 1024, shift, shift + 1024]) g.drawImage(walnutCanvas, 0, sy, walnutCanvas.width, walnutCanvas.height / 8, dx, r * h, 1024, h);
    g.fillStyle = 'rgba(8,5,3,0.75)';
    g.fillRect(0, r * h, 1024, 2);
    g.fillRect(((shift % 1024) + 1024) % 1024, r * h, 2, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 128, 128);
  g.filter = 'blur(10px)';
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(22, 22, 84, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// The on-screen display: a channel tag and the track, in a chunky TV font.
function drawOsd(canvas, { name, artist, paused, channel }) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = '700 30px "VT323", "Courier New", monospace';
  g.textBaseline = 'top';
  const text = (s, x, y, color = '#7cff8a') => {
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillText(s, x + 2, y + 2);
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  text(`CH ${String(channel).padStart(2, '0')}`, canvas.width - 140, 26);
  if (paused) text('❚❚ PAUSE', 34, 26, '#ffffff');
  if (name) {
    g.font = '700 26px "VT323", "Courier New", monospace';
    const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    text(clip(name.toUpperCase(), 26), 34, canvas.height - 84, '#ffffff');
    text(clip(artist || '', 30), 34, canvas.height - 52);
  }
}

export function createCorner({ scene, own, boardMat, sideMat, walnutCanvas, contactMat, quadGeo, assets, onScreenColor, onChange, prewarm, lyricsFor, getProgress }) {
  // The models load once the shelf is up and the page is idle, so they don't compete with it.
  const later = (fn) => setTimeout(() => (window.requestIdleCallback || setTimeout)(fn), 1200);
  const group = new THREE.Group();
  scene.add(group);
  const state = { y: null, targetY: 0, floorY: 0, tvCenterY: 0, wallZ: 0 };

  // Floor: walnut planks, darker than the furniture.
  const planks = own(plankTexture(walnutCanvas));
  planks.repeat.set(5, 5);
  const floor = new THREE.Mesh(
    own(new THREE.PlaneGeometry(5000, 2400)),
    own(new THREE.MeshStandardMaterial({ map: planks, color: 0x6e6660, roughness: 0.72 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 1200;
  floor.receiveShadow = true;
  group.add(floor);

  const furniture = assets.table ? 'table' : 'stand';
  // The surface the TV stands on, and the furniture's footprint (z = 0 at the wall).
  const lay = furniture === 'stand' ? { top: STAND.top, back: 0, depth: STAND.d, halfW: STAND.w / 2 } : { top: 576, back: 12, depth: 435, halfW: TABLE_WIDTH / 2 };

  // The stand: top and bottom slabs, sides, a divider making two cubbies, a back, four tapered legs.
  const stand = new THREE.Group();
  group.add(stand);
  const { w, d, legs, body, slab, side, back, top } = STAND;
  if (furniture === 'stand') buildStand();
  function buildStand() {
  const box = (gw, gh, gd, mat, x, y, z, r = 1.6) => {
    const m = new THREE.Mesh(own(new RoundedBoxGeometry(gw, gh, gd, 3, r)), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    stand.add(m);
    return m;
  };
  box(w, slab, d, boardMat, 0, top - slab / 2, d / 2, 2.2);
  box(w - 2 * side, slab, d - back, boardMat, 0, legs + slab / 2, d / 2 + back / 2);
  for (const sx of [-1, 1]) box(side, body - 2 * slab + 0.5, d, sideMat, sx * (w / 2 - side / 2), legs + body / 2, d / 2);
  box(side, body - 2 * slab, d - back - 14, sideMat, 0, legs + body / 2, d / 2 + back / 2 - 7);
  box(w - 2 * side, body - 2 * slab, back, own(new THREE.MeshStandardMaterial({ color: 0x241811, roughness: 0.9 })), 0, legs + body / 2, back / 2, 0.5);
  const legGeo = own(new THREE.CylinderGeometry(13, 9, legs, 20));
  for (const [lx, lz] of [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ]) {
    const leg = new THREE.Mesh(legGeo, sideMat);
    leg.position.set(lx * (w / 2 - 50), legs / 2, lz ? d - 50 : 50);
    leg.castShadow = leg.receiveShadow = true;
    stand.add(leg);
  }
  }

  // Soft contact shadows: the stand's feet on the floor, the TV and the PS2 where they sit.
  const blobMat = own(contactMat.clone());
  blobMat.uniforms.uMap = { value: own(blobTexture()) };
  const contacts = new THREE.InstancedMesh(quadGeo, blobMat, 8);
  contacts.frustumCulled = false;
  contacts.renderOrder = 1;
  group.add(contacts);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _bx = new THREE.Vector3();
  const _by = new THREE.Vector3();
  const _bz = new THREE.Vector3();
  const _k = new THREE.Color();
  const STATIC_LIGHT = new THREE.Color(0.75, 0.78, 0.85);
  let nContacts = 0;
  const contact = (x, y, z, wu, wv, k) => {
    _m.makeBasis(_bx.set(wu, 0, 0), _bz.set(0, 0, wv), _by.set(0, 1, 0)).setPosition(_p.set(x, y, z));
    contacts.setMatrixAt(nContacts, _m);
    contacts.setColorAt(nContacts, _k.setRGB(k, k, k));
    nContacts++;
  };

  // The CRT screen and its light. Built now; attached to the TV once the model has loaded.
  const osdCanvas = document.createElement('canvas');
  osdCanvas.width = 512;
  osdCanvas.height = 384;
  const osdTex = own(new THREE.CanvasTexture(osdCanvas));
  osdTex.colorSpace = THREE.SRGBColorSpace;
  const blank = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blank.needsUpdate = true;
  const crt = own(
    new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: blank },
        uOsd: { value: osdTex },
        uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
        uHasTex: { value: 0 },
        uTime: { value: 0 },
        uStatic: { value: 1 },
        uOsdAlpha: { value: 1 },
        uBright: { value: 2.2 },
        uPower: { value: 0 },
      },
      vertexShader: CRT_VERT,
      fragmentShader: CRT_FRAG,
    }),
  );
  const tubeGeo = own(new THREE.PlaneGeometry(1, 1, 32, 24));
  {
    const pos = tubeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) * 2; // -1..1 across (viewer's left to right)
      const v = pos.getY(i) * 2; // -1..1 up
      const x = TUBE.x0 + TUBE.bulgeW * (1 - u * u) + TUBE.bulgeH * (1 - v * v) - 0.0015;
      // Viewed from +x, the viewer's right is -z.
      pos.setXYZ(i, x, TUBE.y + v * TUBE.hh * 1.01, -u * TUBE.hw * 1.01);
    }
    // Mapped this way (plane x to -z, plane y to y) the plane's own winding already faces +x.
    tubeGeo.computeVertexNormals();
  }
  const tube = new THREE.Mesh(tubeGeo, crt);
  RectAreaLightUniformsLib.init();
  const glow = new THREE.RectAreaLight(0x8899ff, 0, 290, 216);
  const glowColor = new THREE.Color(0.4, 0.45, 0.6);

  // A warm bias light behind the set, washing the wall.
  const bias = new THREE.PointLight(0xffc27a, 0, 900, 1);
  group.add(bias);

  let tv = null;
  let tvRoot = null;
  let ps2 = null;
  let pad = null;
  let tray = null;
  let table = null;
  const pickables = [];
  if (assets.tv) {
    later(() => loader.loadAsync(assets.tv).then((g) => {
      cutGlass(g.scene);
      tvRoot = g.scene;
      g.scene.add(tube);
      shadows(g.scene);
      tube.castShadow = false;
      // Model is in metres with its screen facing +x; turn it to face the room (+z) and scale to mm.
      g.scene.rotation.y = -Math.PI / 2;
      g.scene.scale.setScalar(1000);
      tv = new THREE.Group();
      tv.add(g.scene);
      // The tube's light rides with the TV: just in front of the glass, shining out (-z of the light).
      glow.position.set(0, TUBE.y * 1000, 215);
      glow.rotation.set(0, Math.PI, 0);
      tv.add(glow);
      group.add(tv);
      pickables.push(...collect(g.scene));
      arrange();
      later(() => prewarm?.(glow));
    }));
  }
  if (assets.ps2) {
    later(() => loader.loadAsync(assets.ps2).then((g) => {
      shadows(g.scene);
      ps2 = fit(g.scene, 301);
      group.add(ps2);
      arrange();
    }));
  }
  if (assets.pad) {
    later(() => loader.loadAsync(assets.pad).then((g) => {
      shadows(g.scene);
      pad = fit(g.scene, 158);
      group.add(pad);
      arrange();
    }));
  }
  if (assets.tray && furniture === 'table') {
    later(() => loader.loadAsync(assets.tray).then((g) => {
      shadows(g.scene);
      tray = fit(g.scene, 140);
      group.add(tray);
      arrange();
    }));
  }
  if (furniture === 'table') {
    later(() => loader.loadAsync(assets.table).then((g) => {
      // The table ships unlit (KHR_materials_unlit); give it a lit, satin finish so it takes the
      // room's light and shadows like everything else.
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const old = o.material;
        o.material = own(new THREE.MeshStandardMaterial({ map: old.map, color: 0xd2c8bf, roughness: 0.62, metalness: 0 }));
        old.dispose();
      });
      shadows(g.scene);
      table = fit(g.scene, TABLE_WIDTH);
      const s = table.userData.size;
      lay.top = s.y;
      lay.depth = s.z;
      table.position.set(0, 0, lay.back + s.z / 2);
      group.add(table);
      arrange();
      if (placed) place(...placed);
    }));
  }

  // Puts the TV, the PS2, the controller, the CD stack, the light and the contact shadows where they
  // belong for the furniture in use. Runs again as each model arrives.
  function arrange() {
    const T = lay.top;
    const tvZ = lay.back + 20 + 157;
    // On the table the TV sits a little left of centre, leaving room for the PS2 beside it.
    const tvX = furniture === 'table' ? -lay.halfW + 197 + 70 : 0;
    const front = lay.back + lay.depth;
    nContacts = 0;
    if (tv) {
      // Not quite square to the room: turned a touch, as if nudged when it was last plugged in.
      const turn = furniture === 'table' ? 0.1 : 0;
      tv.position.set(tvX - (turn ? 6 : 0), T, tvZ + (turn ? 8 : 0));
      bias.position.set(tvX, T + 300, 60);
      tv.rotation.y = turn;
      contact(tvX, T + 0.3, tvZ + 27, 410, 370, 0.6);
    }
    if (furniture === 'stand') {
      for (const [lx, lz] of [
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
      ])
        contact(lx * (w / 2 - 50), 0.3, lz ? d - 50 : 50, 70, 70, 0.7);
      contact(0, 0.3, d / 2, w + 60, d + 40, 0.45);
      if (ps2) {
        const s = ps2.userData.size;
        ps2.position.set(w / 4 + 6, legs + slab, d - s.z / 2 - 26);
        ps2.rotation.y = 0;
        contact(ps2.position.x, legs + slab + 0.3, ps2.position.z, s.x + 16, s.z + 16, 0.7);
      }
      if (pad) {
        pad.position.set(w / 2 - 125, T, d - 85);
        pad.rotation.y = -0.45;
      }
      stack.position.set(-w / 4 - 6, legs + slab, d - 118);
    } else {
      // Table: the PS2 beside the TV, facing the room, with its controller resting on top.
      contact(0, 0.3, lay.back + lay.depth / 2, lay.halfW * 2 + 40, lay.depth + 40, 0.42);
      let ps2Top = T;
      if (ps2) {
        const s = ps2.userData.size;
        ps2.position.set(lay.halfW - 22 - s.x / 2, T, front - s.z / 2 - 48);
        ps2.rotation.y = -0.17;
        ps2Top = T + s.y;
        contact(ps2.position.x, T + 0.35, ps2.position.z, s.x + 18, s.z + 18, 0.7);
      }
      if (pad) {
        // Dropped on the console rather than placed: off-centre, at its own angle, slightly tipped.
        pad.position.set(ps2 ? ps2.position.x - 28 : lay.halfW - 118, ps2Top, ps2 ? ps2.position.z + 22 : front - 72);
        pad.rotation.set(0.02, 0.62, -0.025);
      }
    }
    // The ashtray, in the gap between the TV and the PS2, a little forward on the cloth.
    if (tray && furniture === 'table') {
      const s = tray.userData.size;
      tray.position.set(72, T, front - 62);
      tray.rotation.y = 0.55;
      contact(tray.position.x, T + 0.35, tray.position.z, s.x + 24, s.z + 24, 0.6);
    }
    stack.visible = furniture === 'stand';
    if (board) board.group.position.set(BOARD_X, T + 40, 3);
    contacts.count = nContacts;
    contacts.instanceMatrix.needsUpdate = true;
    if (contacts.instanceColor) contacts.instanceColor.needsUpdate = true;
    onChange?.();
  }

  // A few of the newest discs lying flat, covers up (in the stand's left cubby, or on the table).
  const stack = new THREE.Group();
  group.add(stack);
  const caseGeo = own(new THREE.BoxGeometry(142, 10.4, 125));
  const plastic = own(new THREE.MeshPhysicalMaterial({ color: 0x4b525a, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0 }));
  let stacked = '';
  function setStack(covers) {
    if (furniture !== 'stand') return;
    const key = covers.join('|');
    if (key === stacked) return;
    stacked = key;
    for (const m of [...stack.children]) {
      stack.remove(m);
      m.material[2].map?.dispose();
      m.material[2].dispose();
    }
    covers.forEach((url, i) => {
      const cover = new THREE.MeshPhysicalMaterial({ color: 0x333333, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
      const m = new THREE.Mesh(caseGeo, [plastic, plastic, cover, plastic, plastic, plastic]);
      m.position.set(Math.sin(i * 2.3) * 6, 5.2 + i * 10.6, Math.cos(i * 1.7) * 5);
      m.rotation.y = Math.sin(i * 3.1) * 0.09;
      m.castShadow = m.receiveShadow = true;
      stack.add(m);
      fetch(url)
        .then((r) => r.blob())
        .then((b) => {
          const img = new Image();
          img.src = URL.createObjectURL(b);
          return img.decode().then(() => img);
        })
        .then((img) => {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          cover.map = tex;
          cover.color.set(0xffffff);
          cover.needsUpdate = true;
        })
        .catch(() => {});
    });
  }

  function collect(root) {
    const out = [];
    root.traverse((o) => o.isMesh && out.push(o));
    return out;
  }

  // The lyrics whiteboard on the wall to the right of the TV (with the table).
  let board = null;
  if (assets.board && furniture === 'table' && lyricsFor && getProgress) {
    later(() => {
      board = createWhiteboard({ own, loader, asset: assets.board, font: assets.font, lyricsFor, getProgress, onReady: () => arrange() });
      group.add(board.group);
      if (screen.info) board.setTrack(screen.info);
    });
  }
  const BOARD_X = 40 + 240; // its left edge clears the TV; it hangs just under the shelf

  // ---- What's on: Canvas video when the track has one, else the album art panning slowly. ----
  const screen = { kind: 'off', tex: null, video: null, aspect: 1, staticUntil: 0, osdUntil: 0, power: 0, channel: 3, track: null, paused: false, art: null };
  const sampler = document.createElement('canvas');
  sampler.width = sampler.height = 8;
  const sampleCtx = sampler.getContext('2d', { willReadFrequently: true });
  let sampledAt = 0;
  let t = 0;

  function dropSource() {
    if (screen.video) {
      screen.video.pause();
      screen.video.removeAttribute('src');
      screen.video.load();
      screen.video = null;
    }
    if (screen.tex && screen.tex !== blank) screen.tex.dispose();
    screen.tex = null;
  }

  function show(kind, tex, aspect, source) {
    dropSource();
    screen.kind = kind;
    screen.tex = tex;
    screen.aspect = aspect;
    screen.source = source;
    crt.uniforms.uTex.value = tex || blank;
    crt.uniforms.uHasTex.value = tex ? 1 : 0;
  }

  async function tune(info, canvasUrl) {
    const myTrack = info.uri;
    if (canvasUrl) {
      const video = document.createElement('video');
      video.src = canvasUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch {}
      await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
      if (screen.track !== myTrack) return video.pause();
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      show('video', tex, video.videoWidth / video.videoHeight || 9 / 16, video);
      screen.video = video;
      if (screen.paused) video.pause();
      return;
    }
    if (!info.art) return show('none', null, 1);
    const img = new Image();
    const res = await fetch(info.art);
    img.src = URL.createObjectURL(await res.blob());
    await img.decode();
    if (screen.track !== myTrack) return;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    show('art', tex, img.naturalWidth / img.naturalHeight, img);
  }

  // Spotify's own Canvas player, the <video> in its Now Playing view. Spotify decodes Canvas itself
  // (its Chromium can't play the H.264 files the API hands out), so when that element is showing a
  // Canvas the TV mirrors its frames. It only reads them: Spotify keeps playing and pausing it.
  // Its frames are copied into a small 4:3 canvas (cropped to the tube) rather than uploading the
  // full 1080 × 1920 video to the GPU every frame.
  const mirror = { el: null, src: '', tex: null, drawnAt: 0 };
  const mirrorCanvas = document.createElement('canvas');
  mirrorCanvas.width = 384;
  mirrorCanvas.height = 288;
  const mirrorCtx = mirrorCanvas.getContext('2d');
  let mirrorAt = 0;
  function findCanvasVideo() {
    for (const v of document.querySelectorAll('[class*="canvasVideoContainer"] video')) if (v.videoWidth > 0 && v.readyState >= 2) return v;
    return null;
  }
  function syncMirror() {
    const el = findCanvasVideo();
    if (el && el === mirror.el && el.currentSrc === mirror.src) return;
    mirror.tex?.dispose();
    mirror.el = el;
    mirror.src = el ? el.currentSrc : '';
    mirror.tex = null;
    if (!el) return;
    mirror.tex = new THREE.CanvasTexture(mirrorCanvas);
    mirror.tex.colorSpace = THREE.SRGBColorSpace;
    mirror.drawnAt = 0;
  }
  function drawMirror(time) {
    if (time - mirror.drawnAt < 1 / 30) return;
    mirror.drawnAt = time;
    const v = mirror.el;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const tube = 4 / 3;
    let sw = vw;
    let sh = vw / tube;
    if (sh > vh) {
      sh = vh;
      sw = vh * tube;
    }
    mirrorCtx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
    mirror.tex.needsUpdate = true;
  }

  // Called by the shelf with the player's state; canvasFor resolves a track's Canvas (or null).
  function setTrack(info, canvasFor) {
    const paused = !info?.playing;
    if (info && info.uri !== screen.track) {
      screen.track = info.uri;
      screen.channel = 2 + (Math.abs([...info.uri].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 60);
      screen.staticUntil = t + 0.55;
      screen.osdUntil = t + 4.5;
      screen.info = info;
      board?.setTrack(info);
      canvasFor(info.uri)
        .then((url) => tune(info, url))
        .catch(() => tune(info, null));
    }
    if (paused !== screen.paused) {
      screen.paused = paused;
      if (screen.video) paused ? screen.video.pause() : screen.video.play().catch(() => {});
      screen.osdUntil = Math.max(screen.osdUntil, t + 2.5);
    }
    if (!info) {
      screen.track = null;
      dropSource();
      screen.kind = 'off';
    }
    drawOsd(osdCanvas, { name: screen.info?.name, artist: screen.info?.artist, paused, channel: screen.channel });
    osdTex.needsUpdate = true;
  }

  // Returns true while the corner itself is still moving (so the shelf keeps shadows fresh).
  function update(dt, time, inView = true) {
    t = time;
    if (state.y === null) state.y = state.targetY;
    const moving = Math.abs(state.targetY - state.y) > 0.05;
    state.y += (state.targetY - state.y) * (1 - Math.exp(-dt * 5));
    group.position.y = state.y;
    // Off screen, the TV's light and picture do nothing: skip them (and the light's shading cost).
    glow.visible = inView && screen.power > 0.01;
    bias.visible = inView && !!tv;
    bias.intensity = 2.2;
    if (!inView) return moving;
    board?.update(time, inView, screen.info?.duration);
    if (tvRoot) {
      tvRoot.updateWorldMatrix(true, false);
      toTv.value.copy(tvRoot.matrixWorld).invert();
    }

    // Mirror Spotify's Canvas when it has one for this track; otherwise show our own picture.
    if (time - mirrorAt > 0.5) {
      mirrorAt = time;
      syncMirror();
    }
    const live = !!(mirror.tex && screen.track && time > screen.staticUntil - 0.2);
    if (live) drawMirror(time);
    const pic = live ? mirror.tex : screen.tex;
    screen.live = live;
    const kindNow = live ? 'video' : screen.kind;
    const aspect = live ? 4 / 3 : screen.aspect;
    const source = live ? mirrorCanvas : screen.source;
    crt.uniforms.uTex.value = pic || blank;
    crt.uniforms.uHasTex.value = pic ? 1 : 0;

    const on = screen.kind !== 'off';
    screen.power += ((on ? 1 : 0) - screen.power) * (1 - Math.exp(-dt * 6));
    const u = crt.uniforms;
    u.uTime.value = time;
    u.uPower.value = screen.power;
    u.uStatic.value = Math.max(time < screen.staticUntil ? 1 : 0, kindNow === 'none' ? 0.35 : 0, u.uStatic.value * Math.exp(-dt * 9));
    u.uOsdAlpha.value = screen.paused ? 1 : Math.min(1, Math.max(0, (screen.osdUntil - time) / 0.6));
    // Canvas videos are graded for a phone screen and already bright; covers get more push.
    const bright = kindNow === 'video' ? 1.0 : 2.0;
    u.uBright.value += ((screen.paused ? bright * 0.6 : bright) - u.uBright.value) * (1 - Math.exp(-dt * 4));

    // Fit the picture into the 4:3 tube: Canvas videos are tall, so crop to their middle; album art
    // is square, so drift slowly across it like a music channel's cover shot.
    const tube = 4 / 3;
    const crop = u.uCrop.value;
    if (aspect < tube) {
      const h = aspect / tube;
      const drift = kindNow === 'art' ? 0.5 + 0.5 * Math.sin(time * 0.11) : 0.5;
      crop.set(0, (1 - h) * drift, 1, h);
    } else {
      const wv = tube / aspect;
      crop.set((1 - wv) / 2, 0, wv, 1);
    }

    // Light from the tube: its average colour, sampled a few times a second.
    if (source && time - sampledAt > 0.2) {
      sampledAt = time;
      try {
        sampleCtx.drawImage(source, 0, 0, 8, 8);
        const px = sampleCtx.getImageData(0, 0, 8, 8).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
        }
        const n = (px.length / 4) * 255;
        glowColor.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
        onScreenColor?.(glowColor);
      } catch {}
    }
    const lit = (screen.power * (screen.paused ? 0.5 : 1) * (0.92 + 0.08 * Math.sin(time * 57))) * (u.uStatic.value > 0.5 ? 0.7 : 1);
    glow.color.lerp(u.uStatic.value > 0.5 ? STATIC_LIGHT : glowColor, 1 - Math.exp(-dt * 6));
    glow.intensity = 9 * lit;
    return moving;
  }

  // Lays the corner out under a shelf whose bottom edge is at `shelfBottom`, against a wall at wallZ.
  let placed = null;
  function place(shelfBottom, wallZ) {
    placed = [shelfBottom, wallZ];
    const standTop = shelfBottom - GAP_UNDER_SHELF - 334;
    state.targetY = standTop - lay.top;
    state.floorY = state.targetY;
    state.tvCenterY = state.targetY + lay.top + TUBE.y * 1000;
    state.wallZ = wallZ;
    group.position.z = wallZ;
  }

  return {
    group,
    place,
    update,
    // What the close-up has to fit across: the TV and whatever stands beside it, at the TV's front.
    get frame() {
      const tvX = furniture === 'table' ? -lay.halfW + 197 + 70 : 0;
      const left = tvX - 197 - 40;
      const right = furniture === 'table' ? Math.max(lay.halfW + 10, board ? BOARD_X + 240 + 25 : 0) : tvX + 197 + 40;
      return { x: (left + right) / 2, halfW: (right - left) / 2, z: state.wallZ + lay.back + 20 + 157 + 211 };
    },
    get standTopY() {
      return state.targetY + lay.top;
    },
    setTrack,
    setStack,
    get halfW() {
      return lay.halfW + 40;
    },
    get screen() {
      return { board: board?.current, live: screen.live, hasMirrorTex: !!mirror.tex, mirror: mirror.el ? { w: mirror.el.videoWidth, h: mirror.el.videoHeight, paused: mirror.el.paused } : null, kind: screen.kind, track: screen.track, paused: screen.paused, video: screen.video ? { w: screen.video.videoWidth, h: screen.video.videoHeight, t: +screen.video.currentTime.toFixed(2), paused: screen.video.paused } : null };
    },
    get floorY() {
      return state.floorY;
    },
    get tvCenterY() {
      return state.tvCenterY;
    },
    // True when the ray hits the TV (clicking it plays or pauses).
    hitsTv(raycaster) {
      return pickables.length > 0 && raycaster.intersectObjects([...pickables, tube], false).length > 0;
    },
    dispose() {
      mirror.tex?.dispose();
      dropSource();
      scene.remove(group);
    },
  };
}
