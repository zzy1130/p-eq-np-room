// 圆桌会议 · 3D discussion room
// three.js r170 is vendored in ./vendor/three (no runtime CDN).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

/* =========================================================================
 * Utilities
 * ========================================================================= */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const dampAngle = (cur, tgt, k, dt) => cur + wrapAngle(tgt - cur) * (1 - Math.exp(-k * dt));
const N_BOTS = 10;

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const chance = (rng, p) => rng() < p;
const rand = (rng, a, b) => a + (b - a) * rng();

const TYPES = {
  claim: { label: '主张', color: '#3d7fe0' },
  rebuttal: { label: '反驳', color: '#e0483d' },
  retract: { label: '撤回', color: '#d79b16' },
  summary: { label: '总结', color: '#23a26b' },
  vote: { label: '投票', color: '#8a52d6' },
  proposal: { label: '提议', color: '#e0703f' },
  status: { label: '状态', color: '#8a7d70' },
};
const typeMeta = (t) => TYPES[t] || { label: t ? String(t).slice(0, 6) : '发言', color: '#8a7d70' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function inlineMd(s) { // s must already be escaped
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
}
const LIST_RE = /^\s*([-*+]|\d+[.)])\s+/;
function md(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^\s*(#{1,6})\s+(.*)$/))) {
      const n = Math.min(4, m[1].length);
      out.push(`<h${n}>${inlineMd(esc(m[2]))}</h${n}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push('<blockquote>' + md(buf.join('\n')) + '</blockquote>');
      continue;
    }
    if (LIST_RE.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        items.push(lines[i++].replace(LIST_RE, ''));
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_RE.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((x) => '<li>' + inlineMd(esc(x)) + '</li>').join('') + `</${tag}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r, ri) => '<tr>' +
        r.trim().slice(1, -1).split('|').map((c) => (ri === 0 ? '<th>' : '<td>') + inlineMd(esc(c.trim())) + (ri === 0 ? '</th>' : '</td>')).join('') + '</tr>');
      out.push('<table>' + body.join('') + '</table>');
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|~~~|>)/.test(lines[i]) && !LIST_RE.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push('<p>' + buf.map((x) => inlineMd(esc(x))).join('<br>') + '</p>');
  }
  return out.join('');
}
function plain(s, n = 90) {
  const t = String(s ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' ⟨代码⟩ ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*_`>|#]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts).slice(11, 19) || String(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

/* =========================================================================
 * Renderer / scene
 * ========================================================================= */
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile || devicePixelRatio < 2, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const BG = 0xefe3cf;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 18, 38);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 120);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 5;
controls.maxDistance = 26;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = 1.36;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.rotateSpeed = isMobile ? 0.6 : 0.8;

function fitCamera(initial) {
  const aspect = innerWidth / innerHeight;
  camera.fov = aspect < 0.8 ? 52 : 40;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  if (initial) {
    const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const ht = vt * aspect;
    const dist = clamp(Math.max((aspect < 0.8 ? 3.9 : 4.8) / ht, 5.0 / vt), 8, 22);
    const dir = new THREE.Vector3(0, 0.5, 1).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
  }
}
fitCamera(true);

// Lights
scene.add(new THREE.HemisphereLight(0xfff4e2, 0xa47a55, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.75);
sun.position.set(6, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 2, far: 30 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 4;
scene.add(sun);
const lamp = new THREE.PointLight(0xffc580, 5, 0, 2);
lamp.position.set(0, 3.6, 0);
scene.add(lamp);

// Toon materials
const gradTex = new THREE.DataTexture(new Uint8Array([110, 175, 230, 255]), 4, 1, THREE.RedFormat);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter;
gradTex.needsUpdate = true;
const matCache = new Map();
function toon(color, extra) {
  const key = new THREE.Color(color).getHexString() + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...(extra || {}) }); matCache.set(key, m); }
  return m;
}

// Shared geometries
const G = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  sphereLo: new THREE.SphereGeometry(1, 12, 8),
  hemi: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 16),
  torus: new THREE.TorusGeometry(1, 0.13, 8, 28),
  torusSq: new THREE.TorusGeometry(1, 0.13, 6, 4),
  arc: new THREE.TorusGeometry(1, 0.22, 8, 16, Math.PI),
  box: new THREE.BoxGeometry(1, 1, 1),
  leg: new THREE.CapsuleGeometry(0.075, 0.14, 4, 10),
  arm: new THREE.CapsuleGeometry(0.06, 0.15, 4, 10),
  torso: new THREE.CapsuleGeometry(0.21, 0.16, 6, 16),
};
function mesh(geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, typeof mat === 'object' && mat.isMaterial ? mat : toon(mat));
  if (o.p) m.position.set(...o.p);
  if (o.s) Array.isArray(o.s) ? m.scale.set(...o.s) : m.scale.setScalar(o.s);
  if (o.r) m.rotation.set(...o.r);
  if (o.cast) m.castShadow = true;
  if (o.recv) m.receiveShadow = true;
  if (o.parent) o.parent.add(m);
  return m;
}

/* =========================================================================
 * Environment
 * ========================================================================= */
const TABLE_R = 2.2, TABLE_TOP = 0.6, SEAT_R = 3.55, STAND_R = 2.85, CLEAR_R = 2.55;
const seatAngle = (id) => ((id - 1) / N_BOTS) * Math.PI * 2 + Math.PI / N_BOTS;
const ringPos = (id, r) => new THREE.Vector2(Math.sin(seatAngle(id)) * r, Math.cos(seatAngle(id)) * r);

const floor = mesh(new THREE.CircleGeometry(60, 64), 0xeadabf, { r: [-Math.PI / 2, 0, 0], recv: true, parent: scene });
mesh(new THREE.CircleGeometry(5.4, 72), 0xd9774f, { r: [-Math.PI / 2, 0, 0], p: [0, 0.005, 0], recv: true, parent: scene });
mesh(new THREE.RingGeometry(4.75, 5.0, 72), 0xf4c46a, { r: [-Math.PI / 2, 0, 0], p: [0, 0.01, 0], recv: true, parent: scene });
mesh(new THREE.RingGeometry(1.0, 1.15, 48), 0xf4c46a, { r: [-Math.PI / 2, 0, 0], p: [0, 0.01, 0], recv: true, parent: scene });

// Table
const table = new THREE.Group(); scene.add(table);
mesh(G.cyl, 0xb87943, { p: [0, TABLE_TOP - 0.06, 0], s: [TABLE_R, 0.12, TABLE_R], cast: true, recv: true, parent: table });
mesh(G.torus, 0x8c552b, { p: [0, TABLE_TOP - 0.05, 0], s: [TABLE_R, TABLE_R, 0.55], r: [Math.PI / 2, 0, 0], cast: true, parent: table });
mesh(G.cyl, 0x3f8f6b, { p: [0, TABLE_TOP + 0.003, 0], s: [TABLE_R - 0.3, 0.01, TABLE_R - 0.3], recv: true, parent: table });
mesh(G.cyl, 0x8c552b, { p: [0, TABLE_TOP / 2 - 0.05, 0], s: [0.38, TABLE_TOP - 0.1, 0.38], cast: true, parent: table });
mesh(G.cyl, 0x8c552b, { p: [0, 0.04, 0], s: [0.9, 0.08, 0.9], cast: true, recv: true, parent: table });

// Chairs and mugs (cushion/mug colour follows bot)
const chairs = [], mugs = [];
for (let id = 1; id <= N_BOTS; id++) {
  const c = new THREE.Group();
  const p = ringPos(id, SEAT_R);
  c.position.set(p.x, 0, p.y);
  c.rotation.y = seatAngle(id) + Math.PI; // face centre (+z local toward table)
  const cushion = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex });
  mesh(G.cyl, 0x7a4a26, { p: [0, 0.17, 0], s: [0.06, 0.34, 0.06], cast: true, parent: c });
  mesh(G.cyl, 0x7a4a26, { p: [0, 0.02, 0], s: [0.26, 0.04, 0.26], parent: c });
  mesh(G.cyl, 0x8c552b, { p: [0, 0.33, 0], s: [0.34, 0.05, 0.34], cast: true, parent: c });
  mesh(G.cyl, cushion, { p: [0, 0.37, 0], s: [0.3, 0.05, 0.3], cast: true, recv: true, parent: c });
  mesh(G.box, 0x8c552b, { p: [0, 0.68, -0.31], s: [0.56, 0.5, 0.07], r: [-0.12, 0, 0], cast: true, parent: c });
  mesh(G.box, cushion, { p: [0, 0.69, -0.27], s: [0.46, 0.38, 0.03], r: [-0.12, 0, 0], parent: c });
  scene.add(c);
  chairs[id] = { group: c, cushion };
  const mp = ringPos(id, TABLE_R - 0.35);
  const mug = new THREE.Group();
  mug.position.set(mp.x, TABLE_TOP, mp.y);
  const mugMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex });
  mesh(G.cyl, mugMat, { p: [0, 0.08, 0], s: [0.07, 0.16, 0.07], cast: true, parent: mug });
  mesh(G.torus, mugMat, { p: [0.08, 0.08, 0], s: 0.045, parent: mug });
  mesh(G.cyl, 0x4a2c17, { p: [0, 0.155, 0], s: [0.06, 0.01, 0.06], parent: mug });
  mug.rotation.y = seatAngle(id);
  scene.add(mug);
  mugs[id] = mugMat;
  // a sheet of paper
  const pp = ringPos(id, TABLE_R - 0.75);
  mesh(G.box, 0xfffaf0, { p: [pp.x, TABLE_TOP + 0.012, pp.y], s: [0.3, 0.005, 0.4], r: [0, seatAngle(id) + (id % 3 - 1) * 0.3, 0], recv: true, parent: scene });
}

