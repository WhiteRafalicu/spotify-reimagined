// The shelf itself, in three.js: jewel cases standing spine-out on wooden boards, lit by a warm
// key light with dust in it and a lamp that follows the pointer. Cases move on springs, so hovering,
// filtering and re-sorting all settle with a little life instead of snapping.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CASE, HALF, HINGE, lidGeometry, trayGeometry, withDetail } from './caseGeometry';
import { createCorner } from './corner';
import { COPY_FRAG, OUTPUT_FRAG, ROD_FRAG, ROD_VERT, ROOM_BAKE_FRAG, SCREEN_VERT, SHEET_FRAG, SHEET_VERT } from './shaders';

// Millimetres. Every case is the cd-case jewel case (146 square, 10.2 thick), stood on its edge
// with the hinge facing out: its local x runs into the shelf, local z across it.
const W = 10.2;
const H = CASE;
const D = CASE;
const GAP = 1.4;
const IOR = 1.59;
const ABSORB = [0.0042, 0.003, 0.0026];
const ROOM_SIZE = 256;
const BOOK_Z = 2.55;
const LABEL_X = -HALF - 0.35; // the spine strip, just outside the hinge-side rail
const STAND = new THREE.Matrix4().makeRotationY(Math.PI / 2);
const PITCH_X = W + GAP;
const BOARD = 14;
const ROW_PITCH = H + BOARD + 34;
const MARGIN = 40;
const FOV = 32;
const ROW_PX = 390; // roughly how tall one shelf row is on screen
const HEADER = 0.13; // fraction of the view the DOM header covers

const CLEAR_Z = D + 6; // how far a case slides out before it may turn
const SPRING_K = 170;
const SPRING_C = 20;
const PROPS = ['x', 'y', 'z', 'ry', 'rz', 's', 'lid'];

const SPINE_PX = [64, 1024];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function loadImage(url) {
  if (url.startsWith('data:')) {
    const img = new Image();
    img.src = url;
    return img.decode().then(() => img);
  }
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`cover ${r.status}`);
      return r.blob();
    })
    .then((b) => {
      const img = new Image();
      img.src = URL.createObjectURL(b);
      return img.decode().then(() => img);
    });
}

// A small queue, so a hundred covers don't all hit the network at once.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn()
      .then(res, rej)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((res, rej) => {
      queue.push({ fn, res, rej });
      next();
    });
}

function fitText(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + '…').width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function drawSpine(canvas, item, img) {
  const [w, h] = SPINE_PX;
  const g = canvas.getContext('2d');
  g.fillStyle = item.kind === 'playlist' ? '#3a3d44' : '#1c1c1f';
  g.fillRect(0, 0, w, h);
  if (img) {
    // The spine borrows the cover's left edge, stretched, so every spine wears its album's colours.
    g.drawImage(img, 0, 0, Math.max(2, img.naturalWidth * 0.1), img.naturalHeight, 0, 0, w, h);
  }
  g.fillStyle = item.kind === 'playlist' ? 'rgba(24,26,30,0.62)' : 'rgba(0,0,0,0.4)';
  g.fillRect(0, 0, w, h);
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(255,255,255,0.35)');
  edge.addColorStop(0.08, 'rgba(255,255,255,0.05)');
  edge.addColorStop(0.9, 'rgba(255,255,255,0)');
  edge.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);

  g.save();
  g.translate(w / 2, 0);
  g.rotate(Math.PI / 2);
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 3;
  const font = '"SpotifyMixUI", "CircularSp", "Helvetica Neue", Arial, sans-serif';
  g.font = `800 31px ${font}`;
  const artist = fitText(g, (item.artist || '').toUpperCase(), 330);
  g.fillStyle = '#fff';
  g.fillText(artist, 34, 1);
  const used = g.measureText(artist).width;
  g.font = `600 30px ${font}`;
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.fillText(fitText(g, item.name, h - 90 - used), 34 + used + 18, 1);
  g.restore();
}

// A seeded random, so the procedural wood looks the same every time the shelf is built.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Dark walnut: a colour map (sRGB) and a matching roughness map (linear data). Grain runs along u.
function walnutTextures(seed) {
  const W = 2048;
  const H = 256;
  const rand = rng(seed);
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const g = col.getContext('2d');
  const rough = document.createElement('canvas');
  rough.width = W;
  rough.height = H;
  const r = rough.getContext('2d');

  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#4a3122');
  base.addColorStop(0.5, '#3f2a1d');
  base.addColorStop(1, '#472f20');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  r.fillStyle = 'rgb(150,150,150)';
  r.fillRect(0, 0, W, H);

  // Long, gently wandering grain lines, some darker (late wood), some lighter (early wood).
  for (let i = 0; i < 230; i++) {
    const y0 = rand() * H;
    const dark = rand() < 0.62;
    const a = 0.05 + rand() * (dark ? 0.22 : 0.1);
    const lw = 0.4 + rand() * (dark ? 2.2 : 1.2);
    const f1 = 0.0012 + rand() * 0.003;
    const f2 = 0.006 + rand() * 0.01;
    const amp = 2 + rand() * 7;
    const ph = rand() * 10;
    g.strokeStyle = dark ? `rgba(18,10,6,${a})` : `rgba(120,86,58,${a})`;
    g.lineWidth = lw;
    r.strokeStyle = dark ? `rgba(200,200,200,${a * 1.4})` : `rgba(110,110,110,${a})`;
    r.lineWidth = lw;
    for (const ctx of [g, r]) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = y0 + Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 + ph * 2) * amp * 0.25;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // A couple of soft cathedral figures, so the boards don't read as straight stripes.
  for (let k = 0; k < 3; k++) {
    const cx = (0.15 + rand() * 0.7) * W;
    const cy = H * (0.3 + rand() * 0.4);
    for (let j = 0; j < 9; j++) {
      g.strokeStyle = `rgba(16,9,5,${0.06 + rand() * 0.06})`;
      g.lineWidth = 1 + rand();
      g.beginPath();
      g.ellipse(cx, cy, 120 + j * 34, 10 + j * 7, 0, Math.PI * 0.05, Math.PI * 0.95);
      g.stroke();
    }
  }
  // Pores: tiny dark dashes along the grain.
  for (let i = 0; i < 5200; i++) {
    const x = rand() * W;
    const y = rand() * H;
    g.fillStyle = `rgba(10,6,3,${0.18 + rand() * 0.25})`;
    g.fillRect(x, y, 2 + rand() * 5, 0.8);
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughness = new THREE.CanvasTexture(rough);
  roughness.colorSpace = THREE.NoColorSpace;
  for (const t of [map, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, roughness };
}

function wallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1816';
  g.fillRect(0, 0, 256, 256);
  const d = g.getImageData(0, 0, 256, 256);
  const rand = rng(7);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rand() - 0.5) * 6;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 12);
  return t;
}

