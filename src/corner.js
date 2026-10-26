// The TV corner under the shelf: a table (or a walnut media stand) on a plank floor, a CRT TV on top showing the
// current track's Spotify Canvas (or its album art, music-channel style), a PS2 in the cubby and its
// controller beside the TV. The screen's light spills onto the stand and the room.
import * as THREE from 'three';
import { t as tr } from './i18n';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CRT_FRAG, CRT_VERT } from './shaders';
import { createWhiteboard } from './whiteboard';
import { loadCover } from './cover';

// Stand, in millimetres. Local origin: on the floor, centred, at the wall (+z comes out of the wall).
const STAND = { w: 760, d: 430, legs: 90, body: 300, slab: 20, side: 20, back: 6 };
STAND.top = STAND.legs + STAND.body; // 390: the TV stands here
const GAP_UNDER_SHELF = 90;
// Your table (assets/table.glb), scaled to this width; without it, the walnut stand above is built.
const TABLE_WIDTH = 900;
// The table model is a 2:1 game asset; it's stretched to this depth so the whole Sony set (monitor,
// console, controllers and cables: about 84 cm front to back) stands on it.
const TABLE_DEPTH = 880;

// The TV, scaled to this width. Its real size, and where its screen is, are read off the model when
// it loads (see tvSpec); these are just the starting guesses.
const TV_WIDTH = 348; // the Sony PVM-1341's real width
const tvSpec = { w: 400, h: 386, d: 330, screenX: 0, screenY: 225, screenW: 383, screenH: 291, screenFront: 0 };

// The TV's own screen becomes the CRT: it gets UVs running 0..1 across and up the glass as seen from
// the front (the model faces -z), which is what the CRT shader expects.
function screenUv(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/screen/i.test(o.material?.name || '')) return;
    const pos = o.geometry.attributes.position;
    const v = new THREE.Vector3();
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      uv[i * 2] = (box.max.x - v.x) / (box.max.x - box.min.x); // viewer's left to right (facing -z)
      uv[i * 2 + 1] = (v.y - box.min.y) / (box.max.y - box.min.y);
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.userData.isScreen = true;
  });
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Models are parsed and prepared once per Spotify session; each corner gets its own copy (clone
// shares the geometry, materials and textures, so it's nearly free).
const modelCache = new Map();
function loadModel(url, prepare) {
  if (!modelCache.has(url)) {
    const p = loader.loadAsync(url).then((g) => {
      prepare?.(g.scene);
      return g.scene;
    });
    p.catch(() => modelCache.delete(url));
    modelCache.set(url, p);
  }
  return modelCache.get(url).then((root) => root.clone(true));
}
// The table ships unlit (KHR_materials_unlit); give it a lit, satin finish so it takes the room's
// light and shadows like everything else.
function litTable(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    o.material = new THREE.MeshStandardMaterial({ map: old.map, color: 0xd2c8bf, roughness: 0.62, metalness: 0 });
    old.dispose();
  });
}

// Scales a loaded model so its largest horizontal extent is `width` mm, rests it on y = 0 and centres it.
function fit(root, width, scale) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = scale ?? width / Math.max(size.x, size.z);
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
// The on-screen controls, in the OSD's own 0..1 coordinates (y down): a transport row and a
// progress bar. Shown while the pointer is over the TV; clicking them works the player.
const CONTROLS = { rowTop: 0.3, rowBottom: 0.58, barTop: 0.64, barBottom: 0.76 };
export function tvZone(x, y) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (y >= CONTROLS.barTop && y <= CONTROLS.barBottom && x >= 0.07 && x <= 0.93) return { zone: 'seek', frac: (x - 0.07) / 0.86 };
  if (y >= CONTROLS.rowTop && y <= CONTROLS.rowBottom) return { zone: x < 0.36 ? 'prev' : x > 0.64 ? 'next' : 'play' };
  return { zone: 'play' };
}
// The monitor's front panel, in the model's own coordinates (measured on the PVM-1341 model): six
// rocker columns, + on top and - below, then POWER; RESET left of the rockers.
const ROCKERS = [
  ['aperture', 0.0726],
  ['bright', 0.0574],
  ['chroma', 0.0419],
  ['phase', 0.0267],
  ['contrast', 0.0114],
  ['vol', -0.0043],
];
function panelAt(p) {
  if (p.z > -0.07) return null; // not the panel's face
  if (p.x > -0.031 && p.x < -0.019 && p.y > 0.018 && p.y < 0.032) return 'power';
  if (Math.abs(p.x - 0.0883) < 0.0065 && Math.abs(p.y - 0.0258) < 0.0075) return 'reset';
  for (const [id, x] of ROCKERS) {
    if (Math.abs(p.x - x) > 0.0062) continue;
    if (p.y > 0.0335 && p.y < 0.049) return `${id}+`;
    if (p.y > 0.017 && p.y <= 0.0335) return `${id}-`;
  }
  return null;
}
// What each knob does to the picture: [step, min, max, default]; kept between sessions.
const PICTURE = { bright: [0.03, -0.18, 0.18, 0], contrast: [0.1, 0.5, 1.6, 1], chroma: [0.15, 0, 2, 1], phase: [0.12, -0.9, 0.9, 0], aperture: [0.25, 0, 2, 1] };
const PICTURE_KEY = 'cd-shelf:crt';
function loadPicture() {
  const out = Object.fromEntries(Object.entries(PICTURE).map(([k, v]) => [k, v[3]]));
  try {
    Object.assign(out, JSON.parse(localStorage.getItem(PICTURE_KEY) || '{}'));
  } catch {}
  return out;
}