// Plants & beanbags for coziness
function plant(x, z, s) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
  mesh(G.cyl, 0xc8673e, { p: [0, 0.25, 0], s: [0.32, 0.5, 0.32], cast: true, parent: g });
  mesh(G.cyl, 0xa9532f, { p: [0, 0.5, 0], s: [0.36, 0.06, 0.36], parent: g });
  [[0, 0.95, 0, 0.45], [0.25, 0.8, 0.1, 0.33], [-0.22, 0.85, -0.1, 0.35], [0.05, 1.3, -0.05, 0.3]].forEach(([a, b, c, r], i) =>
    mesh(G.sphereLo, i % 2 ? 0x5aa86a : 0x4b9a5d, { p: [a, b, c], s: r, cast: true, parent: g }));
  scene.add(g);
}
plant(-6.6, -4.2, 1.2); plant(6.8, -3.6, 1.0); plant(-5.5, 5.8, 0.9); plant(6.2, 5.2, 1.3); plant(0.6, -7.8, 1.1);
[[-7.6, 1.0, 0xf2a65a], [7.8, 0.4, 0x7fb8e6]].forEach(([x, z, c]) =>
  mesh(G.sphere, c, { p: [x, 0.35, z], s: [0.8, 0.45, 0.75], cast: true, recv: true, parent: scene }));

// Hologram sign above the table
const holoCanvas = document.createElement('canvas');
holoCanvas.width = 512; holoCanvas.height = 256;
const holoTex = new THREE.CanvasTexture(holoCanvas);
holoTex.colorSpace = THREE.SRGBColorSpace;
const holo = new THREE.Sprite(new THREE.SpriteMaterial({ map: holoTex, transparent: true, depthWrite: false, fog: false }));
holo.scale.set(2.4, 1.2, 1);
holo.position.set(0, 2.95, 0);
holo.renderOrder = 2;
scene.add(holo);
const holoRing = mesh(G.torus, toon(0xffd27a, { emissive: 0x6b4a10 }), { p: [0, 2.2, 0], s: [0.55, 0.55, 0.35], r: [Math.PI / 2, 0, 0], parent: scene });
let holoKey = '';
function drawHolo(title, sub, good) {
  const key = title + '|' + sub + '|' + good;
  if (key === holoKey) return; holoKey = key;
  const c = holoCanvas.getContext('2d');
  c.clearRect(0, 0, 512, 256);
  const r = 46, x = 16, y = 26, w = 480, h = 196;
  c.beginPath(); c.roundRect(x, y, w, h, r);
  c.fillStyle = good ? 'rgba(47,191,113,.92)' : 'rgba(43,36,32,.86)'; c.fill();
  c.lineWidth = 8; c.strokeStyle = good ? '#d9ffe9' : '#ffd27a'; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.font = '800 76px -apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", sans-serif';
  c.fillText(title, 256, 106, 440);
  c.font = '700 40px -apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", sans-serif';
  c.fillStyle = good ? '#eafff3' : '#ffd27a';
  c.fillText(sub, 256, 178, 440);
  holoTex.needsUpdate = true;
}
drawHolo('P ≟ NP', '圆桌会议', false);

/* =========================================================================
 * Bots
 * ========================================================================= */
const SKINS = ['#ffdcc2', '#f6c9a4', '#eab48b', '#cf946a', '#a8704b', '#ffe6d3', '#f1c7a0'];
const FUNNY_SKINS = ['#a9e3a0', '#b9d5ff', '#e7c4ff', '#ffd1dc'];
const HAIRS = ['#2b2320', '#5a3825', '#8b5a2b', '#d8a24a', '#f1d28a', '#c0392b', '#e86aa6', '#4e7ad8', '#efefef', '#6b4fa0', '#2f9e84'];
const HAIR_STYLES = ['cap', 'spiky', 'curly', 'mohawk', 'ahoge', 'pigtails', 'bun', 'bald'];
const HAT_STYLES = ['top', 'beanie', 'party', 'cap', 'crown', 'propeller', 'chef', 'bow'];
const SAFE_HAIR_WITH_HAT = ['cap', 'pigtails', 'bald', 'cap'];
const HEAD_R = { x: 0.37, y: 0.34, z: 0.35 };
const onHead = (x, y, k = 1) => {
  const t = 1 - (x / HEAD_R.x) ** 2 - (y / HEAD_R.y) ** 2;
  return HEAD_R.z * Math.sqrt(Math.max(0.0, t)) * k;
};

const tmpV = new THREE.Vector3();

// Voting paddles (举牌): shared textures
function paddleMat(bg, glyph) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 78px -apple-system, "Segoe UI Symbol", "Noto Sans SC", sans-serif';
  g.fillText(glyph, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide });
}
const PADDLE = { agree: paddleMat('#23a26b', '✓'), disagree: paddleMat('#e0483d', '✗'), abstain: paddleMat('#8a7d70', '–') };
const paddleDisc = new THREE.CircleGeometry(0.24, 28);

class Bot {
  constructor(id) {
    this.id = id;
    this.name = '角色 ' + id;
    this.root = new THREE.Group();
    this.root.userData.botId = id;
    scene.add(this.root);
    const home = ringPos(id, SEAT_R);
    this.pos = new THREE.Vector2(home.x, home.y);
    this.vel = new THREE.Vector2();
    this.goal = new THREE.Vector2(home.x, home.y);
    this.facing = seatAngle(id) + Math.PI;
    this.ground = 0; this.onTable = false;
    this.hop = null;
    this.sit = 1; this.sitTarget = 1;
    this.mode = 'sit'; this.modeT = 3 + Math.random() * 10; this.wanders = 0; this.pause = 0;
    this.phase = Math.random() * 10; this.walkAmt = 0;
    this.blinkIn = 1 + Math.random() * 3; this.blinkT = 0;
    this.gBlend = 0; this.role = 'idle';
    this.cur = { aLx: 0, aLz: 0.2, aRx: 0, aRz: -0.2, legL: 0, legR: 0, headTilt: 0, headNod: 0, headYaw: 0, mouth: 1, brow: 0 };
    if (Math.random() < 0.35) { this.mode = 'wander'; this.wanders = 1; this.sit = 0; this.sitTarget = 0; this.pickWanderGoal(); }
  }