// Contact shadow under one case, as a multiply mask (white = untouched): darkest right under the
// case's footprint, fading out over a few millimetres. The quad is (W + 12) × (D + 16) mm.
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 512);
  g.filter = 'blur(7px)';
  g.fillStyle = 'rgb(95,95,95)';
  g.fillRect(12, 16, 40, 486);
  g.filter = 'blur(2px)';
  g.fillStyle = 'rgb(28,28,28)';
  g.fillRect(18, 26, 28, 466);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Occlusion where two surfaces meet: dark at v = 0, gone by v = 1, eased.
function creaseTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  for (let i = 0; i <= 10; i++) {
    const v = i / 10;
    const k = Math.round(255 - 150 * Math.pow(1 - v, 2.2));
    grad.addColorStop(v, `rgb(${k},${k},${k})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Occlusion inside one shelf compartment on the back panel (v runs board-centre to board-centre).
function compartmentTexture(boardFrac) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 128, 256);
  const vert = g.createLinearGradient(0, 0, 0, 256);
  vert.addColorStop(0, 'rgba(0,0,0,0.75)');
  vert.addColorStop(boardFrac + 0.12, 'rgba(0,0,0,0.12)');
  vert.addColorStop(0.55, 'rgba(0,0,0,0)');
  vert.addColorStop(1 - boardFrac - 0.08, 'rgba(0,0,0,0.25)');
  vert.addColorStop(1, 'rgba(0,0,0,0.8)');
  g.fillStyle = vert;
  g.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,240,220,1)');
  r.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createShelf(container, { onPick, onHover, onTv, canvasFor, lyricsFor, getProgress, assets = {} }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'cds-shelf-canvas';
  container.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    canvas.remove();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.info.autoReset = false; // counted per frame across all passes (see perf)
  renderer.setClearColor(0x0e0d0c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  // Shadows are re-rendered only when something that casts them moves (see shadowDirty).
  renderer.shadowMap.autoUpdate = false;
  let shadowDirty = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e0d0c, 700, 1500);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 4000);

  const disposables = [envRT, pmrem];
  const own = (d) => (disposables.push(d), d);

  // Room: a wall behind the shelf, lit from the top left.
  const wall = new THREE.Mesh(
    own(new THREE.PlaneGeometry(6000, 6000)),
    own(new THREE.MeshStandardMaterial({ map: own(wallTexture()), roughness: 0.95 })),
  );
  wall.position.z = -D / 2 - 8;
  wall.receiveShadow = true;
  scene.add(wall);

  // Lighting. One warm-neutral key above and slightly in front of the shelf casts every shadow;
  // a cool, weak fill from the lower right keeps shadowed faces readable; hemisphere and room
  // environment supply restrained ambient. All of it is tuned for ACES at exposure 1.0.
  const LIGHT = {
    // Art deco: a warm gold key, a deep emerald-teal fill, low ambient so the brass picture lights
    // under each board (see deco) carve pools out of the dark.
    keyColor: 0xffdcaa,
    keyIntensity: 2.0,
    keyDir: new THREE.Vector3(-0.32, 0.95, 0.75).normalize(),
    fillColor: 0x3fa597,
    fillIntensity: 0.34,
    skyColor: 0x7d9690,
    groundColor: 0x2a1a10,
    hemiIntensity: 0.32,
    envIntensity: 0.22,
    pictureColor: 0xffc978,
    pictureIntensity: 2.6,
    shadowMap: 2048,
    shadowRadius: 9,
    shadowIntensity: 0.9,
    shadowBias: -0.00025,
    shadowNormalBias: 0.5,
  };
  scene.environmentIntensity = LIGHT.envIntensity;
  scene.add(new THREE.HemisphereLight(LIGHT.skyColor, LIGHT.groundColor, LIGHT.hemiIntensity));
  const key = new THREE.DirectionalLight(LIGHT.keyColor, LIGHT.keyIntensity);
  key.castShadow = true;
  key.shadow.mapSize.set(LIGHT.shadowMap, LIGHT.shadowMap);
  key.shadow.radius = LIGHT.shadowRadius;
  key.shadow.intensity = LIGHT.shadowIntensity;
  key.shadow.bias = LIGHT.shadowBias;
  key.shadow.normalBias = LIGHT.shadowNormalBias;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 4000;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(LIGHT.fillColor, LIGHT.fillIntensity);
  fill.position.set(0.6, -0.15, 1).multiplyScalar(1000);
  scene.add(fill);
  // A small warm lamp that follows the pointer, and settles on whatever case is being looked at.
  const lamp = new THREE.PointLight(0xffd6a8, 0, 300, 1);
  scene.add(lamp);

  const fx = new THREE.Scene();

  // Dust drifting through the key light.
  const DUST = 360;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 1400;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 700;
    dustPos[i * 3 + 2] = -40 + Math.random() * 380;
    dustSeed[i] = Math.random() * 100;
  }
  const dustGeo = own(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    own(
      new THREE.PointsMaterial({
        size: 2.2,
        map: own(dotTexture()),
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  dust.frustumCulled = false;
  fx.add(dust);

  // Glass: the cd-case tray and lid, shared by every case and drawn instanced with the original
  // refraction shaders. Each frame the opaque room (shelf, booklets, spine labels, discs) is drawn
  // first; the glass then refracts a copy of it, depth-tested against the same frame.
  const hdrType =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
  const rtMain = own(new THREE.WebGLRenderTarget(1, 1, { type: hdrType, samples: 4 }));
  const rtBehind = own(new THREE.WebGLRenderTarget(1, 1, { type: hdrType, depthBuffer: false }));
  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = own(new THREE.PlaneGeometry(2, 2));
  const pass = (frag, uniforms) => {
    const material = own(
      new THREE.ShaderMaterial({ uniforms, vertexShader: SCREEN_VERT, fragmentShader: frag, depthTest: false, depthWrite: false }),
    );
    const sc = new THREE.Scene();
    const m = new THREE.Mesh(quad, material);
    m.frustumCulled = false;
    sc.add(m);
    return { scene: sc, material };
  };
  const copy = pass(COPY_FRAG, { uTex: { value: rtMain.texture } });
  const output = pass(OUTPUT_FRAG, { uTex: { value: rtMain.texture } });
  const roomRT = own(
    new THREE.WebGLCubeRenderTarget(ROOM_SIZE, {
      type: hdrType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    }),
  );
  const bake = pass(ROOM_BAKE_FRAG, { uFace: { value: 0 }, uSize: { value: ROOM_SIZE } });
  bake.material.defines = { ROOM_GAIN: '0.22' };
  const bakeRoom = () => {
    for (let f = 0; f < 6; f++) {
      bake.material.uniforms.uFace.value = f;
      renderer.setRenderTarget(roomRT, f);
      renderer.render(bake.scene, screenCam);
    }
    renderer.setRenderTarget(null);
  };
  bakeRoom();

  const glass = new THREE.Scene();
  const rodMat = own(
    new THREE.ShaderMaterial({
      uniforms: {
        uBehind: { value: rtBehind.texture },
        uRoom: { value: roomRT.texture },
        uRoomSize: { value: ROOM_SIZE },
        uProj: { value: camera.projectionMatrix },
        uDepth: { value: 14 },
        uIor: { value: IOR },
        uSamples: { value: 1 },
        uAbsorb: { value: new THREE.Vector3(...ABSORB) },
      },
      vertexShader: ROD_VERT,
      fragmentShader: ROD_FRAG,
    }),
  );
  const sheetMat = own(
    new THREE.ShaderMaterial({
      uniforms: { uIor: { value: IOR }, uAbsorb: { value: new THREE.Vector3(...ABSORB) } },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  );
  // The shelf is seen from afar, so it uses a lighter build of the same case (39k triangles, not 99k).
  const trayParts = withDetail(2, trayGeometry);
  const lidParts = withDetail(2, lidGeometry);
  for (const g of [trayParts.rods, trayParts.sheets, lidParts.rods, lidParts.sheets]) own(g);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let capacity = 0;
  let inst = null;
  let instList = [];
  let parts = null;
  let coverArr = null;
  let spineArr = null;
  const COVER_PX = 192;
  const arrUniforms = { cover: { value: null }, spine: { value: null } };
  // A texture array of `depth` layers, keeping the layers of `old` when it grows.
  function makeArray(w, h, depth, old, fill) {
    const data = new Uint8Array(w * h * 4 * depth);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = 255;
    }
    if (old) data.set(old.image.data.subarray(0, Math.min(old.image.data.length, data.length)));
    const tex = new THREE.DataArrayTexture(data, w, h, depth);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    old?.dispose();
    return tex;
  }
  const layerCanvas = document.createElement('canvas');
  const layerCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
  function writeLayer(tex, layer, src) {
    const { width: w, height: h } = tex.image;
    layerCanvas.width = w;
    layerCanvas.height = h;
    layerCtx.drawImage(src, 0, 0, w, h);
    tex.image.data.set(layerCtx.getImageData(0, 0, w, h).data, layer * w * h * 4);
    tex.addLayerUpdate(layer);
    tex.needsUpdate = true;
  }
  // MeshStandardMaterial reading its colour (and optionally emission) from a texture array layer.
  const unitTex = own(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
  unitTex.needsUpdate = true;
  const arrayMaterial = (which, params, emissive = false) => {
    const m = own(new THREE.MeshStandardMaterial({ ...params, map: unitTex }));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uArr = arrUniforms[which];
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'flat varying int vLayer;\nvoid main() {\n  vLayer = gl_InstanceID;');
      let f = sh.fragmentShader
        .replace('void main() {', 'precision highp sampler2DArray;\nuniform sampler2DArray uArr;\nflat varying int vLayer;\nvoid main() {')
        .replace('#include <map_fragment>', 'vec4 arrTexel = texture(uArr, vec3(vMapUv.x, 1.0 - vMapUv.y, float(vLayer)));\n  diffuseColor *= arrTexel;');
      if (emissive) f = f.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= arrTexel.rgb;');
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => `cds-array-${which}-${emissive}`;
    return m;
  };
  let capGen = 0;
  function ensureCapacity(n) {
    if (n <= capacity) return;
    capacity = Math.max(128, 2 ** Math.ceil(Math.log2(n)));
    if (inst) for (const m of Object.values(inst)) (glass.remove(m), m.dispose());
    const make = (geo, mat, order) => {
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.frustumCulled = false;
      m.renderOrder = order;
      for (let i = 0; i < capacity; i++) m.setMatrixAt(i, ZERO);
      glass.add(m);
      return m;
    };
    if (contacts) (scene.remove(contacts), contacts.dispose());
    contacts = new THREE.InstancedMesh(quadGeo, contactMat, capacity);
    contacts.frustumCulled = false;
    contacts.renderOrder = 1;
    for (let i = 0; i < capacity; i++) {
      contacts.setMatrixAt(i, ZERO);
      contacts.setColorAt(i, _k.setRGB(0, 0, 0));
    }
    scene.add(contacts);
    inst = {
      trayRods: make(trayParts.rods, rodMat, 0),
      lidRods: make(lidParts.rods, rodMat, 0),
      traySheets: make(trayParts.sheets, sheetMat, 1),
      lidSheets: make(lidParts.sheets, sheetMat, 1),
    };
    // The parts inside the cases, also instanced: each instance reads its own layer of the cover
    // and spine texture arrays (layer = instance index = case slot).
    coverArr = makeArray(COVER_PX, COVER_PX, capacity, coverArr, [44, 44, 46]);
    spineArr = makeArray(SPINE_PX[0], SPINE_PX[1], capacity, spineArr, [28, 28, 31]);
    arrUniforms.cover.value = coverArr;
    arrUniforms.spine.value = spineArr;
    if (parts) for (const m of Object.values(parts)) (scene.remove(m), m.dispose());
    const part = (geo, mat, receive) => {
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = receive;
      for (let i = 0; i < capacity; i++) m.setMatrixAt(i, ZERO);
      scene.add(m);
      return m;
    };
    parts = {
      book: part(bookGeo, coverMat, true),
      label: part(labelGeo, labelMat, false),
      print: part(discGeo, printMat, false),
      under: part(discGeo, discUnder, false),
    };
    instList = [...Object.values(inst), ...Object.values(parts)];
    capGen++; // every case rewrites itself into the new buffers (see step)
  }
  let nextSlot = 0;

  // What sits inside each case: the booklet under the lid, the spine of the back inlay just inside
  // the hinge-side rail, and the disc printed with the cover.
  const bookGeo = own(new THREE.PlaneGeometry(132, 132));
  const labelGeo = own(new THREE.PlaneGeometry(9.4, CASE - 6));
  const discGeo = own(new THREE.RingGeometry(15, 59.5, 72, 1));
  const discUnder = own(
    new THREE.MeshPhysicalMaterial({
      color: 0xd8dde4,
      metalness: 1,
      roughness: 0.18,
      iridescence: 1,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [250, 700],
      side: THREE.BackSide,
    }),
  );
  const coverMat = arrayMaterial('cover', { roughness: 0.5 });
  const printMat = arrayMaterial('cover', { roughness: 0.4, metalness: 0.1 });
  const labelMat = arrayMaterial('spine', { color: 0xa0a0a0, emissive: 0x4a4a4a, roughness: 0.7 }, true);
  // Where each part sits in its case (cd-case coordinates).
  const BOOK_M = new THREE.Matrix4().makeTranslation(0, 0, BOOK_Z);
  const LABEL_M = new THREE.Matrix4().makeTranslation(LABEL_X, 0, -0.1).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  const PRINT_M = new THREE.Matrix4().makeTranslation(0, 0, -1.2);
  const UNDER_M = new THREE.Matrix4().makeTranslation(0, 0, -2.4);
  const _pm = new THREE.Matrix4();
  const hitGeo = own(new THREE.BoxGeometry(CASE, CASE, 10.4).translate(0, 0, -0.1));
  const hitMat = own(new THREE.MeshBasicMaterial());
  const _m = new THREE.Matrix4();
  const _lid = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const hingeIn = new THREE.Matrix4().makeTranslation(HINGE.x, 0, HINGE.z);
  const hingeOut = new THREE.Matrix4().makeTranslation(-HINGE.x, 0, -HINGE.z);
  const _r = new THREE.Matrix4();
  // The shelf unit: oiled walnut boards with rounded edges, one continuous side panel per side,
  // a top board, and a back panel whose compartments carry baked occlusion.
  const DEPTH = D + 26;
  const BACK_Z = -DEPTH / 2;
  const walnutH = walnutTextures(11);
  const walnutV = walnutTextures(29);
  for (const t of [walnutH.map, walnutH.roughness, walnutV.map, walnutV.roughness]) own(t);
  for (const t of [walnutV.map, walnutV.roughness]) {
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
  }
  const woodFinish = { roughness: 1, metalness: 0, clearcoat: 0.14, clearcoatRoughness: 0.42, specularIntensity: 0.45 };
  const boardMat = own(new THREE.MeshPhysicalMaterial({ map: walnutH.map, roughnessMap: walnutH.roughness, ...woodFinish }));
  const sideMat = own(new THREE.MeshPhysicalMaterial({ map: walnutV.map, roughnessMap: walnutV.roughness, ...woodFinish }));
  const backMap = own(walnutV.map.clone());
  backMap.needsUpdate = true;
  const compartAO = own(compartmentTexture(BOARD / 2 / ROW_PITCH));
  const backMat = own(
    new THREE.MeshStandardMaterial({ map: backMap, color: 0x8c8580, roughness: 0.85, aoMap: compartAO, aoMapIntensity: 1 }),
  );
  const BOARD_REF = 400;
  const boardGeo = own(new RoundedBoxGeometry(BOARD_REF, BOARD, DEPTH, 3, 1.6));
  const sideGeo = own(new RoundedBoxGeometry(BOARD, BOARD_REF, DEPTH, 3, 1.6));
  const backGeo = own(new THREE.BoxGeometry(1, 1, 4));
  const sides = [-1, 1].map(() => {
    const m = new THREE.Mesh(sideGeo, sideMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  });
  const back = new THREE.Mesh(backGeo, backMat);
  back.receiveShadow = true;
  scene.add(back);

  // Contact shadows and creases are multiply decals: one instanced draw for all the cases, one for
  // every crease in the unit. They darken what's under them and fade out; no extra shadow passes.
  const decalMat = (map) =>
    own(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: map } },
        vertexShader: `
          varying vec2 vUv;
          varying float vK;
          void main() {
            vUv = uv;
            #ifdef USE_INSTANCING_COLOR
              vK = instanceColor.r;
            #else
              vK = 1.0;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vK;
          void main() {
            gl_FragColor = vec4(vec3(mix(1.0, texture2D(uMap, vUv).r, vK)), 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
    );
  const quadGeo = own(new THREE.PlaneGeometry(1, 1));
  const contactMat = decalMat(own(contactTexture()));
  const creaseMat = decalMat(own(creaseTexture()));
  let contacts = null;
  let creases = null;
  const _u = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _dm = new THREE.Matrix4();
  // Orients the unit quad so its u axis runs along `u` (length wu) and v = 0 sits on the crease,
  // running out along `v` (length wv).
  function decalMatrix(out, crease, u, v, wu, wv) {
    _n.crossVectors(u, v);
    _c.copy(crease).addScaledVector(v, wv / 2);
    return out.makeBasis(_u.copy(u).multiplyScalar(wu), _w.copy(v).multiplyScalar(wv), _n).setPosition(_c);
  }
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const NX = new THREE.Vector3(-1, 0, 0);
  const NY = new THREE.Vector3(0, -1, 0);
  const _k = new THREE.Color();
  wall.position.z = BACK_Z - 7;
  ensureCapacity(1);

  // The TV corner under the shelf (only when the build bundled its models).
  const corner =
    assets.tv || assets.ps2 || assets.pad || assets.table
      ? createCorner({
          scene,
          own,
          boardMat,
          sideMat,
          walnutCanvas: walnutH.map.image,
          contactMat,
          quadGeo,
          assets,
          lyricsFor,
          getProgress,
          onChange: () => {
            shadowDirty = true;
            wake();
          },
          // Compile shaders with the TV's light both on and off, so scrolling to it doesn't hitch.
          prewarm: (light) => {
            const was = light.visible;
            light.visible = !was;
            renderer.compile(scene, camera);
            light.visible = was;
          },
        })
      : null;

  // The key's shadow camera hugs the shelf unit and the rows in view.
  function fitShadow() {
    const sc = key.shadow.camera;
    const halfW = Math.max(unit.halfW, corner?.halfW ?? 0) + 50;
    const halfH = (view.visH * 0.75 + 110) * (1 + DOLLY * dollyF);
    sc.left = -halfW;
    sc.right = halfW;
    sc.top = halfH;
    sc.bottom = -halfH;
    sc.updateProjectionMatrix();
    shadowDirty = true;
  }

  const ledMat = own(new THREE.MeshBasicMaterial({ color: 0x1ed760 }));
  const led = new THREE.Mesh(own(new THREE.SphereGeometry(1.3, 12, 8)), ledMat);
  led.position.set(-HALF - 0.9, -HALF + 10, -0.1); // on the spine, near the bottom
  const ledLight = new THREE.PointLight(0x1ed760, 0, 70, 1);
  ledLight.position.set(-HALF - 12, -HALF + 12, 0);

  const cases = new Map(); // uri -> case
  const boards = [];
  // Brass picture-light bars along the front underside of each board, glowing warm underneath.
  const deco = {
    brass: own(new THREE.MeshStandardMaterial({ color: 0xc19a5b, metalness: 1, roughness: 0.3 })),
    glowMat: own(new THREE.MeshBasicMaterial({ color: new THREE.Color(LIGHT.pictureColor).multiplyScalar(3.2) })),
    barGeo: own(new RoundedBoxGeometry(BOARD_REF, 5, 7, 2, 1.2)),
    stripGeo: own(new THREE.BoxGeometry(BOARD_REF, 0.8, 2.2)),
    bars: [],
    lights: [],
  };
  // Two pools per row, for the three rows nearest the camera.
  for (let i = 0; i < 6; i++) {
    const l = new THREE.PointLight(LIGHT.pictureColor, LIGHT.pictureIntensity, 330, 1.1);
    scene.add(l);
    deco.lights.push(l);
  }
  const unit = { halfW: 200, top: 0, bottom: 0 };
  const loadCover = limiter(6);
  let order = [];
  let perRow = 1;
  let rowCount = 0;
  let view = { w: 1, h: 1, dist: 800, visW: 1, visH: 1 };
  const cam = { y: 0, target: 0, x: 0 };
  const pointer = { x: 0, y: 0, over: false, ndc: new THREE.Vector2(-9, -9) };
  let hovered = null;
  let pulled = null;
  let live = null;
  let paused = false;
  // Frame throttling state (see tick): busy = something moved last frame; activeAt = last input.
  let busy = true;
  let activeAt = performance.now();
  const wake = () => (activeAt = performance.now());
  let disposed = false;
  let raf = 0;
  let last = 0;
  let t = 0;

  function makeCase(item) {
    const slot = nextSlot++;
    ensureCapacity(nextSlot);
    // The spine (title text now, the cover's colours once it loads) and the cover, into this
    // case's layer of the texture arrays.
    drawSpine(spineScratch, item, null);
    writeLayer(spineArr, slot, spineScratch);

    // Groups hold the case's pose (cd-case coordinates), for the live LED to ride on.
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const lidGroup = new THREE.Group();
    lidGroup.matrixAutoUpdate = false;
    scene.add(group, lidGroup);

    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.matrixAutoUpdate = false;

    const c = {
      item,
      slot,
      group,
      lidGroup,
      hit,
      cur: { x: 0, y: 600, z: 0, ry: 0, rz: 0, s: 1, lid: 0 },
      vel: { x: 0, y: 0, z: 0, ry: 0, rz: 0, s: 0, lid: 0 },
      target: { x: 0, y: 0, z: 0, ry: 0, rz: 0, s: 1, lid: 0 },
      home: { x: 0, y: 0 },
      index: -1,
      gone: false,
    };
    hit.userData.case = c;
    c.ready = loadCover(() => loadImage(item.thumb))
      .then((img) => {
        if (disposed) return;
        drawSpine(spineScratch, item, img);
        writeLayer(spineArr, c.slot, spineScratch);
        writeLayer(coverArr, c.slot, img);
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      })
      .catch(() => {});
    return c;
  }
  const spineScratch = document.createElement('canvas');
  [spineScratch.width, spineScratch.height] = SPINE_PX;

  function layout() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtMain.setSize(size.x, size.y);
    rtBehind.setSize(size.x, size.y);
    camera.aspect = w / h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const visH = ROW_PITCH * clamp(h / ROW_PX, 1.8, 6);
    const dist = visH / 2 / tanHalf + D / 2;
    const visW = 2 * (dist - D / 2) * tanHalf * camera.aspect;
    view = { w, h, dist, visW, visH };
    camera.updateProjectionMatrix();
    // Fog and the key light scale with how far back the camera sits.
    scene.fog.near = dist + 200;
    scene.fog.far = dist * 2.6 + 900;
    perRow = Math.max(4, Math.floor((visW - MARGIN * 2) / PITCH_X));
    place();
  }

  const rowY = (r) => -r * ROW_PITCH;
  // How far the camera has moved from the shelf down to the TV corner, 0..1: it dollies back
  // (and the shadow camera widens) as it goes, so the whole corner fits in the frame.
  // A close-up at the bottom: centred just above the table top on the TV and the PS2, pulling back only
  // a little, so the table's top and front edge frame the shot rather than the whole table.
  const DOLLY = 0.22;
  const cornerMid = () => corner.standTopY + 150;
  const shelfEndY = () => rowY(Math.max(0, rowCount - 1)) - H / 2 - BOARD - 26 + view.visH / 2;
  const cornerView = (y) => {
    if (!corner) return 0;
    const a = Math.min(topY(), shelfEndY());
    const b = cornerMid();
    return a > b ? clamp((a - y) / (a - b), 0, 1) : 0;
  };
  let dollyF = 0;
  let camDY = 0;

  // Scroll limits: the first row sits just under the DOM header; the last board rests near the bottom.
  const topY = () => H / 2 + 26 - view.visH * (0.5 - HEADER);
  const bottomY = () => {
    const shelfEnd = rowY(Math.max(0, rowCount - 1)) - H / 2 - BOARD - 26 + view.visH / 2;
    if (!corner) return Math.min(topY(), shelfEnd);
    // With the TV corner, scrolling continues down to the middle of the corner (the camera also
    // pulls back on the way, see cornerView).
    return Math.min(topY(), shelfEnd, cornerMid());
  };

  function place() {
    rowCount = Math.ceil(order.length / perRow);
    const rowW = perRow * PITCH_X;
    order.forEach((uri, i) => {
      const c = cases.get(uri);
      const r = Math.floor(i / perRow);
      const k = i % perRow;
      c.index = i;
      c.home.x = -rowW / 2 + PITCH_X * (k + 0.5);
      c.home.y = rowY(r);
    });
    const rows = Math.max(rowCount, 1);
    const unitW = rowW + 30;
    const boardY = (r) => rowY(r) - H / 2 - BOARD / 2 - 0.2; // the board under row r
    while (boards.length < rows + 1) {
      const m = new THREE.Mesh(boardGeo, boardMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      boards.push(m);
    }
    boards.forEach((m, i) => {
      m.visible = i <= rows;
      m.scale.set((unitW + 1) / BOARD_REF, 1, 1);
      m.position.set(0, boardY(i - 1), 0);
    });
    // A bar under every board that has a row below it (not the bottom board).
    while (deco.bars.length < rows) {
      const bar = new THREE.Mesh(deco.barGeo, deco.brass);
      const strip = new THREE.Mesh(deco.stripGeo, deco.glowMat);
      strip.position.set(0, -2.9, -0.8);
      bar.add(strip);
      bar.castShadow = true;
      scene.add(bar);
      deco.bars.push(bar);
    }
    deco.bars.forEach((bar, i) => {
      bar.visible = i < rows;
      bar.scale.set(((unitW - 30) / BOARD_REF), 1, 1);
      bar.position.set(0, boardY(i - 1) - BOARD / 2 - 2.6, DEPTH / 2 - 9);
    });
    deco.boardY = boardY;
    deco.unitW = unitW;
    const top = boardY(-1) + BOARD / 2;
    const bottom = boardY(rows - 1) - BOARD / 2;
    sides.forEach((m, i) => {
      m.scale.set(1, (top - bottom) / BOARD_REF, 1);
      m.position.set((i ? 1 : -1) * (unitW / 2 + BOARD / 2), (top + bottom) / 2, 0);
    });
    back.scale.set(unitW + 2, rows * ROW_PITCH, 1);
    back.position.set(0, (boardY(-1) + boardY(rows - 1)) / 2, BACK_Z - 2);
    compartAO.repeat.set(1, rows);
    unit.halfW = unitW / 2 + BOARD;
    unit.top = top;
    unit.bottom = bottom;

    // Creases for every compartment: floor along the back and both sides, the side panels at the
    // floor and ceiling, and the back panel along both sides.
    const need = rows * 9;
    if (!creases || creases.count < need) {
      if (creases) (scene.remove(creases), creases.dispose());
      creases = new THREE.InstancedMesh(quadGeo, creaseMat, Math.max(need, 64));
      creases.frustumCulled = false;
      creases.renderOrder = 2;
      scene.add(creases);
    }
    let n = 0;
    const put = (crease, u, v, wu, wv, k = 1) => {
      creases.setMatrixAt(n, decalMatrix(_dm, crease, u, v, wu, wv));
      creases.setColorAt(n, _k.setRGB(k, k, k));
      n++;
    };
    const inner = unitW / 2;
    for (let r = 0; r < rows; r++) {
      const floor = boardY(r) + BOARD / 2 + 0.05;
      const ceil = boardY(r - 1) - BOARD / 2 - 0.05;
      const span = ceil - floor;
      put(_p.set(0, floor, BACK_Z + 0.05), X, Z, unitW, 46);
      put(_p.set(-inner, floor, 0), Z, X, DEPTH, 30, 0.8);
      put(_p.set(inner, floor, 0), Z, NX, DEPTH, 30, 0.8);
      put(_p.set(-inner + 0.05, floor, 0), Z, Y, DEPTH, 26, 0.75);
      put(_p.set(inner - 0.05, floor, 0), Z, Y, DEPTH, 26, 0.75);
      put(_p.set(-inner + 0.05, ceil, 0), Z, NY, DEPTH, 22, 0.6);
      put(_p.set(inner - 0.05, ceil, 0), Z, NY, DEPTH, 22, 0.6);
      put(_p.set(-inner, floor + span / 2, BACK_Z + 0.05), Y, X, span, 34, 0.7);
      put(_p.set(inner, floor + span / 2, BACK_Z + 0.05), Y, NX, span, 34, 0.7);
    }
    creases.count = n;
    creases.instanceMatrix.needsUpdate = true;
    if (creases.instanceColor) creases.instanceColor.needsUpdate = true;
    corner?.place(unit.bottom, BACK_Z - 7);
    fitShadow();
    cam.target = clamp(cam.target, bottomY(), topY());
  }

  // A disc just saved to the library: it waits (hidden) for its cover, appears in front of its slot
  // turned to show the cover, squares up and slides in; the lamp finds it and the camera follows.
  let spotlit = null;
  function arrive(c) {
    c.hold = true;
    const go = () => {
      if (!c.hold || c.gone) return;
      c.hold = false;
      Object.assign(c.cur, { x: c.home.x - 40, y: c.home.y + 18, z: CLEAR_Z + 150, ry: -0.8, rz: 0, s: 1, lid: 0 });
      Object.assign(c.vel, { x: 0, y: 0, z: -40, ry: 0, rz: 0, s: 0, lid: 0 });
      // A slower, softer spring while it arrives, so the slide reads as someone shelving a disc.
      c.spring = { k: 34, c: 10.5, until: t + 3 };
      c.turnAt = t + 0.7; // shows its cover for a moment before squaring up
      spotlit = { c, until: t + 3.4 };
      const row = Math.floor(c.index / perRow);
      const y = rowY(row);
      if (y > cam.y + view.visH * 0.32 || y < cam.y - view.visH * 0.32) cam.target = clamp(y - 10, bottomY(), topY());
    };
    Promise.race([c.ready, new Promise((r) => setTimeout(r, 1500))]).then(go, go);
  }

  function setItems(items, { arrivals } = {}) {
    wake();
    const keep = new Set(items.map((i) => i.uri));
    for (const [uri, c] of cases) {
      if (!keep.has(uri) && !c.gone) {
        c.gone = true;
        c.index = -1;
        if (hovered === c) hovered = null;
      }
    }
    order = items.map((item) => {
      let c = cases.get(item.uri);
      if (!c) {
        c = makeCase(item);
        cases.set(item.uri, c);
        c.fresh = true;
      } else if (c.gone) {
        c.gone = false;
        c.group.visible = true;
        c.fresh = true;
      }
      return item.uri;
    });
    place();
    corner?.setStack(items.slice(0, 5).map((i) => i.thumb).filter((u) => u && !u.startsWith('data:')));
    // First load: everything drops into its slot from a little above, each at its own pace.
    // Later saves slide in from the front instead (see arrive).
    for (const uri of order) {
      const c = cases.get(uri);
      if (!c.fresh) continue;
      c.fresh = false;
      if (arrivals?.has(uri)) {
        arrive(c);
        continue;
      }
      Object.assign(c.cur, { x: c.home.x, y: c.home.y + 160 + Math.random() * 220, z: 20, ry: 0, rz: 0, s: 1 });
      Object.assign(c.vel, { x: 0, y: -Math.random() * 200, z: 0, ry: 0, rz: 0, s: 0 });
    }
  }

  function targets() {
    for (const c of cases.values()) {
      const tg = c.target;
      if (c.gone) {
        tg.x = c.home.x;
        tg.y = c.home.y - 40;
        tg.z = 30;
        tg.ry = 0;
        tg.rz = 0;
        tg.s = 0.001;
        tg.lid = 0;
        continue;
      }
      tg.x = c.home.x;
      tg.y = c.home.y;
      tg.z = 0;
      tg.ry = 0;
      tg.rz = 0;
      tg.s = 1;
      tg.lid = 0;
      // A case only turns once it is clear of the row (its 146 mm depth would otherwise swing into its
      // neighbours), and turns back square before it slides home.
      const clear = clamp((c.cur.z - CLEAR_Z * 0.8) / (CLEAR_Z * 0.2), 0, 1);
      if (c === pulled) {
        tg.x = camera.position.x;
        tg.y = camera.position.y;
        tg.z = camera.position.z - 600;
        tg.ry = -Math.PI / 2 * clear;
        continue;
      }
      if (hovered && hovered !== pulled) {
        const d = c.index - hovered.index;
        const sameRow = Math.floor(c.index / perRow) === Math.floor(hovered.index / perRow);
        if (c === hovered) {
          tg.z = CLEAR_Z + 8;
          tg.y += 4;
          tg.ry = -0.55 * clear;
          tg.lid = 0.3 * clear; // the lid cracks open once it's out
        } else if (sameRow && Math.abs(d) <= 3) {
          // Neighbours ease aside to make room. Each moves less than the one before by under a gap's
          // width, so they never touch.
          tg.x += Math.sign(d) * (4 - Math.abs(d)) * 0.9;
        }
      }
      if (c.turnAt && t < c.turnAt) {
        tg.ry = -0.8;
        tg.x = c.home.x - 12;
      } else c.turnAt = 0;
      if (Math.abs(c.cur.ry) > 0.02 || c.cur.lid > 0.02) tg.z = Math.max(tg.z, CLEAR_Z + 8);
      if (c === live) tg.z = Math.max(tg.z, 6); // the playing disc sits a little proud; its LED pulses
    }
  }

  function step(dt) {
    t += dt;
    // Camera: scroll target plus a slow drift and a lean toward the pointer.
    cam.y += (cam.target - cam.y) * (1 - Math.exp(-dt * 6));
    const px = pointer.over ? pointer.x : 0;
    const py = pointer.over ? pointer.y : 0;
    cam.x += (px * 30 - cam.x) * (1 - Math.exp(-dt * 2.5));
    const drift = Math.sin(t * 0.21) * 6;
    const f = cornerView(cam.y);
    const ease = f * f * (3 - 2 * f);
    if (Math.abs(f - dollyF) > 0.002) {
      dollyF = f;
      fitShadow();
    }
    // At the bottom the camera stands far enough back to fit the TV corner across a narrow window,
    // and slides sideways to centre on it.
    let camZ = view.dist + 40;
    let camX = 0;
    if (corner && ease > 0) {
      const fr = corner.frame;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const fitZ = fr.z + fr.halfW / (tanHalf * camera.aspect);
      camZ += (Math.max(camZ * (1 + DOLLY), fitZ) - camZ) * ease;
      camX = fr.x * ease;
      // Keep it a close-up however far back that is: the table top sits low in the frame, so its
      // legs fall out of shot and the extra room goes to the wall above the TV.
      const halfVis = (camZ - fr.z) * tanHalf;
      camDY = (corner.standTopY - 30 + halfVis * 0.62 - cornerMid()) * ease;
    } else camDY = 0;
    camera.position.set(camX + cam.x + drift, cam.y + camDY + py * 14 + Math.sin(t * 0.17) * 3, camZ);
    camera.lookAt(camX + cam.x * 0.3 + drift * 0.5, cam.y + camDY, 0);
    camera.updateMatrixWorld();

    // The key follows the scroll, snapped to whole shadow texels so its shadows don't shimmer.
    const texel = (key.shadow.camera.top - key.shadow.camera.bottom) / LIGHT.shadowMap;
    const keyY = Math.round((cam.y - 30) / texel) * texel;
    if (keyY !== key.target.position.y) shadowDirty = true;
    key.target.position.set(0, keyY, 0);
    key.position.copy(key.target.position).addScaledVector(LIGHT.keyDir, 1800);
    key.target.updateMatrixWorld();

    // The lamp follows the pointer across the front of the shelf, rests on a hovered case, and for a
    // few seconds picks out a disc that has just been added.
    const spot = spotlit && t < spotlit.until && !spotlit.c.gone ? spotlit.c : null;
    let at = null;
    if (spot) at = _v.set(spot.cur.x + 30, spot.cur.y + 70, spot.cur.z + D / 2 + 90);
    else if (pointer.over) {
      raycaster.setFromCamera(pointer.ndc, camera);
      const hit = raycaster.ray.intersectPlane(lampPlane, _v);
      if (hovered && !hovered.gone) at = _v.set(hovered.cur.x + 30, hovered.cur.y + 70, hovered.cur.z + D / 2 + 90);
      else if (hit) at = _v.set(hit.x, hit.y, 120);
    }
    if (at) lamp.position.lerp(at, 1 - Math.exp(-dt * 8));
    const glow = spot ? 1.7 : pointer.over ? (hovered ? 1.25 : 0.7) : 0;
    lamp.intensity += (glow - lamp.intensity) * (1 - Math.exp(-dt * 4));

    // What the camera can see, top to bottom: rows outside it skip drawing and updating.
    const lookY = cam.y + camDY;
    const seeHalf = camera.position.z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) + H;
    if (deco.boardY) {
      const nearest = clamp(Math.round(-lookY / ROW_PITCH), 0, Math.max(0, rowCount - 1));
      const first = clamp(nearest - 1, 0, Math.max(0, rowCount - 3));
      const fade = 1 - clamp(dollyF * 1.6, 0, 1); // the TV corner has its own light
      deco.lights.forEach((l, k) => {
        const r = first + (k >> 1);
        l.visible = r < rowCount && fade > 0.02;
        l.intensity = LIGHT.pictureIntensity * fade;
        l.position.set((k & 1 ? 1 : -1) * deco.unitW * 0.24, deco.boardY(r - 1) - BOARD / 2 - 14, DEPTH / 2 + 22);
      });
    }
    const cornerBusy = corner?.update(dt, t, corner && corner.standTopY + 450 > lookY - seeHalf && corner.floorY < lookY + seeHalf);
    if (cornerBusy) shadowDirty = true;
    targets();
    const sdt = dt / 2;
    let wrote = false;
    let moving = cornerBusy || Math.abs(cam.target - cam.y) > 0.05 || !!spot;
    for (const c of cases.values()) {
      if (c.hold || (c.gone && c.cur.s < 0.01)) {
        if (c.shown !== false || c.gen !== capGen) {
          c.gen = capGen;
          c.group.visible = c.lidGroup.visible = false;
          for (const m of instList) m.setMatrixAt(c.slot, ZERO);
          contacts.setMatrixAt(c.slot, ZERO);
          c.shown = false;
          wrote = true;
        }
        continue;
      }
      if (c.spring && t > c.spring.until) c.spring = null;
      // A case at rest stays at rest until its target changes: no spring maths, no matrix writes.
      let settled = true;
      for (const p of PROPS) {
        if (Math.abs(c.target[p] - c.cur[p]) > 0.002 || Math.abs(c.vel[p]) > 0.002) {
          settled = false;
          break;
        }
      }
      if (!settled) {
        const springK = c.spring ? c.spring.k : SPRING_K;
        const springC = c.spring ? c.spring.c : SPRING_C;
        for (let i = 0; i < 2; i++) {
          for (const p of PROPS) {
            c.vel[p] += ((c.target[p] - c.cur[p]) * springK - c.vel[p] * springC) * sdt;
            c.cur[p] += c.vel[p] * sdt;
          }
        }
        moving = true;
        shadowDirty = true;
      }
      const inView = Math.abs(c.cur.y - lookY) < seeHalf;
      if (!inView) {
        if (c.shown !== false || c.gen !== capGen) {
          c.gen = capGen;
          c.group.visible = c.lidGroup.visible = false;
          for (const m of instList) m.setMatrixAt(c.slot, ZERO);
          contacts.setMatrixAt(c.slot, ZERO);
          c.shown = false;
          wrote = true;
        }
        continue;
      }
      if (settled && c.shown && c.gen === capGen) continue;
      c.shown = true;
      c.gen = capGen;
      c.group.visible = c.lidGroup.visible = true;
      wrote = true;
      const { x, y, z, ry, rz, s, lid } = c.cur;
      _q.setFromEuler(_e.set(0, ry, rz));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(Math.max(0.001, s))).multiply(STAND);
      _lid.copy(_m).multiply(hingeIn).multiply(_r.makeRotationY(-Math.max(0, lid))).multiply(hingeOut);
      c.group.matrix.copy(_m);
      c.lidGroup.matrix.copy(_lid);
      c.hit.matrixWorld.copy(_m);
      inst.trayRods.setMatrixAt(c.slot, _m);
      inst.traySheets.setMatrixAt(c.slot, _m);
      inst.lidRods.setMatrixAt(c.slot, _lid);
      inst.lidSheets.setMatrixAt(c.slot, _lid);
      parts.book.setMatrixAt(c.slot, _pm.multiplyMatrices(_lid, BOOK_M));
      parts.label.setMatrixAt(c.slot, _pm.multiplyMatrices(_m, LABEL_M));
      parts.print.setMatrixAt(c.slot, _pm.multiplyMatrices(_m, PRINT_M));
      parts.under.setMatrixAt(c.slot, _pm.multiplyMatrices(_m, UNDER_M));
      // Its contact shadow: on the board under the case's home row, fading as it lifts or slides out.
      const lift = Math.max(0, y - c.home.y);
      const out = Math.max(0, Math.abs(z) - 10);
      const k = clamp(s, 0, 1) * clamp(1 - lift / 30, 0, 1) * clamp(1 - out / 70, 0, 1);
      const spread = 1 + lift / 50;
      decalMatrix(_dm, _p.set(x, c.home.y - H / 2 - 0.15, z - (D + 16) / 2 + 3), X, Z, (W + 14) * spread, D + 16);
      contacts.setMatrixAt(c.slot, k > 0.01 ? _dm : ZERO);
      contacts.setColorAt(c.slot, _k.setRGB(k, k, k));
    }
    if (wrote) {
      contacts.instanceMatrix.needsUpdate = true;
      if (contacts.instanceColor) contacts.instanceColor.needsUpdate = true;
      for (const m of instList) m.instanceMatrix.needsUpdate = true;
    }
    busy = moving;

    if (live && !live.gone) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.1);
      ledMat.color.setRGB(0.12 + 0.2 * pulse, 0.84, 0.38 + 0.1 * pulse);
      ledLight.intensity = 0.6 + pulse * 0.9;
    }

    const pos = dustGeo.attributes.position.array;
    for (let i = 0; i < DUST; i++) {
      const s = dustSeed[i];
      pos[i * 3] += Math.sin(t * 0.3 + s) * 0.05;
      pos[i * 3 + 1] += 0.02 + Math.sin(t * 0.5 + s * 1.7) * 0.04;
      pos[i * 3 + 2] += Math.cos(t * 0.2 + s) * 0.03;
      const rel = pos[i * 3 + 1] - cam.y;
      if (rel > 360) pos[i * 3 + 1] -= 720;
      else if (rel < -360) pos[i * 3 + 1] += 720;
    }
    dustGeo.attributes.position.needsUpdate = true;

    // Opaque room, then the glass refracting a copy of it, then dust, then tone-map to the screen.
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.setRenderTarget(rtMain);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(rtBehind);
    renderer.render(copy.scene, screenCam);
    renderer.setRenderTarget(rtMain);
    renderer.render(glass, camera);
    renderer.render(fx, camera);
    renderer.setRenderTarget(null);
    renderer.render(output.scene, screenCam);
  }

  const raycaster = new THREE.Raycaster();
  const lampPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -D / 2);
  const _v = new THREE.Vector3();

  function pick() {
    if (!pointer.over) return null;
    raycaster.setFromCamera(pointer.ndc, camera);
    const meshes = [];
    for (const c of cases.values()) if (!c.gone && c.group.visible) meshes.push(c.hit);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.case : null;
  }

  const setHovered = (c) => {
    if (c === hovered) return;
    hovered = c;
    container.style.cursor = c ? 'pointer' : '';
    onHover?.(c ? c.item : null);
  };

  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = 1 - ((e.clientY - r.top) / r.height) * 2;
    pointer.ndc.set(pointer.x, pointer.y);
    pointer.over = true;
    if (!pulled) setHovered(pick());
    if (!hovered && corner) {
      raycaster.setFromCamera(pointer.ndc, camera);
      const onTvNow = corner.hitsTv(raycaster);
      container.style.cursor = onTvNow ? 'pointer' : '';
      if (onTvNow !== overTv) {
        overTv = onTvNow;
        onHover?.(onTvNow ? { name: 'CRT TV', artist: 'click to play or pause' } : null);
      }
    } else if (overTv) overTv = false;
  };
  let overTv = false;
  const onLeave = () => {
    pointer.over = false;
    setHovered(null);
  };
  const onClick = (e) => {
    if (pulled || e.button !== 0) return;
    onMove(e);
    const c = pick();
    if (!c) {
      if (overTv) onTv?.();
      return;
    }
    pullOut(c.item.uri);
    onPick?.(c.item);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const perPx = view.visH / view.h;
    cam.target = clamp(cam.target - e.deltaY * perPx * 0.9, bottomY(), topY());
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('click', onClick);
  container.addEventListener('wheel', onWheel, { passive: false });
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) container.addEventListener(ev, wake, { passive: true });

  function pullOut(uri) {
    wake();
    pulled = cases.get(uri) || null;
    setHovered(null);
  }

  // Full frame rate while anything moves or the pointer is busy; when the room just idles (dust,
  // drift, the TV's flicker), 30 fps, or 15 fps while Spotify isn't the focused window.
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (paused || document.hidden) return;
    if (!busy && now - activeAt > 1500) {
      const interval = document.hasFocus() ? 1000 / 30 - 2 : 1000 / 15 - 2;
      if (last && now - last < interval) return;
    }
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    const t0 = performance.now();
    renderer.info.reset();
    step(dt);
    perf.cpu += performance.now() - t0;
    perf.frames++;
  };
  // Rolling CPU cost per frame, for __cdShelf.debug().perf.
  const perf = { cpu: 0, frames: 0, since: performance.now() };
  const perfReport = () => {
    const secs = (performance.now() - perf.since) / 1000;
    const out = { fps: +(perf.frames / secs).toFixed(1), cpuMsPerFrame: +(perf.cpu / Math.max(1, perf.frames)).toFixed(2), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
    perf.cpu = perf.frames = 0;
    perf.since = performance.now();
    return out;
  };

  const ro = new ResizeObserver(() => layout());
  ro.observe(container);
  layout();
  cam.y = cam.target = topY();
  raf = requestAnimationFrame(tick);

  return {
    perf: () => perfReport(),
    debug: () => ({ screen: corner?.screen, perRow, rowCount, n: order.length, camY: cam.y, target: cam.target, top: topY(), bottom: bottomY(), view, cases: cases.size }),
    setItems,
    // The player's current track, for the TV.
    setNowPlaying(info) {
      if (corner && canvasFor) corner.setTrack(info, canvasFor);
    },
    setLive(uri) {
      const c = uri ? cases.get(uri) : null;
      if (c === live) return;
      live = c || null;
      if (live) {
        live.group.add(led, ledLight);
      } else {
        led.removeFromParent();
        ledLight.removeFromParent();
      }
    },
    // Fly a case out toward the viewer (also used when a case is opened from the player bar).
    pullOut,
    putBack() {
      wake();
      pulled = null;
    },
    setPaused(on) {
      paused = on;
      last = 0;
      wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('click', onClick);
      container.removeEventListener('wheel', onWheel);
      for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) container.removeEventListener(ev, wake);
      corner?.dispose();
      for (const m of Object.values(inst || {})) m.dispose();
      for (const d of disposables) d.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