// The screen's UV (as the ray hit it) to where that point shows on the OSD: the CRT shader bends
// the picture (barrel distortion) before sampling, so the same bend applies here. OSD y runs down.
function osdPoint(uv) {
  const cx = uv.x - 0.5;
  const cy = uv.y - 0.5;
  const k = (1 + 0.11 * (cx * cx + cy * cy)) * 1.02;
  return { x: 0.5 + cx * k, y: 1 - (0.5 + cy * k) };
}
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function drawOsd(canvas, { name, artist, paused, channel, controls, bar }) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.font = '700 30px "VT323", "Courier New", monospace';
  g.textBaseline = 'top';
  const text = (s, x, y, color = '#7cff8a') => {
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillText(s, x + 2, y + 2);
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  text(`CH ${String(channel).padStart(2, '0')}`, W - 140, 26);
  if (paused) text(tr('paused'), 34, 26, '#ffffff');
  if (name) {
    g.font = '700 26px "VT323", "Courier New", monospace';
    const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    text(clip(name.toUpperCase(), 26), 34, H - 84, '#ffffff');
    text(clip(artist || '', 30), 34, H - 52);
  }
  // A PVM-style level bar for the knob just pressed: the name, then sixteen segments.
  if (bar) {
    g.font = '700 30px "VT323", "Courier New", monospace';
    text(bar.label, 34, 74, '#ffffff');
    const n = 16;
    const lit = Math.round(bar.value * n);
    for (let i = 0; i < n; i++) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(36 + i * 18, 114, 14, 22);
      g.fillStyle = i < lit ? '#7cff8a' : 'rgba(124,255,138,0.22)';
      g.fillRect(34 + i * 18, 112, 14, 22);
    }
  }
  if (!controls) return;
  // A dim band behind the controls so they read over any picture.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, H * (CONTROLS.rowTop - 0.03), W, H * (CONTROLS.barBottom - CONTROLS.rowTop + 0.06));
  const cy = (H * (CONTROLS.rowTop + CONTROLS.rowBottom)) / 2;
  const on = (z) => (controls.hover === z ? '#ffffff' : '#7cff8a');
  // Drawn shapes rather than font glyphs, so they look the same everywhere.
  const tri = (x, dir, size, color) => {
    g.beginPath();
    g.moveTo(x - (dir * size) / 2, cy - size / 2);
    g.lineTo(x + (dir * size) / 2, cy);
    g.lineTo(x - (dir * size) / 2, cy + size / 2);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  const shadowed = (fn) => {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowOffsetX = g.shadowOffsetY = 2;
    fn();
    g.restore();
  };
  shadowed(() => {
    // Previous: |◀◀
    g.fillStyle = on('prev');
    g.fillRect(W * 0.18 - 34, cy - 22, 7, 44);
    tri(W * 0.18 - 6, -1, 44, on('prev'));
    tri(W * 0.18 + 22, -1, 44, on('prev'));
    // Play / pause
    if (controls.paused) tri(W * 0.5 + 4, 1, 56, on('play'));
    else {
      g.fillStyle = on('play');
      g.fillRect(W * 0.5 - 22, cy - 28, 15, 56);
      g.fillRect(W * 0.5 + 7, cy - 28, 15, 56);
    }
    // Next: ▶▶|
    tri(W * 0.82 - 22, 1, 44, on('next'));
    tri(W * 0.82 + 6, 1, 44, on('next'));
    g.fillStyle = on('next');
    g.fillRect(W * 0.82 + 27, cy - 22, 7, 44);
  });
  // Progress bar with the times; where the pointer is on it, a marker shows where a click goes.
  const x0 = W * 0.07;
  const x1 = W * 0.93;
  const by = H * ((CONTROLS.barTop + CONTROLS.barBottom) / 2) + 6;
  const f = controls.duration ? Math.min(1, controls.progress / controls.duration) : 0;
  g.fillStyle = 'rgba(124,255,138,0.3)';
  g.fillRect(x0, by - 4, x1 - x0, 8);
  g.fillStyle = on('seek');
  g.fillRect(x0, by - 4, (x1 - x0) * f, 8);
  if (controls.hover === 'seek' && controls.hoverFrac !== undefined) {
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + (x1 - x0) * controls.hoverFrac - 2, by - 12, 4, 24);
  }
  g.font = '700 24px "VT323", "Courier New", monospace';
  text(mmss(controls.hover === 'seek' && controls.hoverFrac !== undefined ? controls.hoverFrac * controls.duration : controls.progress), x0, by - 36);
  const total = mmss(controls.duration || 0);
  text(total, x1 - g.measureText(total).width, by - 36);
}