  build(rng, hue) {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    const R = this.root;
    const body = new THREE.Group(); R.add(body); this.body = body;

    const funny = chance(rng, 0.15);
    const skin = funny ? pick(rng, FUNNY_SKINS) : pick(rng, SKINS);
    const main = new THREE.Color().setHSL(hue, rand(rng, 0.55, 0.78), rand(rng, 0.5, 0.62));
    const light = main.clone().offsetHSL(0, -0.1, 0.22);
    const dark = main.clone().offsetHSL(rand(rng, -0.08, 0.08), 0, -0.22);
    const accent = new THREE.Color().setHSL((hue + rand(rng, 0.35, 0.65)) % 1, 0.75, 0.58);
    const hair = pick(rng, HAIRS);
    this.color = '#' + main.getHexString();
    chairs[this.id].cushion.color.copy(main);
    mugs[this.id].color.copy(light);

    const chub = rand(rng, 0.92, 1.22);
    // legs
    const shoe = chance(rng, 0.5) ? '#3a2e2a' : '#' + dark.getHexString();
    this.legs = [-1, 1].map((s) => {
      const p = new THREE.Group(); p.position.set(0.1 * s * chub, 0.3, 0); body.add(p);
      mesh(G.leg, dark, { p: [0, -0.13, 0], cast: true, parent: p });
      mesh(G.sphere, shoe, { p: [0, -0.27, 0.035], s: [0.09, 0.06, 0.125], cast: true, parent: p });
      return p;
    });
    // torso
    const torso = mesh(G.torso, main, { p: [0, 0.5, 0], s: [chub, 1, chub * 0.92], cast: true, recv: true, parent: body });
    this.torso = torso;
    const deco = pick(rng, ['belly', 'buttons', 'stripe', 'tie', 'belly']);
    if (deco === 'belly') mesh(G.sphere, light, { p: [0, 0.46, 0.155 * chub], s: [0.14 * chub, 0.16, 0.07], parent: body });
    if (deco === 'buttons') [0.56, 0.47, 0.38].forEach((y) => mesh(G.sphereLo, '#fff6e0', { p: [0, y, 0.2 * chub], s: 0.025, parent: body }));
    if (deco === 'stripe') mesh(G.torus, light, { p: [0, 0.45, 0], s: [0.215 * chub, 0.215 * chub * 0.92, 0.35], r: [Math.PI / 2, 0, 0], parent: body });
    if (deco === 'tie') {
      mesh(G.box, accent, { p: [0, 0.6, 0.2 * chub], s: [0.06, 0.16, 0.02], r: [-0.18, 0, 0], parent: body });
      mesh(G.cone, accent, { p: [0, 0.48, 0.21 * chub], s: [0.05, 0.1, 0.02], r: [Math.PI - 0.18, 0, 0], parent: body });
    }
    const neckAcc = pick(rng, ['none', 'none', 'bowtie', 'scarf', 'collar']);
    if (neckAcc === 'bowtie') {
      mesh(G.cone, accent, { p: [-0.05, 0.75, 0.17], s: [0.045, 0.09, 0.03], r: [0, 0, Math.PI / 2], parent: body });
      mesh(G.cone, accent, { p: [0.05, 0.75, 0.17], s: [0.045, 0.09, 0.03], r: [0, 0, -Math.PI / 2], parent: body });
      mesh(G.sphereLo, accent, { p: [0, 0.75, 0.18], s: 0.03, parent: body });
    } else if (neckAcc === 'scarf') {
      mesh(G.torus, accent, { p: [0, 0.75, 0], s: [0.19, 0.19, 0.6], r: [Math.PI / 2, 0, 0], cast: true, parent: body });
      mesh(G.box, accent, { p: [0.1, 0.62, 0.16], s: [0.07, 0.2, 0.03], r: [0.1, 0, 0.15], parent: body });
    } else if (neckAcc === 'collar') {
      mesh(G.torus, '#ffffff', { p: [0, 0.77, 0], s: [0.17, 0.17, 0.5], r: [Math.PI / 2, 0, 0], parent: body });
    }
    if (chance(rng, 0.15)) mesh(G.box, accent, { p: [0, 0.5, -0.22 * chub], s: [0.3, 0.32, 0.14], cast: true, parent: body }); // backpack
    // arms
    this.arms = [-1, 1].map((s) => {
      const p = new THREE.Group(); p.position.set(0.22 * s * chub, 0.66, 0); body.add(p);
      mesh(G.arm, main, { p: [0, -0.11, 0], cast: true, parent: p });
      mesh(G.sphere, skin, { p: [0, -0.23, 0], s: 0.072, parent: p });
      return p;
    });
    // voting paddle held in the right hand (hidden unless voting)
    const paddle = new THREE.Group(); paddle.visible = false; this.arms[1].add(paddle);
    paddle.position.set(0, -0.25, 0);
    mesh(G.cyl, '#8c552b', { p: [0, -0.16, 0], s: [0.016, 0.4, 0.016], parent: paddle });
    this.paddleFace = new THREE.Mesh(paddleDisc, PADDLE.agree);
    this.paddleFace.position.set(0, -0.5, 0.01); this.paddleFace.rotation.z = Math.PI;
    paddle.add(this.paddleFace);
    this.paddle = paddle;

    // head
    const headPivot = new THREE.Group(); headPivot.position.set(0, 0.76, 0); body.add(headPivot); this.headPivot = headPivot;
    const head = new THREE.Group(); head.position.set(0, 0.32, 0); headPivot.add(head); this.head = head;
    mesh(G.sphere, skin, { s: [HEAD_R.x, HEAD_R.y, HEAD_R.z], cast: true, recv: true, parent: head });

    // eyes
    const eyeStyle = pick(rng, ['big', 'big', 'dot', 'sleepy', 'sparkle', 'derp']);
    const eyeS = rand(rng, 0.9, 1.25);
    const ex = rand(rng, 0.11, 0.14), ey = rand(rng, -0.01, 0.04);
    const look = [rand(rng, -0.01, 0.01), rand(rng, -0.01, 0.01)];
    this.eyes = [-1, 1].map((s) => {
      const g = new THREE.Group();
      const x = ex * s, z = onHead(x, ey);
      g.position.set(x, ey, z - 0.02); head.add(g);
      let k = eyeS * (eyeStyle === 'derp' && s > 0 ? 1.35 : 1);
      if (eyeStyle === 'dot') {
        mesh(G.sphere, '#231c1a', { p: [0, 0, 0.02], s: [0.04 * k, 0.05 * k, 0.03], parent: g });
        mesh(G.sphereLo, '#ffffff', { p: [0.012 * k, 0.018 * k, 0.045], s: 0.011 * k, parent: g });
      } else {
        mesh(G.sphere, '#ffffff', { s: [0.072 * k, 0.085 * k, 0.04], parent: g });
        const px = look[0] + (eyeStyle === 'derp' ? s * 0.018 : 0);
        mesh(G.sphere, '#231c1a', { p: [px, look[1] - 0.005, 0.03], s: [0.045 * k, 0.055 * k, 0.025], parent: g });
        mesh(G.sphereLo, '#ffffff', { p: [px + 0.016 * k, 0.022 * k, 0.05], s: (eyeStyle === 'sparkle' ? 0.022 : 0.014) * k, parent: g });
        if (eyeStyle === 'sparkle') mesh(G.sphereLo, '#ffffff', { p: [px - 0.015 * k, -0.02 * k, 0.05], s: 0.008 * k, parent: g });
        if (eyeStyle === 'sleepy') mesh(G.hemi, skin, { p: [0, 0.0, 0.003], s: [0.078 * k, 0.09 * k, 0.046], r: [0.35, 0, 0], parent: g });
      }
      return g;
    });
    // brows
    const browAng = rand(rng, -0.25, 0.25);
    this.brows = [-1, 1].map((s) => {
      const x = ex * s, y = ey + 0.11 * eyeS;
      return mesh(G.box, hair === '#efefef' ? '#9a9a9a' : hair, { p: [x, y, onHead(x, y) + 0.005], s: [0.075, 0.017, 0.02], r: [0, 0, browAng * s], parent: head });
    });
    this.browBase = browAng;
    // cheeks
    if (chance(rng, 0.8)) [-1, 1].forEach((s) => {
      const x = 0.2 * s, y = -0.07;
      mesh(G.sphereLo, '#ff8f8f', { p: [x, y, onHead(x, y) - 0.01], s: [0.05, 0.028, 0.02], parent: head });
    });
    // mouth
    const mouthStyle = pick(rng, ['smile', 'smile', 'open', 'cat', 'o', 'grin']);
    const my = -0.11, mz = onHead(0, my);
    const mouth = new THREE.Group(); mouth.position.set(0, my, mz - 0.005); head.add(mouth); this.mouth = mouth;
    if (mouthStyle === 'smile') mesh(G.arc, '#5a2a22', { s: [0.05, 0.05, 0.05], r: [0, 0, Math.PI], parent: mouth });
    if (mouthStyle === 'open' || mouthStyle === 'grin') {
      mesh(G.sphere, '#5a2222', { s: [mouthStyle === 'grin' ? 0.075 : 0.05, 0.04, 0.02], parent: mouth });
      mesh(G.sphereLo, mouthStyle === 'grin' ? '#ffffff' : '#ff7b7b', { p: [0, mouthStyle === 'grin' ? 0.018 : -0.015, 0.012], s: [mouthStyle === 'grin' ? 0.06 : 0.03, 0.015, 0.01], parent: mouth });
    }
    if (mouthStyle === 'cat') [-1, 1].forEach((s) => mesh(G.arc, '#5a2a22', { p: [0.03 * s, 0, 0], s: 0.03, r: [0, 0, Math.PI], parent: mouth }));
    if (mouthStyle === 'o') mesh(G.torus, '#5a2a22', { s: 0.03, parent: mouth });
    // nose
    const nose = pick(rng, ['none', 'none', 'dot', 'dot', 'clown']);
    if (nose !== 'none') mesh(G.sphere, nose === 'clown' ? '#ff3b3b' : new THREE.Color(skin).offsetHSL(0, 0.05, -0.08), { p: [0, -0.035, onHead(0, -0.035) + 0.005], s: nose === 'clown' ? 0.05 : 0.026, parent: head });
    // mustache
    if (nose !== 'clown' && chance(rng, 0.18)) [-1, 1].forEach((s) => mesh(G.sphere, hair === '#efefef' ? '#d0d0d0' : hair, { p: [0.045 * s, -0.073, onHead(0.04, -0.07) + 0.008], s: [0.06, 0.022, 0.025], r: [0, 0, 0.35 * s], parent: head }));

    // ears
    const earStyle = pick(rng, ['none', 'none', 'none', 'human', 'cat', 'bear']);
    const hasHat = chance(rng, 0.5);
    if (earStyle === 'human') [-1, 1].forEach((s) => mesh(G.sphere, skin, { p: [0.36 * s, 0, -0.02], s: [0.04, 0.07, 0.05], parent: head }));

    // hair
    const hs = hasHat ? pick(rng, SAFE_HAIR_WITH_HAT) : pick(rng, HAIR_STYLES);
    const cap = () => mesh(G.hemi, hair, { p: [0, 0.015, -0.01], s: [HEAD_R.x + 0.02, HEAD_R.y + 0.025, HEAD_R.z + 0.02], r: [-0.42, 0, 0], cast: true, parent: head });
    if (hs !== 'bald' && hs !== 'mohawk') cap();
    if (hs === 'spiky') for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, tilt = 0.75;
      const c = mesh(G.cone, hair, { s: [0.08, 0.2, 0.08], parent: head });
      c.position.set(Math.sin(a) * 0.17, 0.3, Math.cos(a) * 0.17 - 0.05);
      c.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
    }
    if (hs === 'curly') for (let i = 0; i < 13; i++) {
      const a = rng() * Math.PI * 2, el = rand(rng, 0.35, 1.25);
      mesh(G.sphereLo, hair, { p: [Math.cos(a) * Math.cos(el) * 0.36, Math.sin(el) * 0.33 + 0.03, Math.sin(a) * Math.cos(el) * 0.34 - 0.06], s: rand(rng, 0.08, 0.12), parent: head });
    }
    if (hs === 'mohawk') for (let i = 0; i < 5; i++) {
      const a = -0.4 + i * 0.42;
      mesh(G.cone, hair, { p: [0, Math.cos(a) * 0.33, Math.sin(a) * 0.33], s: [0.05, 0.22, 0.1], r: [a, 0, 0], parent: head });
    }
    if (hs === 'ahoge') mesh(G.torus, hair, { p: [0.02, 0.43, 0], s: [0.08, 0.08, 0.3], r: [0, Math.PI / 2, 0.4], parent: head });
    if (hs === 'pigtails') [-1, 1].forEach((s) => {
      mesh(G.sphere, hair, { p: [0.38 * s, -0.02, -0.06], s: [0.1, 0.14, 0.1], cast: true, parent: head });
      mesh(G.sphereLo, accent, { p: [0.33 * s, 0.05, -0.05], s: 0.035, parent: head });
    });
    if (hs === 'bun') mesh(G.sphere, hair, { p: [0, 0.33, -0.12], s: 0.12, cast: true, parent: head });
    if (hs === 'bald' && !hasHat) for (let i = -1; i <= 1; i++)
      mesh(G.torus, hair, { p: [i * 0.04, 0.37, 0], s: [0.05, 0.05, 0.2], r: [0, Math.PI / 2, 0.3 * i], parent: head });

    if (!hasHat && earStyle === 'cat') [-1, 1].forEach((s) => mesh(G.cone, hair === '#efefef' ? skin : hair, { p: [0.2 * s, 0.31, -0.02], s: [0.09, 0.16, 0.06], r: [0, 0, -0.35 * s], parent: head }));
    if (!hasHat && earStyle === 'bear') [-1, 1].forEach((s) => mesh(G.sphere, hair === '#efefef' ? skin : hair, { p: [0.24 * s, 0.28, -0.03], s: [0.08, 0.08, 0.05], parent: head }));

    // hat
    this.propeller = null;
    if (hasHat) {
      const hat = new THREE.Group(); head.add(hat);
      hat.rotation.set(rand(rng, -0.15, 0.05), 0, rand(rng, -0.22, 0.22));
      const style = pick(rng, HAT_STYLES);
      const hc = chance(rng, 0.5) ? accent : dark;
      if (style === 'top') {
        hat.position.y = 0.27;
        mesh(G.cyl, '#2b2320', { p: [0, 0.03, 0], s: [0.3, 0.025, 0.3], cast: true, parent: hat });
        mesh(G.cyl, '#2b2320', { p: [0, 0.2, 0], s: [0.19, 0.33, 0.19], cast: true, parent: hat });
        mesh(G.cyl, hc, { p: [0, 0.08, 0], s: [0.195, 0.06, 0.195], parent: hat });
      } else if (style === 'beanie') {
        hat.position.y = 0.04;
        mesh(G.hemi, hc, { s: [0.385, 0.37, 0.375], cast: true, parent: hat });
        mesh(G.torus, light, { p: [0, 0.03, 0], s: [0.375, 0.37, 0.6], r: [Math.PI / 2, 0, 0], parent: hat });
        mesh(G.sphereLo, '#ffffff', { p: [0, 0.4, 0], s: 0.075, cast: true, parent: hat });
      } else if (style === 'party') {
        hat.position.y = 0.3;
        mesh(G.cone, hc, { p: [0, 0.2, 0], s: [0.15, 0.4, 0.15], cast: true, parent: hat });
        mesh(G.sphereLo, '#fff2a8', { p: [0, 0.42, 0], s: 0.05, parent: hat });
        mesh(G.torus, '#ffffff', { p: [0, 0.12, 0], s: [0.11, 0.11, 0.3], r: [Math.PI / 2, 0, 0], parent: hat });
      } else if (style === 'cap') {
        hat.position.y = 0.04;
        mesh(G.hemi, hc, { s: [0.385, 0.35, 0.375], r: [-0.15, 0, 0], cast: true, parent: hat });
        mesh(G.cyl, hc, { p: [0, 0.06, 0.33], s: [0.2, 0.02, 0.17], parent: hat });
        mesh(G.sphereLo, light, { p: [0, 0.35, -0.03], s: 0.035, parent: hat });
      } else if (style === 'crown') {
        hat.position.y = 0.26;
        mesh(G.cylOpen, toon('#ffcc33', { side: THREE.DoubleSide }), { p: [0, 0.06, 0], s: [0.2, 0.12, 0.2], parent: hat });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          mesh(G.cone, '#ffcc33', { p: [Math.sin(a) * 0.19, 0.17, Math.cos(a) * 0.19], s: [0.045, 0.1, 0.045], parent: hat });
          mesh(G.sphereLo, i % 2 ? '#e0483d' : '#3d7fe0', { p: [Math.sin(a) * 0.205, 0.06, Math.cos(a) * 0.205], s: 0.022, parent: hat });
        }
      } else if (style === 'propeller') {
        hat.position.y = 0.04;
        mesh(G.hemi, hc, { s: [0.38, 0.35, 0.37], cast: true, parent: hat });
        mesh(G.cyl, '#555555', { p: [0, 0.4, 0], s: [0.012, 0.09, 0.012], parent: hat });
        const prop = new THREE.Group(); prop.position.y = 0.45; hat.add(prop);
        mesh(G.box, '#e0483d', { p: [0.11, 0, 0], s: [0.22, 0.01, 0.06], parent: prop });
        mesh(G.box, '#3d7fe0', { p: [-0.11, 0, 0], s: [0.22, 0.01, 0.06], parent: prop });
        this.propeller = prop;
      } else if (style === 'chef') {
        hat.position.y = 0.24;
        mesh(G.cyl, '#ffffff', { p: [0, 0.08, 0], s: [0.22, 0.16, 0.22], cast: true, parent: hat });
        [[0, 0.24, 0], [0.12, 0.2, 0], [-0.12, 0.2, 0], [0, 0.2, 0.11], [0, 0.2, -0.11]].forEach((p) =>
          mesh(G.sphereLo, '#ffffff', { p, s: 0.13, cast: true, parent: hat }));
      } else { // bow
        hat.position.set(0.18, 0.24, 0);
        mesh(G.cone, accent, { p: [-0.07, 0, 0], s: [0.06, 0.13, 0.04], r: [0, 0, -Math.PI / 2], parent: hat });
        mesh(G.cone, accent, { p: [0.07, 0, 0], s: [0.06, 0.13, 0.04], r: [0, 0, Math.PI / 2], parent: hat });
        mesh(G.sphereLo, accent, { s: 0.035, parent: hat });
      }
    }
    // antenna
    if (!hasHat && hs !== 'mohawk' && hs !== 'spiky' && chance(rng, 0.14)) {
      mesh(G.cyl, '#555555', { p: [0, 0.42, 0], s: [0.012, 0.16, 0.012], parent: head });
      mesh(G.sphereLo, toon(accent, { emissive: accent.clone().multiplyScalar(0.5) }), { p: [0, 0.52, 0], s: 0.045, parent: head });
    }
    // glasses
    if (chance(rng, 0.38)) {
      const gs = pick(rng, ['round', 'square', 'shades']);
      const frame = pick(rng, ['#2b2320', '#c0392b', '#3d7fe0', '#d4a017']);
      [-1, 1].forEach((s) => {
        const x = ex * s, z = onHead(x, ey) + 0.035;
        if (gs === 'shades') mesh(G.sphere, '#1c1c24', { p: [x, ey, z - 0.01], s: [0.085 * eyeS, 0.07 * eyeS, 0.02], parent: head });
        else mesh(gs === 'square' ? G.torusSq : G.torus, frame, { p: [x, ey, z], s: [0.085 * eyeS * (gs === 'square' ? 1.25 : 1), 0.085 * eyeS * (gs === 'square' ? 1.1 : 1), 0.06], r: [0, 0, gs === 'square' ? Math.PI / 4 : 0], parent: head });
      });
      mesh(G.box, gs === 'shades' ? '#1c1c24' : frame, { p: [0, ey + 0.01, onHead(0, ey) + 0.035], s: [0.08, 0.015, 0.015], parent: head });
    }

    this.headScale = 1;
    this.R = R;
  }

  pickWanderGoal() {
    const a = seatAngle(this.id) + (Math.random() - 0.5) * 0.7;
    const r = 2.7 + Math.random() * 1.7;
    this.goal.set(Math.sin(a) * r, Math.cos(a) * r);
  }
}

const bots = [];
for (let id = 1; id <= N_BOTS; id++) bots[id] = new Bot(id);
let currentSeed = null;
function rebuildBots(seed) {
  currentSeed = seed;
  const base = mulberry32(hashStr('palette:' + seed));
  const hue0 = base();
  const order = [...Array(N_BOTS).keys()];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(base() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let id = 1; id <= N_BOTS; id++) {
    const hue = (hue0 + order[id - 1] / N_BOTS + (base() - 0.5) * 0.03 + 1) % 1;
    bots[id].build(mulberry32(hashStr(seed + '#' + id)), hue);
    if (overlay[id]) overlay[id].tag.style.setProperty('--c', bots[id].color);
  }
}

/* =========================================================================
 * Overlay (names, think dots, speech bubbles)
 * ========================================================================= */
const overlayRoot = $('overlay');
const overlay = [];
for (let id = 1; id <= N_BOTS; id++) {
  const anchor = document.createElement('div'); anchor.className = 'anchor';
  const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = bots[id].name;
  const think = document.createElement('div'); think.className = 'think'; think.innerHTML = '<i></i><i></i><i></i>';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  anchor.append(bubble, think, tag);
  overlayRoot.appendChild(anchor);
  tag.addEventListener('click', () => openPanel(id));
  bubble.addEventListener('click', () => openPanel(id, bubble._msg));
  overlay[id] = { anchor, tag, think, bubble, msg: null, shown: false };
}

/* =========================================================================
 * Data & director
 * ========================================================================= */
const state = {
  msgs: [], status: {}, roles: new Map(), nameToId: new Map(), rawKey: null, session: null,
  speakingId: null, addressingId: null, act: null, recent: [], lastOk: 0, fails: 0, consensusClosed: false, first: true,
  vote: { active: false, proposal: null, byId: new Map(), agree: 0, disagree: 0, abstain: 0, conclusion: '' },
};

const validId = (v) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= 1 && n <= N_BOTS ? n : null; };
function normVote(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'agree' : 'disagree';
  if (typeof v === 'object') v = v.vote ?? v.choice ?? JSON.stringify(v);
  const s = String(v).toLowerCase().trim();
  if (/disagree|反对|不同意|不赞成|reject|^no$|^n$|^false$|^-1$/.test(s)) return 'disagree';
  if (/agree|同意|赞成|支持|approve|accept|^yes$|^y$|^true$|^\+?1$/.test(s)) return 'agree';
  return 'abstain';
}
const VOTE_META = {
  agree: { label: '赞成', icon: '✓', color: '#23a26b' },
  disagree: { label: '反对', icon: '✗', color: '#e0483d' },
  abstain: { label: '弃权', icon: '–', color: '#8a7d70' },
};
const str = (v) => (v == null ? '' : typeof v === 'string' ? v.trim() : JSON.stringify(v));

function normalizeMessages(raw, wantSession) {
  const all = [];
  const nameToId = new Map();
  let nextAuto = 1;
  for (const line of raw.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let m; try { m = JSON.parse(s); } catch { continue; }
    if (!m || typeof m !== 'object') continue;
    const role = m.role != null ? String(m.role) : (m.name != null ? String(m.name) : '');
    let id = validId(m.role_id);
    if (id == null) {
      if (role && nameToId.has(role)) id = nameToId.get(role);
      else { while (nextAuto <= N_BOTS && [...nameToId.values()].includes(nextAuto)) nextAuto++; id = nextAuto <= N_BOTS ? nextAuto : (hashStr(role) % N_BOTS) + 1; }
    }
    if (role) nameToId.set(role, id);
    const type = String(m.type ?? '').toLowerCase().trim();
    let replyTo = validId(m.reply_to);
    if (replyTo == null && m.reply_to != null && nameToId.has(String(m.reply_to))) replyTo = nameToId.get(String(m.reply_to));
    if (replyTo === id) replyTo = null;
    all.push({
      ts: m.ts ?? m.time ?? '', round: m.round ?? '', id, role: role || ('角色 ' + id), type,
      text: typeof m.text === 'string' ? m.text : (m.text == null ? str(m.content) : JSON.stringify(m.text)),
      session: m.session != null ? String(m.session) : null, replyTo,
      short: str(m.short), position: str(m.position), conclusion: str(m.conclusion),
      vote: m.vote, voteN: normVote(m.vote), ballot: m.is_ballot === true || type === 'proposal',
    });
  }
  // keep only the current session (lines without a session tag are always kept)
  let session = wantSession != null && wantSession !== '' ? String(wantSession) : null;
  if (!session) for (let j = all.length - 1; j >= 0; j--) if (all[j].session) { session = all[j].session; break; }
  const msgs = session ? all.filter((m) => !m.session || m.session === session) : all;
  msgs.forEach((m, i) => { m.i = i; });
  state.nameToId = new Map();
  for (const m of msgs) state.nameToId.set(m.role, m.id);
  return { msgs, session };
}