export function createCorner({ scene, own, boardMat, sideMat, walnutCanvas, contactMat, quadGeo, assets, onScreenColor, onChange, prepare, lyricsFor, getProgress }) {
  // The models load once the shelf is up and the page is idle, so they don't compete with it.
  // Loads start as soon as the browser has a moment after the shelf's first frames (models already
  // parsed this session come straight from the cache).
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 50));
  // A model stays hidden until the GPU has its textures and shaders (see the shelf's prepare), so it
  // appears without a stall on the frame it first shows.
  const reveal = (obj, light) => {
    obj.visible = false;
    Promise.resolve(prepare?.(obj, light)).finally(() => {
      obj.visible = true;
      onChange?.();
    });
  };
  // Load timing (ms since the corner was created), for __cdShelf.debug().screen.timing.
  const born = performance.now();
  const timing = {};
  const mark = (k) => (timing[k] = Math.round(performance.now() - born));
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
        uAdjust: { value: new THREE.Vector4(0, 1, 1, 0) },
        uAperture: { value: 1 },
        uBright: { value: 2.2 },
        uPower: { value: 0 },
        uMotion: { value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1 },
      },
      vertexShader: CRT_VERT,
      fragmentShader: CRT_FRAG,
    }),
  );
  RectAreaLightUniformsLib.init();
  const glow = new THREE.RectAreaLight(0x8899ff, 0, tvSpec.screenW, tvSpec.screenH);
  const glowColor = new THREE.Color(0.4, 0.45, 0.6);

  // A warm bias light behind the set, washing the wall.
  const bias = new THREE.PointLight(0xffc27a, 0, 900, 1);
  group.add(bias);

  let tv = null;
  let tvRoot = null; // the model's own root (its coordinates are the glTF file's)
  let screenMesh = null;
  let tvSet = false;
  // The TV sits a little left of centre on the table (room for the PS2 beside it); a whole set is
  // centred.
  const tvCenterX = () => (furniture !== 'table' || tvSet ? 0 : -lay.halfW + tvSpec.w / 2 + 70);
  let ps2 = null;
  let pad = null;
  let pad2 = null;
  let tray = null;
  let table = null;
  const pickables = [];
  if (assets.tv) {
    later(() => (mark('tvStart'), loadModel(assets.tv, (root) => (screenUv(root), shadows(root)))).then((root) => {
      mark('tv');
      // The model faces -z: turn it to face the room, then scale and stand it (fit).
      root.rotation.y = Math.PI;
      // A whole set (monitor, console, controllers: much wider than tall) stands at its real size;
      // a lone TV is scaled to TV_WIDTH.
      root.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      tvSet = raw.x > raw.y * 1.6;
      tv = tvSet ? fit(root, 0, 1000) : fit(root, TV_WIDTH);
      tv.updateMatrixWorld(true);
      const size = tv.userData.size;
      Object.assign(tvSpec, { w: size.x, h: size.y, d: size.z });
      tv.traverse((o) => {
        if (o.isMesh && o.userData.isScreen) screenMesh = o;
      });
      if (screenMesh) {
        screenMesh.material = crt;
        screenMesh.castShadow = false;
        const sb = new THREE.Box3().setFromObject(screenMesh);
        Object.assign(tvSpec, {
          screenX: (sb.min.x + sb.max.x) / 2,
          screenY: (sb.min.y + sb.max.y) / 2,
          screenW: sb.max.x - sb.min.x,
          screenH: sb.max.y - sb.min.y,
          screenFront: sb.max.z,
        });
      }
      // The tube's light rides with the TV: just in front of the glass, shining out (-z of the light).
      glow.width = tvSpec.screenW;
      glow.height = tvSpec.screenH;
      glow.position.set(tvSpec.screenX, tvSpec.screenY, tvSpec.screenFront + 4);
      glow.rotation.set(0, Math.PI, 0);
      tv.add(glow);
      group.add(tv);
      pickables.push(...collect(tv));
      setupConsole(root);
      tvRoot = root;
      arrange();
      if (placed) place(...placed);
      reveal(tv, glow);
    }));
  }
  if (assets.ps2) {
    later(() => (mark('ps2Start'), loadModel(assets.ps2, shadows)).then((root) => {
      mark('ps2');
      root.rotation.y = Math.PI; // the PlayStation faces -z, like the monitor
      ps2 = fit(root, 258);
      group.add(ps2);
      arrange();
      reveal(ps2);
    }));
  }
  if (assets.pad) {
    later(() => (mark('padStart'), loadModel(assets.pad, shadows)).then((root) => {
      mark('pad');
      root.rotation.y = Math.PI;
      pad = fit(root, 129);
      // The second controller is the same model, lying on the cloth.
      pad2 = pad.clone(true);
      group.add(pad, pad2);
      arrange();
      reveal(pad);
    }));
  }
  if (assets.tray && furniture === 'table') {
    later(() => (mark('trayStart'), loadModel(assets.tray, shadows)).then((root) => {
      mark('tray');
      tray = fit(root, 140);
      group.add(tray);
      arrange();
      reveal(tray);
    }));
  }
  if (furniture === 'table') {
    later(() => (mark('tableStart'), loadModel(assets.table, (root) => (litTable(root), shadows(root)))).then((root) => {
      mark('table');
      table = fit(root, TABLE_WIDTH);
      const s = table.userData.size;
      lay.top = s.y;
      table.scale.z = TABLE_DEPTH / s.z;
      lay.depth = TABLE_DEPTH;
      table.position.set(0, 0, lay.back + TABLE_DEPTH / 2);
      group.add(table);
      arrange();
      if (placed) place(...placed);
      reveal(table);
    }));
  }

  // Puts the TV, the PS2, the controller, the CD stack, the light and the contact shadows where they
  // belong for the furniture in use. Runs again as each model arrives.
  function arrange() {
    const T = lay.top;
    const tvZ = lay.back + 20 + tvSpec.d / 2;
    // On the table the TV sits a little left of centre, leaving room for the PS2 beside it.
    const tvX = tvCenterX();
    const front = lay.back + lay.depth;
    nContacts = 0;
    if (tv) {
      // Not quite square to the room: turned a touch, as if nudged when it was last plugged in (a
      // whole set's pieces are already knocked off true in the model, so the set itself barely turns).
      const turn = furniture === 'table' ? (tvSet ? -0.02 : 0.1) : 0;
      tv.position.set(tvX - (turn ? 6 : 0), T, tvZ + (turn ? 8 : 0));
      bias.position.set(tvX, T + tvSpec.h * 0.9, 60);
      tv.rotation.y = turn;
      // Under the monitor (a whole set's console and controllers get their own below).
      if (tvSet) contact(tvX + tvSpec.screenX, T + 0.3, tvZ - tvSpec.d / 2 + 250, 380, 500, 0.6);
      else contact(tvX, T + 0.3, tvZ, tvSpec.w + 15, tvSpec.d + 30, 0.6);
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
      if (pad2) {
        // The other one lies on the cloth in the gap between the monitor and the console.
        pad2.position.set(70, T, front - 120);
        pad2.rotation.set(0, -0.45, 0);
        const ps = pad2.userData.size;
        contact(pad2.position.x, T + 0.35, pad2.position.z, ps.x + 20, ps.z + 20, 0.55);
      }
    }
    // The ashtray, on the cloth in front of the monitor.
    if (tray && furniture === 'table') {
      const s = tray.userData.size;
      if (tvSet) tray.position.set(tvX + tvSpec.screenX - 27, T, front - 163);
      else tray.position.set(-150, T, front - 72);
      tray.rotation.y = 0.87;
      contact(tray.position.x, T + 0.35, tray.position.z, s.x + 24, s.z + 24, 0.6);
    }
    stack.visible = furniture === 'stand';
    // With a whole set, the board hangs just right of the monitor (its centre is boardX).
    boardX = tvSet ? tvX + tvSpec.screenX + tvSpec.screenW / 2 + 60 + 240 : BOARD_X;
    if (board) {
      // Hung by hand on one nail: not quite level.
      board.group.position.set(boardX, T + 40, 3);
      board.group.rotation.z = -0.018;
    }
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

  // The PlayStation: its lid opens on its hinge (the model's ps1_lid node and the extras
  // tools/optimize.py writes on it), and it holds a disc, the playing album's or playlist's, on its
  // spindle. Opening the lid pauses the music, as on the real thing; closing it plays on.
  const ps1 = {
    lid: null,
    rest: null, // the lid node's own matrix, closed
    pivot: new THREE.Vector3(),
    axis: new THREE.Vector3(1, 0, 0),
    angle: 0,
    open: 0, // 0 closed .. 1 open, as shown
    target: 0,
    meshes: [],
    disc: null, // { mesh, uri }
    discY: 0, // the disc's lift above the spindle, 0..1 (1 = out above the console)
    discTarget: 0,
    seq: null, // the running insert animation
    speed: 1,
    lidChanged: null,
  };
  const _lidA = new THREE.Matrix4();
  const _lidB = new THREE.Matrix4();
  const _lidQ = new THREE.Quaternion();
  function setupConsole(root) {
    const lid = root.getObjectByName('ps1_lid');
    const x = lid?.userData;
    if (!lid || !x?.cds_hinge_axis) return;
    ps1.lid = lid;
    lid.matrixAutoUpdate = false;
    lid.updateMatrix();
    ps1.rest = lid.matrix.clone();
    ps1.pivot.fromArray(x.cds_hinge_pivot);
    ps1.axis.fromArray(x.cds_hinge_axis).normalize();
    ps1.angle = x.cds_open_angle;
    ps1.spindle = new THREE.Vector3().fromArray(x.cds_spindle);
    root.traverse((o) => o.isMesh && /^ps1_(body|details|lid)/.test(o.material?.name || '') && ps1.meshes.push(o));
    ps1.root = root;
  }
  function poseLid() {
    // Rotate the closed lid about the hinge, in the model's own space: T(p) R T(-p) M.
    _lidQ.setFromAxisAngle(ps1.axis, ps1.angle * ease(ps1.open));
    _lidA.makeTranslation(ps1.pivot.x, ps1.pivot.y, ps1.pivot.z).multiply(_lidB.makeRotationFromQuaternion(_lidQ));
    _lidA.multiply(_lidB.makeTranslation(-ps1.pivot.x, -ps1.pivot.y, -ps1.pivot.z)).multiply(ps1.rest);
    ps1.lid.matrix.copy(_lidA);
    ps1.lid.matrixWorldNeedsUpdate = true;
  }
  const ease = (u) => u * u * (3 - 2 * u);

  // A CD printed with the cover: a ring, its planar UVs putting the cover's middle on the label.
  const discGeo = own(new THREE.RingGeometry(0.0075, 0.06, 64, 1));
  discGeo.rotateX(-Math.PI / 2);
  const discUnder = own(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 }));
  async function discFor(item) {
    const urls = [item?.art, item?.thumb].filter(Boolean);
    let tex = null;
    if (urls.length) {
      try {
        const { blob } = await loadCover(urls, item.name || '', { within: 4000 });
        const bmp = await createImageBitmap(blob);
        tex = own(new THREE.Texture(bmp));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.needsUpdate = true;
      } catch {}
    }
    const top = own(new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xdedede, metalness: 0.25, roughness: 0.38 }));
    const mesh = new THREE.Group();
    const face = new THREE.Mesh(discGeo, top);
    face.position.y = 0.0006;
    const under = new THREE.Mesh(discGeo, discUnder);
    under.rotation.x = Math.PI;
    mesh.add(face, under);
    mesh.position.copy(ps1.spindle);
    mesh.position.y += 0.002;
    mesh.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = false));
    return mesh;
  }
  function placeDisc() {
    if (!ps1.disc) return;
    const u = ease(ps1.discY);
    const m = ps1.disc.mesh;
    m.position.copy(ps1.spindle);
    m.position.y += 0.002 + u * 0.16;
    m.position.z -= u * 0.05;
    m.rotation.set(-u * 0.5, u * 0.6, 0);
    m.visible = ps1.open > 0.02 || ps1.discY > 0.001;
  }
  function setLid(open, { quiet = false } = {}) {
    if (!ps1.lid) return;
    ps1.target = open ? 1 : 0;
    if (!quiet) ps1.lidChanged?.(open);
    onChange?.();
  }
  // Animates a disc for `item` into the console; resolves when the lid is shut again.
  async function insertDisc(item) {
    if (!ps1.lid) return;
    const run = (ps1.seq = {});
    const wait = (ms) => new Promise((r) => setTimeout(r, ms / ps1.speed));
    const next = discFor(item);
    setLid(true, { quiet: true });
    await wait(650);
    if (ps1.disc && run === ps1.seq) {
      ps1.discTarget = 1;
      await wait(500);
      ps1.root.remove(ps1.disc.mesh);
      ps1.disc = null;
    }
    const mesh = await next;
    if (run !== ps1.seq) return;
    ps1.disc = { mesh, uri: item.uri };
    ps1.root.add(mesh);
    ps1.discY = 1;
    ps1.discTarget = 0;
    placeDisc();
    await wait(750);
    setLid(false, { quiet: true });
    await wait(550);
    screen.staticUntil = t + 0.6;
    screen.osdUntil = t + 4;
    onChange?.();
  }
  // The disc for whatever is playing, swapped without a show (the lid is shut, so unseen).
  async function holdDisc(item) {
    if (!ps1.lid || !item || ps1.disc?.uri === item.uri || ps1.seq?.busy) return;
    const mesh = await discFor(item);
    if (ps1.disc) ps1.root.remove(ps1.disc.mesh);
    ps1.disc = { mesh, uri: item.uri };
    ps1.root.add(mesh);
    placeDisc();
  }
  function stepConsole(dt) {
    if (!ps1.lid) return false;
    const k = 1 - Math.exp(-dt * 7 * ps1.speed);
    const moving = Math.abs(ps1.target - ps1.open) > 0.001 || Math.abs(ps1.discTarget - ps1.discY) > 0.001;
    if (!moving) return false;
    ps1.open += (ps1.target - ps1.open) * k;
    ps1.discY += (ps1.discTarget - ps1.discY) * (1 - Math.exp(-dt * 5 * ps1.speed));
    if (Math.abs(ps1.target - ps1.open) <= 0.001) ps1.open = ps1.target;
    if (Math.abs(ps1.discTarget - ps1.discY) <= 0.001) ps1.discY = ps1.discTarget;
    poseLid();
    placeDisc();
    return true;
  }

  function collect(root) {
    const out = [];
    root.traverse((o) => o.isMesh && out.push(o));
    return out;
  }

  // The lyrics whiteboard on the wall to the right of the TV (with the table).
  let board = null;
  let lyricsMode = 'write';
  if (assets.board && furniture === 'table' && lyricsFor && getProgress) {
    later(() => {
      board = createWhiteboard({ own, loader: { loadAsync: (u) => loadModel(u).then((scene) => ({ scene })) }, asset: assets.board, font: assets.font, fontAlt: assets.fontAlt, lyricsFor, getProgress, onReady: () => (arrange(), placed && place(...placed), reveal(board.group)) });
      group.add(board.group);
      board.setMode(lyricsMode);
      if (screen.info) board.setTrack(screen.info);
    });
  }
  const BOARD_X = 40 + 240; // its left edge clears the TV; it hangs just under the shelf
  let boardX = BOARD_X;

  // ---- What's on: Canvas video when the track has one, else the album art panning slowly. ----
  // The front panel: picture settings, the level bar showing, and the power switch.
  const pic = loadPicture();
  let bar = null; // { label, value, until }
  let userOff = false;
  function applyPicture() {
    crt.uniforms.uAdjust.value.set(pic.bright, pic.contrast, pic.chroma, pic.phase);
    crt.uniforms.uAperture.value = pic.aperture;
  }
  function showBar(label, value) {
    bar = { label, value: Math.min(1, Math.max(0, value)), until: t + 2.2 };
    redrawOsd();
    onChange?.();
  }
  // Press a panel control. Volume is the player's: `volume` reads and sets it (0..1).
  function press(control, volume) {
    if (control === 'power') {
      userOff = !userOff;
      if (!userOff) screen.staticUntil = t + 0.35;
      onChange?.();
      return;
    }
    if (control === 'reset') {
      for (const [k, v] of Object.entries(PICTURE)) pic[k] = v[3];
      applyPicture();
      try {
        localStorage.removeItem(PICTURE_KEY);
      } catch {}
      showBar(tr('panelReset'), 0.5);
      return;
    }
    const id = control.slice(0, -1);
    const dir = control.endsWith('+') ? 1 : -1;
    if (id === 'vol') {
      const v = Math.min(1, Math.max(0, Math.round(((volume?.get() ?? 0.5) + dir * 0.1) * 10) / 10));
      volume?.set(v);
      return showBar(tr('panelVol'), v);
    }
    const [step, lo, hi] = PICTURE[id];
    pic[id] = Math.min(hi, Math.max(lo, +(pic[id] + dir * step).toFixed(3)));
    applyPicture();
    try {
      localStorage.setItem(PICTURE_KEY, JSON.stringify(pic));
    } catch {}
    showBar(tr(`panel_${id}`), (pic[id] - lo) / (hi - lo));
  }
  applyPicture();
  // Where the pointer is on the TV's screen (OSD coordinates), while it's over the TV.
  let tvPointer = null;
  let osdAt = 0;
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
    redrawOsd();
  }
  function redrawOsd() {
    const zone = tvPointer && tvZone(tvPointer.x, tvPointer.y);
    const controls = tvPointer && screen.info
      ? { hover: zone?.zone, hoverFrac: zone?.frac, paused: screen.paused, progress: getProgress?.() || 0, duration: screen.info.duration || 0 }
      : null;
    if (bar && t > bar.until) bar = null;
    drawOsd(osdCanvas, { name: screen.info?.name, artist: screen.info?.artist, paused: screen.paused, channel: screen.channel, controls, bar });
    osdTex.needsUpdate = true;
  }

  let tvLight = true;
  // Returns true while the corner itself is still moving (so the shelf keeps shadows fresh).
  function update(dt, time, inView = true) {
    t = time;
    const consoleMoving = stepConsole(dt);
    if (state.y === null) state.y = state.targetY;
    const moving = Math.abs(state.targetY - state.y) > 0.05;
    state.y += (state.targetY - state.y) * (1 - Math.exp(-dt * 5));
    group.position.y = state.y;
    // Off screen, the TV's light and picture do nothing: skip them (and the light's shading cost).
    // Off screen, the TV's light does nothing. The area light (the costly one) is switched off there;
    // its shader variant is pre-compiled (see prewarm). The bias light just dims, which keeps the
    // scene's light count, and with it every material's shader, unchanged.
    glow.visible = tvLight && inView && screen.power > 0.01;
    bias.intensity = inView && tv ? 2.2 : 0;
    if (!inView) return moving || consoleMoving;
    board?.update(time, inView, screen.info?.duration);

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

    const on = screen.kind !== 'off' && !userOff;
    screen.power += ((on ? 1 : 0) - screen.power) * (1 - Math.exp(-dt * 6));
    const u = crt.uniforms;
    u.uTime.value = time;
    u.uPower.value = screen.power;
    u.uStatic.value = Math.max(time < screen.staticUntil ? 1 : 0, kindNow === 'none' ? 0.35 : 0, u.uStatic.value * Math.exp(-dt * 9));
    if (tvPointer && time - osdAt > 0.12) {
      osdAt = time;
      redrawOsd();
    }
    if (bar && time > bar.until) redrawOsd();
    u.uOsdAlpha.value = screen.paused || tvPointer || bar ? 1 : Math.min(1, Math.max(0, (screen.osdUntil - time) / 0.6));
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
    const lit = (screen.power * (screen.paused ? 0.5 : 1) * (1 - crt.uniforms.uMotion.value * (0.08 - 0.08 * Math.sin(time * 57)))) * (u.uStatic.value > 0.5 ? 0.7 : 1);
    glow.color.lerp(u.uStatic.value > 0.5 ? STATIC_LIGHT : glowColor, 1 - Math.exp(-dt * 6));
    glow.intensity = 9 * lit;
    return moving || consoleMoving;
  }

  // Lays the corner out under a shelf whose bottom edge is at `shelfBottom`, against a wall at wallZ.
  let placed = null;
  function place(shelfBottom, wallZ) {
    placed = [shelfBottom, wallZ];
    // Whichever reaches higher, the TV or the whiteboard behind it, keeps clear of the shelf above.
    const boardTop = board ? 40 + board.size.y : 0;
    const standTop = shelfBottom - Math.max(GAP_UNDER_SHELF + tvSpec.h, boardTop + 45);
    state.targetY = standTop - lay.top;
    state.floorY = state.targetY;
    state.tvCenterY = state.targetY + lay.top + tvSpec.screenY;
    state.wallZ = wallZ;
    group.position.z = wallZ;
  }

  return {
    previewLyrics: (info, lyrics, ms) => board?.preview(info, lyrics, ms),
    boardSnapshot: () => board?.snapshot(),
    setLyricsMode: (mode) => {
      lyricsMode = mode;
      board?.setMode(mode);
    },
    group,
    place,
    update,
    // What the close-up has to fit across: the TV and whatever stands beside it, at the TV's front.
    get frame() {
      const tvX = tvCenterX();
      const left = tvX - tvSpec.w / 2 - 40;
      const right = furniture === 'table' ? Math.max(lay.halfW + 10, board ? boardX + 240 + 25 : 0) : tvX + tvSpec.w / 2 + 40;
      return { x: (left + right) / 2, halfW: (right - left) / 2, z: state.wallZ + lay.back + 20 + tvSpec.d };
    },
    get tvHeight() {
      return tvSpec.h;
    },
    get standTopY() {
      return state.targetY + lay.top;
    },
    setTrack,
    setStack,
    // True while the TV is on: its picture never fully stops (flicker, rolling bar, video).
    get alive() {
      return !!tv && (screen.kind !== 'off' || screen.power > 0.01);
    },
    setTvLight(on) {
      tvLight = on;
    },
    get halfW() {
      return lay.halfW + 40;
    },
    get screen() {
      return { timing, board: board?.current, live: screen.live, hasMirrorTex: !!mirror.tex, mirror: mirror.el ? { w: mirror.el.videoWidth, h: mirror.el.videoHeight, paused: mirror.el.paused } : null, kind: screen.kind, track: screen.track, paused: screen.paused, video: screen.video ? { w: screen.video.videoWidth, h: screen.video.videoHeight, t: +screen.video.currentTime.toFixed(2), paused: screen.video.paused } : null };
    },
    get floorY() {
      return state.floorY;
    },
    get tvCenterY() {
      return state.tvCenterY;
    },
    // The front panel control under the ray ('vol+', 'bright-', 'power', …), or null.
    panelControl(raycaster) {
      const hit = pickables.length > 0 && tvRoot && raycaster.intersectObjects(pickables, false)[0];
      return hit && !ps1.meshes.includes(hit.object) ? panelAt(tvRoot.worldToLocal(hit.point.clone())) : null;
    },
    press,
    // Debug: a point in the TV model's own coordinates, in the room.
    tvToWorld: (x, y, z) => (tvRoot ? tvRoot.localToWorld(new THREE.Vector3(x, y, z)) : null),
    // Debug: where the ray hits the TV set, in the model's own coordinates (for mapping its panel).
    probeTv(raycaster) {
      const hit = pickables.length > 0 && raycaster.intersectObjects(pickables, false)[0];
      if (!hit || !tvRoot) return null;
      const p = tvRoot.worldToLocal(hit.point.clone());
      return { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), mat: hit.object.material?.name };
    },
    // True when the ray hits the TV (the monitor, not the console in front of it).
    hitsTv(raycaster) {
      const hit = pickables.length > 0 && raycaster.intersectObjects(pickables, false)[0];
      return !!hit && !ps1.meshes.includes(hit.object);
    },
    // The PlayStation: whether the ray hits it, its lid, and putting discs in.
    hitsConsole(raycaster) {
      const hit = ps1.meshes.length > 0 && raycaster.intersectObjects(pickables, false)[0];
      return !!hit && ps1.meshes.includes(hit.object);
    },
    get hasConsole() {
      return !!ps1.lid;
    },
    get lidOpen() {
      return ps1.target > 0.5;
    },
    toggleLid() {
      setLid(ps1.target < 0.5);
    },
    insertDisc,
    holdDisc,
    onLidChange(fn) {
      ps1.lidChanged = fn;
    },
    setSpeed(sp) {
      ps1.speed = sp;
    },
    // What a click on the TV does: a control on the screen ({ zone: 'prev' | 'play' | 'next' |
    // 'seek', frac }), or play/pause anywhere else on the set. Null when the ray misses the TV.
    tvAction(raycaster) {
      if (!pickables.length) return null;
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit || ps1.meshes.includes(hit.object)) return null;
      const control = tvRoot && panelAt(tvRoot.worldToLocal(hit.point.clone()));
      if (control) return { zone: 'panel', control };
      const p = hit.object === screenMesh && hit.uv ? osdPoint(hit.uv) : null;
      return (p && tvZone(p.x, p.y)) || { zone: 'play' };
    },
    // The pointer over the TV (a raycaster) shows the controls; null hides them.
    pointTv(raycaster) {
      let next = null;
      if (raycaster && screenMesh) {
        const hit = raycaster.intersectObject(screenMesh, false)[0];
        if (hit?.uv) next = osdPoint(hit.uv);
      }
      const was = tvPointer;
      tvPointer = next;
      if (!!was !== !!next || (next && was && tvZone(next.x, next.y)?.zone !== tvZone(was.x, was.y)?.zone)) {
        redrawOsd();
        onChange?.();
      }
      return next ? tvZone(next.x, next.y) : null;
    },
    dispose() {
      mirror.tex?.dispose();
      dropSource();
      scene.remove(group);
    },
  };
}