function resolveSpeaker(sp) {
  if (Array.isArray(sp)) sp = sp[0];
  if (sp && typeof sp === 'object') sp = sp.role_id ?? sp.id ?? sp.role ?? sp.name;
  if (sp == null || sp === '' || sp === false) return null;
  if (typeof sp === 'number' || /^\d+$/.test(String(sp))) return validId(sp);
  const s = String(sp).trim();
  if (state.nameToId.has(s)) return state.nameToId.get(s);
  for (const [name, id] of state.nameToId) if (name && (s.includes(name) || name.includes(s))) return id;
  return null;
}

function guessTarget(m) {
  if (m.replyTo) return m.replyTo;
  if (m.type !== 'rebuttal') return null;
  const t = m.text;
  let best = null, bestIdx = Infinity;
  for (const [name, id] of state.nameToId) {
    if (id === m.id || !name || name.length < 2) continue;
    const k = t.indexOf(name);
    if (k >= 0 && (k < bestIdx || (k === bestIdx && name.length > (best?.len || 0)))) { best = { id, len: name.length }; bestIdx = k; }
  }
  if (best) return best.id;
  for (let j = m.i - 1; j >= 0; j--) {
    const p = state.msgs[j];
    if (p.id !== m.id && p.type !== 'status') return p.id;
  }
  return null;
}

function startAct(m, fresh) {
  const now = performance.now() / 1000;
  const target = guessTarget(m);
  let kind;
  if (m.type === 'rebuttal') kind = 'rebut';
  else if (m.type === 'vote') kind = 'vote';
  else if (m.type === 'retract') kind = 'retract';
  else if (m.type === 'proposal' || m.type === 'status') kind = 'present';
  else kind = target ? 'address' : 'present';
  if (kind === 'rebut' && !target) kind = 'present';
  state.act = { botId: m.id, kind, target, until: now + (fresh ? 18 : 22), msg: m };
}

// Voting phase: after the latest proposal / ballot, or whenever status.votes is set.
function computeVotes() {
  const st = state.status, msgs = state.msgs;
  let pIdx = -1;
  for (let j = msgs.length - 1; j >= 0; j--) if (msgs[j].ballot) { pIdx = j; break; }
  const byId = new Map();
  let discussionAfter = false;
  if (pIdx >= 0) {
    for (let j = pIdx + 1; j < msgs.length; j++) {
      const m = msgs[j];
      if (m.type === 'vote' && m.voteN) byId.set(m.id, { vote: m.voteN, msg: m });
      else if (m.type !== 'status' && m.type !== 'vote') discussionAfter = true;
    }
  } else {
    let lastRound = null;
    for (let j = msgs.length - 1; j >= 0; j--) if (msgs[j].type === 'vote') { lastRound = msgs[j].round; break; }
    for (const m of msgs) if (m.type === 'vote' && m.voteN && m.round === lastRound) byId.set(m.id, { vote: m.voteN, msg: m });
  }
  const sv = st.votes && typeof st.votes === 'object' ? st.votes : null;
  const count = (k) => [...byId.values()].filter((v) => v.vote === k).length;
  const proposal = pIdx >= 0 ? msgs[pIdx] : null;
  state.vote = {
    active: !!sv || (pIdx >= 0 && !discussionAfter) || (pIdx < 0 && byId.size > 0 && msgs[msgs.length - 1]?.type === 'vote'),
    proposal, byId,
    agree: Number(sv?.agree ?? count('agree')) || 0,
    disagree: Number(sv?.disagree ?? count('disagree')) || 0,
    abstain: Number(sv?.abstain ?? count('abstain')) || 0,
    conclusion: str(sv?.conclusion) || proposal?.conclusion || proposal?.short || '',
  };
}

function bubbleHtml(m) {
  const tm = typeMeta(m.type);
  let head = `<span class="bt">${esc(tm.label)}</span>`;
  let body = m.short || plain(m.text, 80);
  if (m.type === 'vote' && m.voteN) {
    const vm = VOTE_META[m.voteN];
    head = `<span class="bt" style="background:${vm.color}">${vm.icon} ${vm.label}</span>`;
    body = m.position || m.short || plain(m.text, 80);
  } else if (m.type === 'proposal') {
    body = m.short || m.conclusion || plain(m.text, 80);
  }
  const to = m.replyTo && m.type !== 'vote' ? `<span class="to">→ ${esc(bots[m.replyTo]?.name || '')}</span> ` : '';
  return `<div class="bx">${head}${to}${esc(body.length > 90 ? body.slice(0, 90) + '…' : body) || '…'}</div>`;
}

function updateRecent() {
  const seen = new Set(); const rec = [];
  for (let j = state.msgs.length - 1; j >= 0 && rec.length < 3; j--) {
    const m = state.msgs[j];
    if (seen.has(m.id)) continue;
    seen.add(m.id); rec.push(m);
  }
  state.recent = rec;
  for (let id = 1; id <= N_BOTS; id++) {
    const o = overlay[id];
    const rank = rec.findIndex((m) => m.id === id);
    if (rank < 0) { o.bubble.classList.remove('on'); o.bubble._msg = null; o.msg = null; o.rank = -1; continue; }
    const m = rec[rank];
    const key = m.i + '|' + m.ts;
    if (o.msg !== key) {
      o.msg = key; o.bubble._msg = m.i;
      o.bubble.innerHTML = bubbleHtml(m);
      o.bubble.style.setProperty('--tc', m.type === 'vote' && m.voteN ? VOTE_META[m.voteN].color : typeMeta(m.type).color);
      o.bubble.classList.remove('on'); void o.bubble.offsetWidth; o.bubble.classList.add('on');
    }
    o.bubble.style.setProperty('--s', rank === 0 ? 1 : 0.86);
    o.bubble.style.setProperty('--o', rank === 0 ? 1 : 0.8);
    o.rank = rank;
  }
}

function updateTags() {
  for (let id = 1; id <= N_BOTS; id++) {
    const v = state.vote.active ? state.vote.byId.get(id) : null;
    const key = bots[id].name + '|' + (v?.vote || '');
    const o = overlay[id];
    if (o.tagKey === key) continue;
    o.tagKey = key;
    o.tag.innerHTML = (v ? `<span class="vb" style="background:${VOTE_META[v.vote].color}">${VOTE_META[v.vote].icon}</span>` : '') + esc(bots[id].name);
  }
}

async function getText(path) {
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return null;
  return r.text();
}

async function poll() {
  try {
    const [rawMsgs, rawStatus] = await Promise.all([getText('./data/messages.jsonl'), getText('./data/status.json')]);
    let st = {};
    if (rawStatus) { try { const j = JSON.parse(rawStatus); if (j && typeof j === 'object') st = j; } catch { /* tolerate */ } }
    state.status = st;
    const raw = rawMsgs ?? '';
    const key = raw.length + ':' + hashStr(raw) + '|' + (st.session ?? '');
    let changed = false;
    if (key !== state.rawKey) {
      const prevLen = state.msgs.length, prevFirst = state.msgs[0]?.ts, prevSession = state.session;
      state.rawKey = key;
      const { msgs, session } = normalizeMessages(raw, st.session);
      const reset = msgs.length < prevLen || (prevLen && msgs[0]?.ts !== prevFirst) || session !== prevSession;
      state.msgs = msgs; state.session = session;
      state.roles = new Map();
      for (const m of msgs) state.roles.set(m.id, m.role);
      changed = true;
      const newOnes = reset || state.first ? [] : msgs.slice(prevLen);
      if (newOnes.length) startAct(newOnes[newOnes.length - 1], true);
      else if ((state.first || reset) && msgs.length) startAct(msgs[msgs.length - 1], false);
      else if (reset) state.act = null;
    }
    const seed = String(st.session ?? state.session ?? state.msgs[0]?.ts ?? 'p-eq-np');
    if (seed !== currentSeed) { rebuildBots(seed); changed = true; }
    for (let id = 1; id <= N_BOTS; id++) bots[id].name = state.roles.get(id) || ('角色 ' + id);
    const ended = ['consensus', 'stopped'].includes(String(st.state ?? '').toLowerCase());
    state.speakingId = ended ? null : resolveSpeaker(st.speaking);
    state.addressingId = resolveSpeaker(st.addressing);
    if (state.addressingId === state.speakingId) state.addressingId = null;
    computeVotes();
    updateTags();
    if (changed) {
      updateRecent();
      renderLog();
    }
    const vkey = state.vote.active + '|' + [...state.vote.byId.entries()].map(([k, v]) => k + v.vote).join(',') + '|' + state.vote.agree + ':' + state.vote.disagree;
    if (panelBot && $('panel').classList.contains('on') && (changed || (panelBot === 'vote' && vkey !== state.vkey))) renderPanel(panelBot, panelMsg);
    state.vkey = vkey;
    renderHud();
    state.lastOk = Date.now(); state.fails = 0; $('err').style.display = 'none';
  } catch (e) {
    state.fails++;
    if (state.fails >= 2) { $('err').textContent = '数据暂时拉取失败，正在重试…'; $('err').style.display = 'block'; }
  } finally {
    if (state.first) { state.first = false; $('loading').classList.add('off'); }
    if ($('drawer').classList.contains('on') && activeTab === 'final') loadFinal();
  }
}

/* =========================================================================
 * HUD / panels
 * ========================================================================= */
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
function renderHud() {
  const st = state.status;
  const topic = st.topic ? String(st.topic) : 'P ≟ NP 圆桌会议';
  $('topic').textContent = topic; $('topic').title = topic;
  document.title = '圆桌会议 · ' + topic;
  $('st-round').textContent = st.round ?? (state.msgs.length ? state.msgs[state.msgs.length - 1].round : '—') ?? '—';
  const spName = st.speaking ? String(st.speaking) : '';
  let since = '';
  if (st.since) { const d = (Date.now() - new Date(st.since).getTime()) / 1000; if (isFinite(d) && d >= 0) since = d < 90 ? ` · ${Math.round(d)}s` : ` · ${Math.round(d / 60)}min`; }
  const addr = state.addressingId ? bots[state.addressingId].name : (st.addressing && typeof st.addressing !== 'object' ? String(st.addressing) : '');
  $('st-speak').textContent = spName ? spName + (addr ? ' → ' + addr : '') + since : '—';
  const stateName = { running: '进行中', consensus: '已达成共识', stopped: '已停止', voting: '表决中', paused: '暂停' }[String(st.state ?? '').toLowerCase()] ?? (st.state ? String(st.state) : '');
  $('chip-state').style.display = stateName ? '' : 'none';
  $('st-state').textContent = stateName;
  $('chip-state').classList.toggle('bad', String(st.state).toLowerCase() === 'stopped');
  // vote bar
  const V = state.vote, vb = $('votebar');
  vb.classList.toggle('on', V.active);
  if (V.active) {
    const pend = Math.max(0, N_BOTS - V.agree - V.disagree - V.abstain);
    $('vb-a').style.flexGrow = V.agree; $('vb-d').style.flexGrow = V.disagree; $('vb-x').style.flexGrow = V.abstain; $('vb-p').style.flexGrow = pend;
    $('vb-txt').innerHTML = `<b class="ga">✓ ${V.agree}</b><b class="gd">✗ ${V.disagree}</b>` + (V.abstain ? `<b>– ${V.abstain}</b>` : '') + (pend ? `<span>待投 ${pend}</span>` : '');
    vb.title = V.conclusion || '表决';
  }
  $('st-calls').textContent = st.calls ?? 0;
  $('st-429').textContent = st.r429 ?? 0;
  $('chip-429').classList.toggle('bad', Number(st.r429) > 0);
  $('st-msgs').textContent = state.msgs.length;
  const cons = truthy(st.consensus);
  $('st-cons').textContent = cons ? '已达成 ✔' : '未达成';
  $('chip-cons').classList.toggle('good', cons);
  $('consensus-text').innerHTML = cons ? md(str(st.consensus_text) || str(st.votes?.conclusion) || state.vote.conclusion || '') : '';
  $('consensus').classList.toggle('on', cons && !state.consensusClosed);
  if (!cons) state.consensusClosed = false;
  const title = topic.length <= 8 ? topic : 'P ≟ NP';
  drawHolo(title, cons ? '✔ 达成共识' : state.vote.active ? `表决 ${state.vote.agree} : ${state.vote.disagree}` : (st.round != null ? `第 ${st.round} 轮` : '圆桌会议'), cons);
  $('live').classList.toggle('stale', (Date.now() - state.lastOk > 15000 && state.lastOk > 0) || String(st.state).toLowerCase() === 'stopped');
}
setInterval(() => state.lastOk && renderHud(), 1000);

$('votebar').addEventListener('click', () => openPanel('vote'));
$('chip-cons').addEventListener('click', () => { state.consensusClosed = false; renderHud(); });
$('consensus').addEventListener('click', (e) => { if (!e.target.closest('.x')) $('consensus').classList.toggle('full'); });
$('closeCons').addEventListener('click', (e) => { e.stopPropagation(); state.consensusClosed = true; $('consensus').classList.remove('on'); });

let activeTab = 'log';
let logCount = -1;
function renderLog(force) {
  if (!force && !$('drawer').classList.contains('on')) return;
  if (!force && logCount === state.msgs.length) return;
  const el = $('log');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  logCount = state.msgs.length;
  if (!state.msgs.length) { el.innerHTML = '<div class="empty">还没有人发言，小人们正在喝咖啡 ☕</div>'; return; }
  let html = '', lastRound = null;
  for (const m of state.msgs) {
    if (m.round !== lastRound) { html += `<div class="roundsep">— 第 ${esc(m.round)} 轮 —</div>`; lastRound = m.round; }
    const tm = typeMeta(m.type);
    html += `<button class="item" data-i="${m.i}" style="--tc:${tm.color}"><div class="meta"><span class="ty">${esc(tm.label)}</span><span class="who">${esc(m.role)}</span>${m.replyTo ? `<span>→ ${esc(bots[m.replyTo].name)}</span>` : ''}${m.type === 'vote' && m.voteN ? `<span class="ty" style="--tc:${VOTE_META[m.voteN].color}">${VOTE_META[m.voteN].icon} ${VOTE_META[m.voteN].label}</span>` : ''}<span>${esc(fmtTime(m.ts))}</span></div><div class="pv">${esc(m.type === 'vote' && m.position ? m.position : m.short || plain(m.text, 160))}</div></button>`;
  }
  el.innerHTML = html;
  if (nearBottom || force) el.scrollTop = el.scrollHeight;
}
$('log').addEventListener('click', (e) => {
  const b = e.target.closest('.item'); if (!b) return;
  const m = state.msgs[+b.dataset.i]; if (m) openPanel(m.id, m.i);
});

let finalLoading = false;
async function loadFinal() {
  if (finalLoading) return; finalLoading = true;
  try {
    const t = await getText('./data/final.md');
    $('finalPane').innerHTML = t && t.trim() ? md(t) : '<div class="empty">final.md 还没有生成。达成共识后定稿人会写在这里。</div>';
  } catch { $('finalPane').innerHTML = '<div class="empty">final.md 暂时读不到。</div>'; }
  finally { finalLoading = false; }
}
function setTab(t) {
  activeTab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('log').style.display = t === 'log' ? '' : 'none';
  $('finalPane').style.display = t === 'final' ? '' : 'none';
  if (t === 'final') loadFinal(); else renderLog(true);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('btnLog').addEventListener('click', () => { $('panel').classList.remove('on'); $('drawer').classList.add('on'); setTab('log'); });
$('btnFinal').addEventListener('click', () => { $('panel').classList.remove('on'); $('drawer').classList.add('on'); setTab('final'); });
$('closeDrawer').addEventListener('click', () => $('drawer').classList.remove('on'));

let panelBot = null, panelMsg = null;
function openPanel(id, msgIndex) {
  panelBot = id; panelMsg = msgIndex ?? null;
  if (isMobile) $('drawer').classList.remove('on');
  renderPanel(id, panelMsg);
  $('panel').classList.add('on');
  $('panelBody').scrollTop = 0;
}
function renderVotePanel() {
  const V = state.vote;
  const pend = Math.max(0, N_BOTS - V.agree - V.disagree - V.abstain);
  $('panelTitle').textContent = '✋ 举牌表决' + (V.active ? '' : '（已结束）');
  $('panelSub').textContent = `赞成 ${V.agree} · 反对 ${V.disagree}` + (V.abstain ? ` · 弃权 ${V.abstain}` : '') + (pend ? ` · 待投 ${pend}` : '');
  $('panelDot').style.setProperty('--c', V.disagree > V.agree ? '#e0483d' : '#23a26b');
  let html = '';
  if (V.proposal || V.conclusion) {
    const p = V.proposal;
    html += `<div class="msgcard" style="--tc:${typeMeta('proposal').color}"><div class="meta"><span class="ty" style="--tc:${typeMeta('proposal').color}">提议</span>${p ? `<span>${esc(p.role)}</span><span>第 ${esc(p.round)} 轮</span><span>${esc(fmtTime(p.ts))}</span>` : ''}</div><div class="md"><blockquote>${md(V.conclusion)}</blockquote></div></div>`;
  }
  html += '<div class="sec">各席投票</div>';
  for (let id = 1; id <= N_BOTS; id++) {
    const v = V.byId.get(id);
    const vm = v ? VOTE_META[v.vote] : null;
    html += `<button class="item vrow" data-bot="${id}" ${v ? `data-i="${v.msg.i}"` : ''} style="--tc:${vm ? vm.color : '#cfc6bb'}"><div class="meta"><span class="dot" style="--c:${bots[id].color};width:16px;height:16px;border-width:2px"></span><span class="who">${esc(bots[id].name)}</span>${vm ? `<span class="ty">${vm.icon} ${vm.label}</span>` : '<span>待投…</span>'}</div>${v ? `<div class="pv">${esc(v.msg.position || v.msg.short || plain(v.msg.text, 140))}</div>` : ''}</button>`;
  }
  $('panelBody').innerHTML = html;
}
$('panelBody').addEventListener('click', (e) => {
  const b = e.target.closest('.vrow'); if (!b) return;
  openPanel(+b.dataset.bot, b.dataset.i != null ? +b.dataset.i : undefined);
});
function renderPanel(id, msgIndex) {
  if (id === 'vote') return renderVotePanel();
  const mine = state.msgs.filter((m) => m.id === id);
  const sel = msgIndex != null ? state.msgs[msgIndex] : mine[mine.length - 1];
  if (!bots[id]) return;
  $('panelTitle').textContent = bots[id].name;
  $('panelSub').textContent = `${id} 号席 · 共 ${mine.length} 条发言` + (state.speakingId === id ? ' · 正在思考…' : '');
  $('panelDot').style.setProperty('--c', bots[id].color || '#888');
  let html = '';
  if (sel) {
    const tm = typeMeta(sel.type);
    const vm = sel.voteN ? VOTE_META[sel.voteN] : null;
    const vote = vm ? `<span class="ty" style="--tc:${vm.color}">${vm.icon} ${vm.label}</span>` : '';
    const to = sel.replyTo ? `<span>回应 <b>${esc(bots[sel.replyTo].name)}</b></span>` : '';
    let extra = '';
    if (sel.short) extra += `<div class="short">💬 ${esc(sel.short)}</div>`;
    if (sel.type === 'vote' && sel.position) extra += `<div class="short" style="border-color:${vm ? vm.color : '#aaa'}">立场：${esc(sel.position)}</div>`;
    if (sel.conclusion) extra += `<div class="md"><blockquote>${md(sel.conclusion)}</blockquote></div>`;
    html += `<div class="msgcard" style="--tc:${vm ? vm.color : tm.color}"><div class="meta"><span class="ty" style="--tc:${tm.color}">${esc(tm.label)}</span>${vote}<span>第 ${esc(sel.round)} 轮</span><span>${esc(fmtTime(sel.ts))}</span>${to}</div>${extra}<div class="md">${md(sel.text)}</div></div>`;
  } else html += '<div class="empty">这位还没发过言。</div>';
  const others = mine.filter((m) => m !== sel).reverse();
  if (others.length) {
    html += `<div class="sec">TA 的历史发言（${others.length}）</div>`;
    for (const m of others) {
      const tm = typeMeta(m.type);
      html += `<details class="hist" style="--tc:${tm.color}"><summary><span class="ty" style="--tc:${tm.color}">${esc(tm.label)}</span> 第 ${esc(m.round)} 轮 · ${esc(fmtTime(m.ts))}<div class="pv" style="color:#6f6258;font-size:12.5px">${esc(m.short || plain(m.text, 90))}</div></summary><div class="md">${md(m.text)}</div></details>`;
    }
  }
  $('panelBody').innerHTML = html;
}
$('closePanel').addEventListener('click', () => $('panel').classList.remove('on'));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('panel').classList.remove('on'); $('drawer').classList.remove('on'); } });

/* =========================================================================
 * Picking & camera interaction
 * ========================================================================= */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 600;
  downAt = null;
  if (moved > 8 || !quick) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(bots.filter(Boolean).map((b) => b.root), true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.botId == null) o = o.parent;
    if (o) { openPanel(o.userData.botId); return; }
  }
});
let resumeTimer = 0;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTimer); $('hint').style.opacity = 0; });
controls.addEventListener('end', () => { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 7000); });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); fitCamera(false); });
setTimeout(() => { $('hint').style.opacity = 0; }, 12000);

/* =========================================================================
 * Simulation
 * ========================================================================= */
function botRole(b, now) {
  const a = state.act;
  if (a && a.botId === b.id && now < a.until) return a.kind;
  if (a && a.target === b.id && now < a.until && bots[a.botId].gBlend > 0.3) {
    if (a.kind === 'rebut') return 'shocked';
    if (a.kind === 'address') return 'listen';
  }
  if (state.speakingId === b.id) return 'think';
  if (state.vote.active && state.vote.byId.has(b.id)) return 'voted';
  if (state.addressingId === b.id && state.speakingId && bots[state.speakingId].gBlend > 0.3) return 'listen';
  if (truthy(state.status.consensus) && (now + b.id * 1.37) % 15 < 4.5) return 'cheer';
  return 'idle';
}

function updateBot(b, dt, now, focus) {
  const role = botRole(b, now);
  if (role !== b.role) {
    if (b.role !== 'idle' && role === 'idle') { b.mode = 'wander'; b.wanders = 0; b.pause = 0.5; b.goal.copy(ringPos(b.id, SEAT_R)); b.mode = 'return'; }
    b.role = role;
  }
  const home = ringPos(b.id, SEAT_R);
  let allowTable = false, faceTo = null, wantSit = false, speedMax = 1.15;

  if (role === 'present') {
    const off = ringPos(b.id, 0.35);
    b.goal.copy(off); allowTable = true; speedMax = 1.5;
  } else if (role === 'rebut' || role === 'address') {
    const t = bots[state.act.target];
    if (t) {
      const tp = t.pos.clone();
      const inward = tp.clone().multiplyScalar(-1).normalize();
      b.goal.copy(tp).addScaledVector(inward, 0.8);
      if (b.goal.length() < CLEAR_R + 0.05) b.goal.setLength(CLEAR_R + 0.05);
      faceTo = t.pos; speedMax = role === 'rebut' ? 1.7 : 1.35;
    } else { b.goal.copy(ringPos(b.id, 0.35)); allowTable = true; }
  } else if (role === 'think' || role === 'vote' || role === 'voted' || role === 'retract') {
    b.goal.copy(ringPos(b.id, STAND_R));
    if (role === 'think' && state.addressingId) faceTo = bots[state.addressingId].pos;
    if ((role === 'vote' || role === 'voted') && state.vote.proposal && state.vote.proposal.id !== b.id) faceTo = bots[state.vote.proposal.id].pos;
  } else if (role === 'shocked' || role === 'cheer' || role === 'listen') {
    // stay put, stand up
    b.goal.copy(b.pos);
    if (role === 'listen') faceTo = (state.act && state.act.target === b.id && state.act.kind === 'address' ? bots[state.act.botId] : bots[state.speakingId] || bots[state.act?.botId])?.pos || null;
    if (role === 'shocked') faceTo = bots[state.act.botId].pos;
  } else {
    // idle wander / sit cycle
    b.modeT -= dt;
    if (b.mode === 'sit') {
      b.goal.copy(home);
      if (b.pos.distanceTo(home) < 0.08) wantSit = true;
      if (b.modeT <= 0) { b.mode = 'wander'; b.wanders = 1 + Math.floor(Math.random() * 3); b.pickWanderGoal(); b.pause = 0; }
    } else if (b.mode === 'wander') {
      if (b.pos.distanceTo(b.goal) < 0.1) {
        b.pause += dt;
        if (b.pause > 1.2 + Math.random() * 2.5) {
          b.pause = 0; b.wanders--;
          if (b.wanders <= 0) { b.mode = 'return'; b.goal.copy(home); } else b.pickWanderGoal();
        }
      }
    } else { // return
      b.goal.copy(home);
      if (b.pos.distanceTo(home) < 0.08) { b.mode = 'sit'; b.modeT = 6 + Math.random() * 14; }
    }
  }

  // sitting blend & movement
  b.sitTarget = wantSit ? 1 : 0;
  b.sit = damp(b.sit, b.sitTarget, 6, dt);
  const d = b.pos.distanceTo(b.goal);
  let desired = d > 0.05 ? Math.min(speedMax, d * 2.5) : 0;
  if (b.sit > 0.15) desired = 0;
  const dir = d > 1e-4 ? b.goal.clone().sub(b.pos).divideScalar(d) : new THREE.Vector2();
  // steer around the table when the straight path would cross it
  if (!allowTable && !b.onTable && d > 0.3) {
    const t = clamp(-(b.pos.x * dir.x + b.pos.y * dir.y), 0, d);
    const cx = b.pos.x + dir.x * t, cz = b.pos.y + dir.y * t;
    if (Math.hypot(cx, cz) < CLEAR_R + 0.15) {
      const r0 = Math.max(1e-3, b.pos.length());
      const sgn = (b.pos.x * b.goal.y - b.pos.y * b.goal.x) >= 0 ? 1 : -1;
      const out = r0 < CLEAR_R + 0.35 ? 0.35 : 0;
      dir.set((-b.pos.y * sgn) / r0 + (b.pos.x / r0) * out, (b.pos.x * sgn) / r0 + (b.pos.y / r0) * out).normalize();
      if (b.sit <= 0.15) desired = Math.max(desired, Math.min(speedMax, 1.0));
    }
  }
  b.vel.x = damp(b.vel.x, dir.x * desired, 8, dt);
  b.vel.y = damp(b.vel.y, dir.y * desired, 8, dt);
  b.pos.addScaledVector(b.vel, dt);

  // separation (skip when sitting)
  for (let j = 1; j <= N_BOTS; j++) {
    const o = bots[j]; if (o === b) continue;
    const dx = b.pos.x - o.pos.x, dz = b.pos.y - o.pos.y, dd = Math.hypot(dx, dz);
    if (dd < 0.58 && dd > 1e-4 && b.sit < 0.5 && b.onTable === o.onTable) {
      const push = (0.58 - dd) * 0.5;
      b.pos.x += (dx / dd) * push; b.pos.y += (dz / dd) * push;
    }
  }
  const r = b.pos.length();
  if (!allowTable && !b.onTable && r < CLEAR_R) b.pos.setLength(CLEAR_R);
  if (r > 9) b.pos.setLength(9);

  // table hopping
  const wantOn = b.onTable ? r < TABLE_R + 0.1 : (allowTable && r < TABLE_R + 0.05);
  if (wantOn !== b.onTable) { b.onTable = wantOn; b.hop = { t: 0, from: b.ground, to: wantOn ? TABLE_TOP : 0 }; }
  let y;
  if (b.hop) {
    b.hop.t += dt / 0.42;
    const p = Math.min(1, b.hop.t);
    y = lerp(b.hop.from, b.hop.to, p) + Math.sin(Math.PI * p) * 0.4;
    if (p >= 1) { b.ground = b.hop.to; b.hop = null; }
  } else y = b.ground;

  // facing
  const speed = b.vel.length();
  let tf = b.facing;
  if (speed > 0.15) tf = Math.atan2(b.vel.x, b.vel.y);
  else if (b.sit > 0.3 || wantSit) tf = seatAngle(b.id) + Math.PI;
  else if (faceTo) tf = Math.atan2(faceTo.x - b.pos.x, faceTo.y - b.pos.y);
  else if (role === 'present') tf = now * 0.55 + b.id;
  else if (focus && focus !== b) tf = Math.atan2(focus.pos.x - b.pos.x, focus.pos.y - b.pos.y);
  else if (role !== 'idle') tf = Math.atan2(-b.pos.x, -b.pos.y);
  b.facing = dampAngle(b.facing, tf, speed > 0.15 ? 10 : 3, dt);

  // gesture blend only once arrived
  const arrived = d < 0.2 && !b.hop;
  b.gBlend = damp(b.gBlend, role !== 'idle' && arrived ? 1 : 0, 5, dt);

  // walk cycle
  b.walkAmt = damp(b.walkAmt, clamp(speed / 0.8, 0, 1), 10, dt);
  b.phase += dt * (4 + speed * 7);
  const sw = Math.sin(b.phase) * b.walkAmt;

  // targets
  const c = b.cur, T = {};
  T.legL = sw * 0.75; T.legR = -sw * 0.75;
  T.aLx = -sw * 0.6; T.aRx = sw * 0.6; T.aLz = -0.18; T.aRz = 0.18;
  T.headTilt = Math.sin(now * 0.9 + b.id) * 0.06; T.headNod = 0; T.mouth = 1; T.brow = 0;
  const g = b.gBlend;
  const mix = (k, v) => { T[k] = lerp(T[k], v, g); };
  let bounce = 0;
  if (role === 'present') {
    mix('aLz', -(1.5 + Math.sin(now * 5.2) * 0.7)); mix('aRz', 1.2 + Math.sin(now * 4.1 + 1.7) * 0.9);
    mix('aLx', -0.5 + Math.sin(now * 3) * 0.3); mix('aRx', -0.6 + Math.cos(now * 3.3) * 0.3);
    T.mouth = lerp(1, 0.5 + Math.abs(Math.sin(now * 13)) * 1.3, g);
    bounce = Math.abs(Math.sin(now * 5.2)) * 0.05 * g;
  } else if (role === 'rebut') {
    mix('aRx', -1.55 + Math.sin(now * 14) * 0.18); mix('aRz', 0.05);
    mix('aLz', -0.9); mix('aLx', 0.5);
    T.mouth = lerp(1, 0.6 + Math.abs(Math.sin(now * 15)) * 1.4, g); T.brow = g;
    bounce = Math.max(0, Math.sin(now * 7)) * 0.07 * g;
  } else if (role === 'think') {
    mix('aRx', -2.1); mix('aRz', 0.6); mix('headTilt', 0.22 + Math.sin(now * 1.3) * 0.05); mix('headNod', -0.12);
    mix('aLz', -0.15);
  } else if (role === 'vote' || role === 'voted') {
    const myVote = state.vote.byId.get(b.id)?.vote || state.act?.msg?.voteN || 'agree';
    mix('aRz', 2.75 + Math.sin(now * 3 + b.id) * 0.12); mix('aRx', -0.15);
    mix('aLz', -0.35);
    if (myVote === 'disagree') { mix('headTilt', Math.sin(now * 7) * 0.12); T.brow = g; }
    else mix('headNod', Math.sin(now * 4 + b.id) * 0.1);
    const party = truthy(state.status.consensus) ? 0.22 : 0.06;
    bounce = Math.max(0, Math.sin(now * (role === 'vote' ? 6 : 4) + b.id)) * party * g + (role === 'vote' ? Math.max(0, Math.sin(now * 6)) * 0.1 * g : 0);
  } else if (role === 'address') {
    mix('aRx', -1.15 + Math.sin(now * 4) * 0.25); mix('aRz', 0.35 + Math.sin(now * 2.3) * 0.15);
    mix('aLz', -0.7 - Math.sin(now * 3.1) * 0.3); mix('aLx', -0.5);
    T.mouth = lerp(1, 0.6 + Math.abs(Math.sin(now * 12)) * 1.1, g);
    bounce = Math.abs(Math.sin(now * 4)) * 0.03 * g;
  } else if (role === 'listen') {
    mix('headNod', 0.05 + Math.sin(now * 3.2 + b.id) * 0.1); mix('aLz', -0.3); mix('aRz', 0.3);
  } else if (role === 'retract') {
    mix('aLz', -2.3); mix('aRz', 2.3); mix('aLx', -0.9); mix('aRx', -0.9); mix('headNod', 0.28);
  } else if (role === 'cheer') {
    mix('aLz', -2.6 + Math.sin(now * 9 + b.id) * 0.25); mix('aRz', 2.6 - Math.sin(now * 9 + b.id) * 0.25);
    T.mouth = lerp(1, 1.6, g);
    bounce = Math.abs(Math.sin(now * 4.5 + b.id)) * 0.28 * g;
  } else if (role === 'shocked') {
    mix('aLz', -1.0 + Math.sin(now * 20) * 0.1); mix('aRz', 1.0); mix('aLx', -0.4); mix('aRx', -0.4);
    T.mouth = lerp(1, 1.8, g);
  }
  // sitting pose
  if (b.sit > 0.01) {
    T.legL = lerp(T.legL, -1.45 + Math.sin(now * 3 + b.id) * 0.15, b.sit);
    T.legR = lerp(T.legR, -1.45 - Math.sin(now * 3 + b.id) * 0.15, b.sit);
    T.aLx = lerp(T.aLx, -0.5, b.sit); T.aRx = lerp(T.aRx, -0.5, b.sit);
  }
  for (const k in T) c[k] = damp(c[k], T[k], 12, dt);

  // blink
  b.blinkIn -= dt;
  if (b.blinkIn <= 0) { b.blinkT = 0.13; b.blinkIn = Math.random() < 0.2 ? 0.25 : 1.8 + Math.random() * 3.5; }
  b.blinkT -= dt;
  const eyeY = b.blinkT > 0 ? 0.12 : 1;
  for (const e of b.eyes) e.scale.y = eyeY;

  // apply transforms
  const sitY = b.sit * 0.11;
  const bob = Math.abs(Math.sin(b.phase)) * 0.06 * b.walkAmt + bounce + Math.sin(now * 2.2 + b.id) * 0.008;
  b.root.position.set(b.pos.x, y + sitY + bob, b.pos.y);
  b.root.rotation.y = b.facing;
  b.body.rotation.z = Math.sin(b.phase) * 0.09 * b.walkAmt;
  b.legs[0].rotation.x = c.legL; b.legs[1].rotation.x = c.legR;
  b.arms[0].rotation.set(c.aLx, 0, c.aLz); b.arms[1].rotation.set(c.aRx, 0, c.aRz);
  b.torso.scale.y = 1 + Math.sin(now * 2.2 + b.id) * 0.02;
  // head looks at focus
  let lookYaw = 0;
  const lookTarget = role === 'shocked' ? bots[state.act.botId]
    : (role === 'rebut' || role === 'address') ? bots[state.act.target]
    : role === 'listen' ? (state.act && state.act.target === b.id && now < state.act.until ? bots[state.act.botId] : bots[state.speakingId])
    : role === 'think' && state.addressingId ? bots[state.addressingId]
    : focus;
  if (lookTarget && lookTarget !== b) lookYaw = clamp(wrapAngle(Math.atan2(lookTarget.pos.x - b.pos.x, lookTarget.pos.y - b.pos.y) - b.facing), -1.15, 1.15);
  else if (role === 'idle') lookYaw = Math.sin(now * 0.4 + b.id * 1.7) * 0.5;
  c.headYaw = damp(c.headYaw, lookYaw, 5, dt);
  b.headPivot.rotation.set(c.headNod - (lookTarget?.onTable && !b.onTable ? 0.12 : 0), c.headYaw, c.headTilt);
  b.mouth.scale.set(1, c.mouth, 1);
  b.brows[0].rotation.z = -(b.browBase + c.brow * 0.5); b.brows[1].rotation.z = b.browBase + c.brow * 0.5;
  if (b.propeller) b.propeller.rotation.y += dt * (6 + speed * 20);
  const pv = (role === 'voted' || role === 'vote') ? (state.vote.byId.get(b.id)?.vote || (role === 'vote' ? state.act?.msg?.voteN : null)) : null;
  b.paddle.visible = !!pv && b.gBlend > 0.3;
  if (b.paddle.visible) { b.paddleFace.material = PADDLE[pv] || PADDLE.abstain; b.paddle.scale.setScalar(clamp((b.gBlend - 0.3) / 0.5, 0.01, 1)); }
  b.headTopY = y + sitY + 1.48;
}

/* =========================================================================
 * Loop
 * ========================================================================= */
const proj = new THREE.Vector3();
let last = performance.now();
let perfAcc = 0, perfFrames = 0;
function frame() {
  requestAnimationFrame(frame);
  const tnow = performance.now();
  const dt = Math.min(0.05, (tnow - last) / 1000);
  last = tnow;
  const now = tnow / 1000;

  // who everyone looks at
  let focus = null;
  if (state.act && now < state.act.until) focus = bots[state.act.botId];
  else if (state.speakingId) focus = bots[state.speakingId];
  for (let id = 1; id <= N_BOTS; id++) updateBot(bots[id], dt, now, focus);

  holo.position.y = 2.95 + Math.sin(now * 1.4) * 0.06;
  holoRing.rotation.z = now * 0.6;
  holoRing.position.y = 2.3 + Math.sin(now * 1.4 + 1) * 0.05;

  controls.update();
  renderer.render(scene, camera);

  // overlay
  const w = innerWidth, h = innerHeight;
  for (let id = 1; id <= N_BOTS; id++) {
    const b = bots[id], o = overlay[id];
    proj.set(b.pos.x, b.headTopY ?? 1.5, b.pos.y).project(camera);
    const vis = proj.z < 1 && proj.z > -1;
    const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
    o.anchor.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    o.anchor.style.display = vis ? '' : 'none';
    o.anchor.style.zIndex = String(Math.round((1 - proj.z) * 100000) + (o.rank === 0 ? 1000 : 0));
    const thinking = state.speakingId === id;
    if (thinking !== o.thinking) { o.thinking = thinking; o.think.classList.toggle('on', thinking); o.bubble.classList.toggle('with-think', thinking); }
  }

  // adaptive resolution for weaker devices
  perfAcc += tnow - (frame._p || tnow); frame._p = tnow; perfFrames++;
  if (perfFrames >= 90) {
    const avg = perfAcc / perfFrames;
    if (avg > 30 && pixelRatio > 0.8 && !document.hidden) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); }
    perfAcc = 0; perfFrames = 0;
  }
}

rebuildBots('p-eq-np');
poll();
setInterval(poll, 3000);
setTimeout(() => $('loading').classList.add('off'), 4000);
requestAnimationFrame(frame);
