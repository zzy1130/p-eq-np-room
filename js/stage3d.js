// AI 圆桌 & 辩论厅 — 3D stage (three.js r170, vendored).
// Two layouts: 'roundtable' (round table + chairs) and 'debate' (aff/neg podiums, lectern, judge bench, timer board).
// The stage is driven by update(frame); it never fetches data itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const dampAngle = (cur, tgt, k, dt) => cur + wrapAngle(tgt - cur) * (1 - Math.exp(-k * dt));
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const chance = (rng, p) => rng() < p;
const rand = (rng, a, b) => a + (b - a) * rng();

export const IS_MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

// ---------------------------------------------------------------- shared materials / geometry
const gradTex = new THREE.DataTexture(new Uint8Array([110, 175, 230, 255]), 4, 1, THREE.RedFormat);
gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true;
const matCache = new Map();
function toon(color, extra) {
  const key = new THREE.Color(color).getHexString() + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...(extra || {}) }); matCache.set(key, m); }
  return m;
}
const SEG = IS_MOBILE ? 0.6 : 1;
const s = (n) => Math.max(6, Math.round(n * SEG));
const G = {
  sphere: new THREE.SphereGeometry(1, s(22), s(14)),
  sphereLo: new THREE.SphereGeometry(1, 10, 7),
  hemi: new THREE.SphereGeometry(1, s(22), s(10), 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, s(20)),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, s(20), 1, true),
  cone: new THREE.ConeGeometry(1, 1, s(14)),
  torus: new THREE.TorusGeometry(1, 0.13, 6, s(24)),
  torusSq: new THREE.TorusGeometry(1, 0.13, 6, 4),
  arc: new THREE.TorusGeometry(1, 0.22, 6, 12, Math.PI),
  box: new THREE.BoxGeometry(1, 1, 1),
  leg: new THREE.CapsuleGeometry(0.075, 0.14, 3, 8),
  arm: new THREE.CapsuleGeometry(0.06, 0.15, 3, 8),
  torso: new THREE.CapsuleGeometry(0.21, 0.16, 4, s(14)),
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
function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

// ---------------------------------------------------------------- paddles (billboards → always readable)
function paddleTexture(bg, glyph, label) {
  const { g, t } = canvasTex(160, 200);
  g.fillStyle = '#8c552b'; g.fillRect(74, 120, 12, 80);
  g.beginPath(); g.arc(80, 72, 66, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 64px ${FONT}`; g.fillText(glyph, 80, 62);
  g.font = `800 24px ${FONT}`; g.fillText(label, 80, 108);
  return t;
}
const PADDLE_TEX = {
  agree: paddleTexture('#1f9d63', '✓', '赞成'),
  disagree: paddleTexture('#d9443a', '✗', '反对'),
};

// ---------------------------------------------------------------- character builder (from the original room)
const SKINS = ['#ffdcc2', '#f6c9a4', '#eab48b', '#cf946a', '#a8704b', '#ffe6d3', '#f1c7a0'];
const FUNNY_SKINS = ['#a9e3a0', '#b9d5ff', '#e7c4ff', '#ffd1dc'];
const HAIRS = ['#2b2320', '#5a3825', '#8b5a2b', '#d8a24a', '#f1d28a', '#c0392b', '#e86aa6', '#4e7ad8', '#efefef', '#6b4fa0', '#2f9e84'];
const HAIR_STYLES = ['cap', 'spiky', 'curly', 'mohawk', 'ahoge', 'pigtails', 'bun', 'bald'];
const HAT_STYLES = ['top', 'beanie', 'party', 'cap', 'crown', 'propeller', 'chef', 'bow'];
const SAFE_HAIR_WITH_HAT = ['cap', 'pigtails', 'bald', 'cap'];
const HEAD_R = { x: 0.37, y: 0.34, z: 0.35 };
const onHead = (x, y, k = 1) => { const t = 1 - (x / HEAD_R.x) ** 2 - (y / HEAD_R.y) ** 2; return HEAD_R.z * Math.sqrt(Math.max(0.0, t)) * k; };

class Bot {
  constructor(id, scene) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.userData.botId = id;
    scene.add(this.root);
    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.goal = new THREE.Vector2();
    this.facing = 0;
    this.ground = 0;
    this.sit = 0;
    this.phase = Math.random() * 10; this.walkAmt = 0;
    this.blinkIn = 1 + Math.random() * 3; this.blinkT = 0;
    this.gBlend = 0;
    this.idleT = 4 + Math.random() * 10; this.idleGoal = null;
    this.cur = { aLx: 0, aLz: 0.2, aRx: 0, aRz: -0.2, legL: 0, legR: 0, headTilt: 0, headNod: 0, headYaw: 0, mouth: 1, brow: 0 };
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

    this.R = R;
    return { main, light };
  }
}

// ---------------------------------------------------------------- Gemini judge: four-point sparkle above the head
function sparkleGeometry() {
  const sh = new THREE.Shape();
  const R = 0.22, r = 0.055;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, rad = i % 2 === 0 ? R : r;
    const x = Math.sin(a) * rad, y = Math.cos(a) * rad;
    i === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
}
function addGeminiStar(b) {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0x8ab4ff, emissive: 0x4b3bd6, emissiveIntensity: 0.6, gradientMap: gradTex });
  const star = new THREE.Mesh(sparkleGeometry(), mat); star.position.z = -0.025; g.add(star);
  const small = new THREE.Mesh(sparkleGeometry(), new THREE.MeshToonMaterial({ color: 0xc58af9, emissive: 0x7b2bd6, emissiveIntensity: 0.5, gradientMap: gradTex }));
  small.scale.setScalar(0.45); small.position.set(0.24, 0.16, 0); g.add(small);
  g.position.set(0, 0.62, 0);
  b.head.add(g);
  b.sparkle = g;
  // robe: a wide cone body cover in Gemini blue-violet
  mesh(G.cone, 0x5b6cff, { p: [0, 0.38, 0], s: [0.36, 0.62, 0.34], r: [Math.PI, 0, 0], cast: true, parent: b.body });
}

// ---------------------------------------------------------------- stage
export function createStage(container, overlayRoot, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, powerPreference: IS_MOBILE ? 'low-power' : 'high-performance' });
  const maxPR = IS_MOBILE ? 1.25 : 2;
  let pixelRatio = Math.min(devicePixelRatio || 1, maxPR);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = !IS_MOBILE;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'stage-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.rotateSpeed = IS_MOBILE ? 0.6 : 0.8;

  const hemi = new THREE.HemisphereLight(0xfff4e2, 0xa47a55, 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.75);
  sun.position.set(6, 12, 5); sun.castShadow = !IS_MOBILE;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 2, far: 32 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  scene.add(sun);

  let world = new THREE.Group(); scene.add(world);
  // speaker spotlight (scene-level, survives layout changes)
  const focusSpot = new THREE.SpotLight(0xfff3d6, 0, 16, 0.32, 0.55, 1.2);
  focusSpot.castShadow = false; scene.add(focusSpot, focusSpot.target);
  const light0 = { hemi: 1.1, sun: 1.75 };
  const cam = { userUntil: 0, base: null, dist: 0 };
  let layout = null;          // {mode, obstacles, homes, ...}
  let bots = new Map();       // id -> Bot
  let overlay = new Map();    // id -> {anchor, tag, think, bubble}
  let frame = {};             // last frame from app
  let board = null;           // debate timer board / roundtable holo
  let sceneKey = '';
  let celebrate = null;       // {winner, t0}

  // ------------------------------------------------ layouts
  function clearWorld() {
    scene.remove(world);
    world.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose?.(); });
    world = new THREE.Group(); scene.add(world);
    for (const b of bots.values()) { scene.remove(b.root); if (b.paddle) { scene.remove(b.paddle); b.paddle.material.dispose(); } }
    bots = new Map();
    overlayRoot.innerHTML = '';
    overlay = new Map();
  }

  function holoBoard(w, h, pos, scale) {
    const tex = canvasTex(w, h);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.t, transparent: true, depthWrite: false, fog: false }));
    sp.scale.set(...scale); sp.position.set(...pos); sp.renderOrder = 2;
    world.add(sp);
    return { ...tex, sprite: sp, key: '' };
  }

  function buildRoundtable(roles) {
    const BG = 0xefe3cf;
    scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 18, 40);
    const n = roles.length;
    const TABLE_R = n > 7 ? 2.2 : 1.8, TABLE_TOP = 0.6, SEAT_R = TABLE_R + 1.35;
    const ang = (i) => (i / n) * Math.PI * 2 + Math.PI / n;
    const ring = (i, r) => new THREE.Vector2(Math.sin(ang(i)) * r, Math.cos(ang(i)) * r);
    mesh(new THREE.CircleGeometry(60, 48), 0xeadabf, { r: [-Math.PI / 2, 0, 0], recv: true, parent: world });
    mesh(new THREE.CircleGeometry(SEAT_R + 1.85, 64), 0xd9774f, { r: [-Math.PI / 2, 0, 0], p: [0, 0.005, 0], recv: true, parent: world });
    mesh(new THREE.RingGeometry(SEAT_R + 1.2, SEAT_R + 1.45, 64), 0xf4c46a, { r: [-Math.PI / 2, 0, 0], p: [0, 0.01, 0], recv: true, parent: world });
    const table = new THREE.Group(); world.add(table);
    mesh(G.cyl, 0xb87943, { p: [0, TABLE_TOP - 0.06, 0], s: [TABLE_R, 0.12, TABLE_R], cast: true, recv: true, parent: table });
    mesh(G.torus, 0x8c552b, { p: [0, TABLE_TOP - 0.05, 0], s: [TABLE_R, TABLE_R, 0.55], r: [Math.PI / 2, 0, 0], cast: true, parent: table });
    mesh(G.cyl, 0x3f8f6b, { p: [0, TABLE_TOP + 0.003, 0], s: [TABLE_R - 0.3, 0.01, TABLE_R - 0.3], recv: true, parent: table });
    mesh(G.cyl, 0x8c552b, { p: [0, TABLE_TOP / 2 - 0.05, 0], s: [0.38, TABLE_TOP - 0.1, 0.38], cast: true, parent: table });
    mesh(G.cyl, 0x8c552b, { p: [0, 0.04, 0], s: [0.9, 0.08, 0.9], cast: true, recv: true, parent: table });
    const homes = new Map(), facings = new Map(), stands = new Map(), cushions = new Map();
    const obstacles = [{ x: 0, z: 0, r: TABLE_R + 0.25, big: true }];
    roles.forEach((r, i) => {
      const p = ring(i, SEAT_R);
      const c = new THREE.Group(); c.position.set(p.x, 0, p.y); c.rotation.y = ang(i) + Math.PI; world.add(c);
      const cushion = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex });
      mesh(G.cyl, 0x7a4a26, { p: [0, 0.17, 0], s: [0.06, 0.34, 0.06], cast: true, parent: c });
      mesh(G.cyl, 0x7a4a26, { p: [0, 0.02, 0], s: [0.26, 0.04, 0.26], parent: c });
      mesh(G.cyl, 0x8c552b, { p: [0, 0.33, 0], s: [0.34, 0.05, 0.34], cast: true, parent: c });
      mesh(G.cyl, cushion, { p: [0, 0.37, 0], s: [0.3, 0.05, 0.3], cast: true, recv: true, parent: c });
      mesh(G.box, 0x8c552b, { p: [0, 0.68, -0.31], s: [0.56, 0.5, 0.07], r: [-0.12, 0, 0], cast: true, parent: c });
      mesh(G.box, cushion, { p: [0, 0.69, -0.27], s: [0.46, 0.38, 0.03], r: [-0.12, 0, 0], parent: c });
      cushions.set(r.id, cushion);
      homes.set(r.id, p); facings.set(r.id, ang(i) + Math.PI);
      stands.set(r.id, ring(i, TABLE_R + 0.6));
      // chair backrest is the obstacle (the seat itself is where the bot sits)
      const back = ring(i, SEAT_R + 0.32);
      obstacles.push({ x: back.x, z: back.y, r: 0.36, owner: r.id });
      const pp = ring(i, TABLE_R - 0.6);
      mesh(G.box, 0xfffaf0, { p: [pp.x, TABLE_TOP + 0.012, pp.y], s: [0.3, 0.005, 0.4], r: [0, ang(i), 0], recv: true, parent: world });
    });
    // plants
    [[-7, -4, 1.2], [7, -3.6, 1], [-6, 6, 0.9], [6.5, 5.5, 1.3]].forEach(([x, z, k]) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(k); world.add(g);
      mesh(G.cyl, 0xc8673e, { p: [0, 0.25, 0], s: [0.32, 0.5, 0.32], cast: true, parent: g });
      [[0, 0.95, 0, 0.45], [0.25, 0.8, 0.1, 0.33], [-0.22, 0.85, -0.1, 0.35]].forEach(([a, b, c, r], i) =>
        mesh(G.sphereLo, i % 2 ? 0x5aa86a : 0x4b9a5d, { p: [a, b, c], s: r, cast: true, parent: g }));
    });
    board = holoBoard(512, 256, [0, 2.9, 0], [2.4, 1.2, 1]);
    controls.target.set(0, 0.9, 0);
    controls.minDistance = 5; controls.maxDistance = 26; controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.36;
    controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.3;
    return { mode: 'roundtable', homes, facings, stands, cushions, obstacles, center: new THREE.Vector2(0, 0),
             radius: SEAT_R + 1.4, tableR: TABLE_R, sitAtHome: true, ringPoint: (a, r) => new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r) };
  }

  function buildDebate(roles) {
    const BG = 0x1f2433;
    scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 20, 42);
    hemi.intensity = 0.9; sun.intensity = 1.5;
    mesh(new THREE.PlaneGeometry(60, 60), 0x2a3042, { r: [-Math.PI / 2, 0, 0], recv: true, parent: world });
    // stage floor
    mesh(G.box, 0x8a5a3a, { p: [0, 0.06, -0.8], s: [13, 0.12, 8.6], recv: true, cast: true, parent: world });
    mesh(G.box, 0xa86f45, { p: [0, 0.125, -0.8], s: [12.6, 0.01, 8.2], recv: true, parent: world });
    // carpet aisle
    mesh(G.box, 0x7d2a33, { p: [0, 0.135, 0.6], s: [2.2, 0.01, 5.6], recv: true, parent: world });
    // back wall + banner
    mesh(G.box, 0x30384f, { p: [0, 2.6, -5.2], s: [13, 5.2, 0.2], recv: true, parent: world });
    const banner = canvasTex(1024, 128);
    banner.g.fillStyle = '#c9a13b'; banner.g.fillRect(0, 0, 1024, 128);
    banner.g.fillStyle = '#1f2433'; banner.g.font = `900 64px ${FONT}`; banner.g.textAlign = 'center'; banner.g.textBaseline = 'middle';
    banner.g.fillText('AI 辩论厅 · POLICY DEBATE', 512, 68);
    banner.t.needsUpdate = true;
    mesh(new THREE.PlaneGeometry(7, 0.875), new THREE.MeshBasicMaterial({ map: banner.t }), { p: [0, 4.6, -5.09], parent: world });
    const Y0 = 0.13;
    const homes = new Map(), facings = new Map(), stands = new Map(), cushions = new Map();
    const obstacles = [];
    // podiums: aff (blue) left, neg (red) right
    const podium = (x, z, color, side) => {
      const g = new THREE.Group(); g.position.set(x, Y0, z); g.rotation.y = side === 'aff' ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35; world.add(g);
      mesh(G.box, 0x5b3a26, { p: [0, 0.5, 0], s: [1.25, 1.0, 0.5], cast: true, recv: true, parent: g });
      mesh(G.box, color, { p: [0, 0.62, 0.26], s: [1.1, 0.38, 0.02], parent: g });
      mesh(G.box, 0x6f4a31, { p: [0, 1.02, -0.05], s: [1.35, 0.06, 0.62], cast: true, parent: g });
      return g;
    };
    const lecternPos = new THREE.Vector2(0, 0.9);
    // lectern (center, facing audience)
    const lec = new THREE.Group(); lec.position.set(lecternPos.x, Y0, lecternPos.y); world.add(lec);
    mesh(G.box, 0x4a2f1f, { p: [0, 0.55, 0], s: [0.8, 1.1, 0.45], cast: true, recv: true, parent: lec });
    mesh(G.box, 0x6f4a31, { p: [0, 1.12, 0.05], s: [0.95, 0.06, 0.6], r: [0.25, 0, 0], cast: true, parent: lec });
    mesh(G.cyl, 0xd4a017, { p: [0, 0.6, 0.235], s: [0.18, 0.02, 0.18], r: [Math.PI / 2, 0, 0], parent: lec });
    obstacles.push({ x: lecternPos.x, z: lecternPos.y, r: 0.55, big: true });
    const sideColor = { aff: 0x3d7fe0, neg: 0xe0483d };
    const debaters = roles.filter((r) => r.side === 'aff' || r.side === 'neg');
    const slotIdx = { aff: 0, neg: 0 };
    for (const r of debaters) {
      const k = slotIdx[r.side]++;
      const sx = r.side === 'aff' ? -1 : 1;
      const px = sx * (4.0 - k * 0.35), pz = -2.2 + k * 1.9;
      podium(px, pz, sideColor[r.side], r.side);
      obstacles.push({ x: px, z: pz, r: 0.68, big: true, owner: r.id });
      // stand behind the podium (outer side)
      const toward = new THREE.Vector2(-sx, 0.35 * (r.side === 'aff' ? 1 : 1)).normalize();
      const home = new THREE.Vector2(px - toward.x * 0.95, pz - toward.y * 0.95);
      homes.set(r.id, home);
      facings.set(r.id, Math.atan2(toward.x, toward.y));
    }
    // audience: two small stands at the front corners
    const audCols = [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x3d405b, 0x9c89b8, 0xf0a6ca, 0x6c9bd2, 0xc9a13b];
    let ai = 0;
    for (const sx of [-1, 1]) for (let row = 0; row < 2; row++) {
      const z = 3.3 + row * 0.9, y = Y0 + row * 0.25;
      mesh(G.box, 0x3b2a20, { p: [sx * 4.8, y + 0.2, z], s: [3.2, 0.4 + row * 0.5, 0.6], cast: true, recv: true, parent: world });
      for (let i = 0; i < 4; i++) {
        const x = sx * (3.6 + i * 0.8), c = audCols[ai++ % audCols.length];
        mesh(G.torso, c, { p: [x, y + 0.62 + row * 0.25, z], s: [0.85, 0.85, 0.85], cast: true, parent: world });
        mesh(G.sphereLo, 0xf1c7a0, { p: [x, y + 1.0 + row * 0.25, z], s: 0.2, cast: true, parent: world });
      }
    }
    // judge bench (raised) at back center
    const bench = new THREE.Group(); bench.position.set(0, Y0, -3.9); world.add(bench);
    mesh(G.box, 0x3b2618, { p: [0, 0.3, 0], s: [3.6, 0.6, 1.6], cast: true, recv: true, parent: bench });
    mesh(G.box, 0x5b3a26, { p: [0, 1.05, 0.7], s: [3.4, 0.9, 0.18], cast: true, parent: bench });
    mesh(G.box, 0xc9a13b, { p: [0, 1.2, 0.8], s: [1.4, 0.3, 0.02], parent: bench });
    obstacles.push({ x: 0, z: -3.2, r: 0.4, big: false }, { x: -1.3, z: -3.2, r: 0.4 }, { x: 1.3, z: -3.2, r: 0.4 });
    const gavel = new THREE.Group(); gavel.position.set(0.6, Y0 + 1.53, -3.35); world.add(gavel);
    mesh(G.cyl, 0x6b3b1d, { p: [0, 0, 0], s: [0.07, 0.22, 0.07], r: [0, 0, Math.PI / 2], cast: true, parent: gavel });
    mesh(G.cyl, 0x8c552b, { p: [0.0, -0.18, 0], s: [0.025, 0.36, 0.025], parent: gavel });
    gavel.userData.base = gavel.rotation.z;
    for (const r of roles) {
      if (r.side === 'judge') { homes.set(r.id, new THREE.Vector2(0, -4.1)); facings.set(r.id, 0); }
      if (r.side === 'chair') { homes.set(r.id, new THREE.Vector2(-5.2, -3.6)); facings.set(r.id, 0.6); }
    }
    // timer board (big, readable) on the back wall, right; scoreboard text on the left
    board = holoBoard(640, 360, [3.7, 3.3, -4.9], [3.2, 1.8, 1]);
    const sideBoard = holoBoard(640, 360, [-3.7, 3.3, -4.9], [3.2, 1.8, 1]);
    // lights
    const spot = new THREE.SpotLight(0xfff0d0, 30, 14, 0.5, 0.6, 1.5);
    spot.position.set(0, 7, 3); spot.target.position.set(0, 0, 0.9); world.add(spot, spot.target);
    controls.target.set(0, 1.55, -1.1);
    controls.minDistance = 6; controls.maxDistance = 26; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.35;
    controls.minAzimuthAngle = -0.75; controls.maxAzimuthAngle = 0.75;
    controls.autoRotate = false;
    return { mode: 'debate', homes, facings, stands, cushions, obstacles, lectern: lecternPos, gavel, sideBoard,
             ground: (id) => (roles.find((r) => r.id === id)?.side === 'judge' ? Y0 + 0.6 : Y0), sitAtHome: false };
  }

  function fitCamera() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 55 : 42;
    camera.updateProjectionMatrix();
  }
  function placeCamera() {
    const aspect = camera.aspect;
    const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const half = layout.mode === 'debate' ? (aspect < 1 ? 5.9 : 6.9) : layout.radius + 0.3;
    const dist = clamp(Math.max(half / (vt * aspect), (layout.mode === 'debate' ? 4.6 : 3.8) / vt), 7, 26);
    const dir = layout.mode === 'debate' ? new THREE.Vector3(0, 0.36, 1).normalize() : new THREE.Vector3(0, 0.55, 1).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
    cam.base = controls.target.clone(); cam.dist = dist;
  }

  // ------------------------------------------------ setup
  function setup({ mode, roles, seed }) {
    const key = mode + '|' + seed + '|' + roles.map((r) => r.id + r.name).join(',');
    if (key === sceneKey) return;
    sceneKey = key;
    clearWorld();
    hemi.intensity = 1.1; sun.intensity = 1.75;
    const bodies = roles.filter((r) => mode !== 'debate' || r.side);
    layout = mode === 'debate' ? buildDebate(bodies) : buildRoundtable(bodies);
    const base = mulberry32(hashStr('palette:' + seed));
    const hue0 = base();
    bodies.forEach((r, i) => {
      const b = new Bot(r.id, scene);
      let hue = (hue0 + i / bodies.length + (base() - 0.5) * 0.03 + 1) % 1;
      if (mode === 'debate') {
        if (r.side === 'aff') hue = 0.6 + (base() - 0.5) * 0.06;
        if (r.side === 'neg') hue = 0.01 + (base() - 0.5) * 0.04;
        if (r.side === 'judge') hue = 0.12;
        if (r.side === 'chair') hue = 0.33;
      }
      const { main } = b.build(mulberry32(hashStr(seed + '#' + r.id)), hue);
      b.color = '#' + main.getHexString();
      b.name = r.name; b.side = r.side;
      if (layout.cushions.get(r.id)) layout.cushions.get(r.id).color.copy(main);
      const home = layout.homes.get(r.id) || new THREE.Vector2();
      b.pos.copy(home); b.goal.copy(home);
      b.facing = layout.facings.get(r.id) || 0;
      b.ground = layout.ground ? layout.ground(r.id) : 0;
      b.sit = layout.sitAtHome ? 1 : 0;
      if (r.side === 'judge') { b.root.scale.setScalar(1.12); addGeminiStar(b); }
      bots.set(r.id, b);
      // overlay
      const anchor = document.createElement('div'); anchor.className = 'anchor';
      const tag = document.createElement('button'); tag.className = 'tag'; tag.textContent = r.name; tag.style.setProperty('--c', b.color);
      const think = document.createElement('div'); think.className = 'think'; think.innerHTML = '<i></i><i></i><i></i>';
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      anchor.append(think, tag);
      overlayRoot.append(anchor, bubble);
      tag.addEventListener('click', (e) => { e.stopPropagation(); opts.onPickBot?.(r.id); });
      bubble.addEventListener('click', (e) => { e.stopPropagation(); opts.onPickMsg?.(bubble._idx, r.id); });
      overlay.set(r.id, { anchor, tag, think, bubble, key: '', w: 0, h: 0, ox: 0, oy: 0, shown: false });
    });
    fitCamera();
    placeCamera();
    light0.hemi = hemi.intensity; light0.sun = sun.intensity;
    celebrate = null;
  }

  // ------------------------------------------------ boards
  function drawRoundBoard(title, sub, good) {
    const k = title + '|' + sub + '|' + good;
    if (!board || board.key === k) return; board.key = k;
    const c = board.g; c.clearRect(0, 0, 512, 256);
    c.beginPath(); c.roundRect(16, 26, 480, 196, 46);
    c.fillStyle = good ? 'rgba(31,157,99,.92)' : 'rgba(43,36,32,.86)'; c.fill();
    c.lineWidth = 8; c.strokeStyle = good ? '#d9ffe9' : '#ffd27a'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.font = `800 64px ${FONT}`; c.fillText(title, 256, 104, 440);
    c.font = `700 36px ${FONT}`; c.fillStyle = good ? '#eafff3' : '#ffd27a'; c.fillText(sub, 256, 176, 440);
    board.t.needsUpdate = true;
  }
  function drawTimerBoard(t) {
    const k = JSON.stringify(t);
    if (!board || board.key === k) return; board.key = k;
    const c = board.g; c.clearRect(0, 0, 640, 360);
    c.beginPath(); c.roundRect(10, 10, 620, 340, 30); c.fillStyle = '#10131c'; c.fill();
    c.lineWidth = 8; c.strokeStyle = t.over ? '#ff5a4f' : '#c9a13b'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#c9a13b'; c.font = `800 40px ${FONT}`; c.fillText(t.label || '计时牌', 320, 62, 580);
    c.fillStyle = t.over ? '#ff5a4f' : t.remain != null && t.remain < 20 ? '#ffb347' : '#7dffb0';
    c.font = `900 130px "SF Mono", Menlo, Consolas, monospace`;
    c.fillText(t.clock || '--:--', 320, 182);
    c.fillStyle = '#e8e2d0'; c.font = `700 34px ${FONT}`; c.fillText(t.sub || '', 320, 300, 590);
    board.t.needsUpdate = true;
  }
  function drawSideBoard(f) {
    const sb = layout.sideBoard; if (!sb) return;
    const k = JSON.stringify([f.phaseIdx, f.phases?.length, f.verdict?.winner]);
    if (sb.key === k) return; sb.key = k;
    const c = sb.g; c.clearRect(0, 0, 640, 360);
    c.beginPath(); c.roundRect(10, 10, 620, 340, 30); c.fillStyle = '#10131c'; c.fill();
    c.lineWidth = 6; c.strokeStyle = '#3d4566'; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'left';
    const ph = f.phases || [];
    c.font = `800 30px ${FONT}`; c.fillStyle = '#c9a13b'; c.fillText('赛程 · Policy（简化）', 36, 46);
    ph.forEach((p, i) => {
      const y = 92 + i * 31;
      const done = i < f.phaseIdx, cur = i === f.phaseIdx;
      c.fillStyle = cur ? '#7dffb0' : done ? '#8a90a8' : '#e8e2d0';
      c.font = `${cur ? 800 : 600} 25px ${FONT}`;
      c.fillText(`${done ? '✓' : cur ? '▶' : '·'} ${p.label}`, 40, y, 560);
    });
    if (f.verdict) {
      c.fillStyle = f.verdict.winner === 'aff' ? '#6fa8ff' : '#ff7a70'; c.font = `900 30px ${FONT}`;
      c.fillText(`裁判：${f.verdict.winner === 'aff' ? '正方' : '反方'}胜`, 400, 46);
    }
    sb.t.needsUpdate = true;
  }

  // ------------------------------------------------ steering with obstacle avoidance
  const tmp2 = new THREE.Vector2();
  function segHitsDisc(ax, az, bx, bz, o, pad) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) return false;
    const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / L2, 0, 1);
    const cx = ax + dx * t - o.x, cz = az + dz * t - o.z;
    return cx * cx + cz * cz < (o.r + pad) ** 2;
  }
  function waypoint(b, goal) {
    // first obstacle on the straight line → circle around it in the shorter direction
    let best = null, bestD = Infinity;
    for (const o of layout.obstacles) {
      const dGoal = Math.hypot(goal.x - o.x, goal.y - o.z);
      if (dGoal < o.r + 0.25) continue; // goal is right next to it (e.g. lectern) → approach directly
      if (!segHitsDisc(b.pos.x, b.pos.y, goal.x, goal.y, o, 0.32)) continue;
      const d = Math.hypot(b.pos.x - o.x, b.pos.y - o.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return goal;
    const a0 = Math.atan2(b.pos.x - best.x, b.pos.y - best.z);
    const a1 = Math.atan2(goal.x - best.x, goal.y - best.z);
    if (Math.abs(wrapAngle(a1 - a0)) < 0.3) return goal;   // already on the goal's side → go straight
    const step = clamp(wrapAngle(a1 - a0), -0.65, 0.65);
    const r = Math.max(best.r + 0.5, Math.min(bestD, best.r + 0.9));
    return tmp2.set(best.x + Math.sin(a0 + step) * r, best.z + Math.cos(a0 + step) * r);
  }
  function steer(b, dt, speedMax) {
    const d = b.pos.distanceTo(b.goal);
    if (b.sit > 0.15 || d < 0.04) { b.vel.multiplyScalar(Math.exp(-10 * dt)); b.pos.addScaledVector(b.vel, dt); return d; }
    const target = waypoint(b, b.goal);
    const dx = target.x - b.pos.x, dz = target.y - b.pos.y, dl = Math.hypot(dx, dz) || 1;
    const sp = Math.min(speedMax, Math.max(0.35, d * 2.2));
    let vx = (dx / dl) * sp, vz = (dz / dl) * sp;
    // soft repulsion from obstacles & other bots
    for (const o of layout.obstacles) {
      if (o.owner === b.id) continue;
      const ox = b.pos.x - o.x, oz = b.pos.y - o.z, od = Math.hypot(ox, oz), R = o.r + 0.3;
      if (od < R && od > 1e-4) { const k = (R - od) / R * 3; vx += (ox / od) * k; vz += (oz / od) * k; }
    }
    for (const o of bots.values()) {
      if (o === b) continue;
      const ox = b.pos.x - o.pos.x, oz = b.pos.y - o.pos.y, od = Math.hypot(ox, oz);
      if (od < 0.6 && od > 1e-4) { const k = (0.6 - od) * 2.5; vx += (ox / od) * k; vz += (oz / od) * k; }
    }
    b.vel.x = damp(b.vel.x, vx, 8, dt); b.vel.y = damp(b.vel.y, vz, 8, dt);
    b.pos.addScaledVector(b.vel, dt);
    // hard constraint: never inside furniture
    for (const o of layout.obstacles) {
      if (o.owner === b.id) continue;
      const ox = b.pos.x - o.x, oz = b.pos.y - o.z, od = Math.hypot(ox, oz), R = o.r + 0.18;
      if (od < R && od > 1e-4) { b.pos.x = o.x + (ox / od) * R; b.pos.y = o.z + (oz / od) * R; }
    }
    return d;
  }

  // ------------------------------------------------ per-frame bot logic
  function roleOf(b) {
    const f = frame;
    if (f.verdict && celebrate) {
      if (b.side === f.verdict.winner) return 'cheer';
      if (b.side === 'aff' || b.side === 'neg') return 'sad';
      if (b.side === 'judge') return 'gavel';
    }
    if (f.cxPair && f.cxPair.includes(b.id)) return f.speakerId === b.id ? (f.cxPair[1] === b.id ? 'answer' : 'ask') : 'cx-wait';
    if (f.speakerId === b.id) return f.speakKind || 'speak';
    if (f.thinkingId === b.id || (f.typingIds && f.typingIds.includes(b.id))) return 'think';
    if (f.votes && f.votes.has(b.id)) return 'voted';
    if (f.addressId === b.id) return 'listen';
    if (f.consensus) return 'cheer-lite';
    if (f.speakerId && b.side !== 'judge') return 'listen';   // everyone else nods along
    return 'idle';
  }

  function goalFor(b, role, now) {
    const home = layout.homes.get(b.id) || b.pos;
    const f = frame;
    if (layout.mode === 'debate') {
      if (b.side === 'judge' || b.side === 'chair') return { goal: home, sit: false };
      if (f.cxPair && f.cxPair.includes(b.id)) {   // 质询：两人在讲台后方面对面
        const x = b.side === 'aff' ? -0.85 : 0.85;
        const other = bots.get(f.cxPair[0] === b.id ? f.cxPair[1] : f.cxPair[0]);
        return { goal: new THREE.Vector2(x, -0.55), sit: false, faceTo: other };
      }
      if ((role === 'speak' || role === 'answer') && f.atLectern) return { goal: tmp2.set(layout.lectern.x, layout.lectern.y - 0.55).clone(), sit: false, faceFront: true };
      return { goal: home, sit: false };
    }
    // roundtable
    if (role === 'speak' || role === 'answer') {
      const t = f.addressId && bots.get(f.addressId);
      if (t && t !== b) {
        // walk around the table to stand next to the addressed bot
        const stT = layout.stands.get(t.id);
        const a = Math.atan2(stT.x, stT.y);
        const aMe = Math.atan2(b.pos.x, b.pos.y);
        const side = Math.sign(wrapAngle(aMe - a)) || 1;
        return { goal: layout.ringPoint(a + side * 0.42, layout.tableR + 0.62), sit: false };
      }
      return { goal: layout.stands.get(b.id), sit: false };
    }
    if (role === 'think' || role === 'voted') return { goal: home, sit: role === 'voted' ? false : true };
    if (role === 'idle') {
      b.idleT -= 1 / 60;
      if (b.idleGoal && b.idleT < 0) { b.idleGoal = null; b.idleT = 8 + Math.random() * 14; }
      else if (!b.idleGoal && b.idleT < 0 && !f.busy) {
        const a = Math.atan2(home.x, home.y) + (Math.random() - 0.5) * 0.8;
        b.idleGoal = layout.ringPoint(a, layout.radius + 0.4 + Math.random() * 0.8);
        b.idleT = 4 + Math.random() * 4;
      }
      if (b.idleGoal) return { goal: b.idleGoal, sit: false };
    }
    return { goal: home, sit: true };
  }

  function updateBot(b, dt, now) {
    const f = frame;
    const role = roleOf(b);
    if (role !== 'idle') b.idleGoal = null;
    const { goal, sit, faceFront, faceTo } = goalFor(b, role, now);
    b.goal.copy(goal);
    const home = layout.homes.get(b.id);
    const atHome = home && b.pos.distanceTo(home) < 0.08;
    const wantSit = layout.sitAtHome && sit && atHome;
    b.sit = damp(b.sit, wantSit ? 1 : 0, 6, dt);
    const speedMax = ['speak', 'answer', 'ask', 'cx-wait', 'rebut'].includes(role) ? 1.6 : 1.15;
    const d = steer(b, dt, speedMax);
    // facing
    const speed = b.vel.length();
    const focus = f.speakerId ? bots.get(f.speakerId) : f.thinkingId ? bots.get(f.thinkingId) : null;
    let tf = b.facing;
    const homeFace = layout.facings.get(b.id) || 0;
    if (speed > 0.2) tf = Math.atan2(b.vel.x, b.vel.y);
    else if (b.sit > 0.3) tf = homeFace;
    else if (faceTo && faceTo !== b) tf = Math.atan2(faceTo.pos.x - b.pos.x, faceTo.pos.y - b.pos.y);
    else if (faceFront) tf = 0;
    else if ((role === 'speak' || role === 'answer') && f.addressId && bots.get(f.addressId)) { const t = bots.get(f.addressId); tf = Math.atan2(t.pos.x - b.pos.x, t.pos.y - b.pos.y); }
    else if (role === 'gavel' || role === 'cheer' || role === 'sad') tf = layout.mode === 'debate' ? (b.side === 'judge' ? 0 : homeFace) : homeFace;
    else if (focus && focus !== b) tf = Math.atan2(focus.pos.x - b.pos.x, focus.pos.y - b.pos.y);
    else tf = homeFace;
    b.facing = dampAngle(b.facing, tf, speed > 0.2 ? 10 : 3.5, dt);

    const arrived = d < 0.25;
    b.gBlend = damp(b.gBlend, role !== 'idle' && arrived ? 1 : 0, 5, dt);
    b.walkAmt = damp(b.walkAmt, clamp(speed / 0.8, 0, 1), 10, dt);
    b.phase += dt * (4 + speed * 7);
    const sw = Math.sin(b.phase) * b.walkAmt;
    const c = b.cur, T = {};
    T.legL = sw * 0.75; T.legR = -sw * 0.75;
    T.aLx = -sw * 0.6; T.aRx = sw * 0.6; T.aLz = -0.18; T.aRz = 0.18;
    T.headTilt = Math.sin(now * 0.9 + b.id) * 0.06; T.headNod = 0; T.mouth = 1; T.brow = 0;
    const g = b.gBlend;
    const mix = (k, v) => { T[k] = lerp(T[k], v, g); };
    let bounce = 0;
    if (role === 'speak' || role === 'answer') {
      mix('aLz', -(1.2 + Math.sin(now * 5.2) * 0.6)); mix('aRz', 1.0 + Math.sin(now * 4.1 + 1.7) * 0.8);
      mix('aLx', -0.5 + Math.sin(now * 3) * 0.3); mix('aRx', -0.6 + Math.cos(now * 3.3) * 0.3);
      T.mouth = lerp(1, 0.5 + Math.abs(Math.sin(now * 13)) * 1.3, g);
      bounce = Math.abs(Math.sin(now * 5.2)) * 0.04 * g;
    } else if (role === 'ask') {
      mix('aRx', -1.4 + Math.sin(now * 6) * 0.12); mix('aRz', 0.15); mix('aLz', -0.4);
      T.mouth = lerp(1, 0.6 + Math.abs(Math.sin(now * 13)) * 1.2, g); T.brow = g * 0.6;
    } else if (role === 'retract') {
      mix('aLz', -1.9 - Math.sin(now * 3) * 0.15); mix('aRz', 1.9 + Math.sin(now * 3) * 0.15); mix('aLx', -0.7); mix('aRx', -0.7);
      mix('headTilt', 0.25); T.mouth = lerp(1, 0.6 + Math.abs(Math.sin(now * 10)) * 0.8, g);
    } else if (role === 'cx-wait') {
      mix('aLz', -0.35); mix('aRz', 0.35); mix('headNod', Math.sin(now * 2.5) * 0.05);
    } else if (role === 'rebut') {
      mix('aRx', -1.55 + Math.sin(now * 14) * 0.18); mix('aRz', 0.05); mix('aLz', -0.9); mix('aLx', 0.5);
      T.mouth = lerp(1, 0.6 + Math.abs(Math.sin(now * 15)) * 1.4, g); T.brow = g;
    } else if (role === 'think') {
      mix('aRx', -2.1); mix('aRz', 0.6); mix('headTilt', 0.22 + Math.sin(now * 1.3) * 0.05); mix('headNod', -0.12);
    } else if (role === 'voted') {
      mix('aRz', 2.75 + Math.sin(now * 3 + b.id) * 0.1); mix('aRx', -0.15); mix('aLz', -0.35);
      const v = f.votes.get(b.id);
      if (v === 'disagree') { mix('headTilt', Math.sin(now * 7) * 0.12); T.brow = g; } else mix('headNod', Math.sin(now * 4 + b.id) * 0.1);
    } else if (role === 'listen') {
      mix('headNod', 0.05 + Math.sin(now * 3.2 + b.id) * 0.1); mix('aLz', -0.3); mix('aRz', 0.3);
    } else if (role === 'cheer' || role === 'cheer-lite') {
      const k = role === 'cheer' ? 1 : 0.5;
      mix('aLz', -2.6 + Math.sin(now * 9 + b.id) * 0.25); mix('aRz', 2.6 - Math.sin(now * 9 + b.id) * 0.25);
      T.mouth = lerp(1, 1.6, g); bounce = Math.abs(Math.sin(now * 4.5 + b.id)) * 0.3 * g * k;
    } else if (role === 'sad') {
      mix('headNod', 0.35); mix('aLz', -0.05); mix('aRz', 0.05); T.mouth = lerp(1, 0.4, g);
    } else if (role === 'gavel') {
      mix('aRz', 1.4 + Math.max(0, Math.sin(now * 6)) * 0.9); mix('aRx', -0.8);
    }
    if (b.sit > 0.01) {
      T.legL = lerp(T.legL, -1.45 + Math.sin(now * 3 + b.id) * 0.15, b.sit);
      T.legR = lerp(T.legR, -1.45 - Math.sin(now * 3 + b.id) * 0.15, b.sit);
      T.aLx = lerp(T.aLx, -0.5, b.sit); T.aRx = lerp(T.aRx, -0.5, b.sit);
    }
    for (const k in T) c[k] = damp(c[k], T[k], 12, dt);
    b.blinkIn -= dt;
    if (b.blinkIn <= 0) { b.blinkT = 0.13; b.blinkIn = Math.random() < 0.2 ? 0.25 : 1.8 + Math.random() * 3.5; }
    b.blinkT -= dt;
    for (const e of b.eyes) e.scale.y = b.blinkT > 0 ? 0.12 : 1;
    const sitY = b.sit * 0.11;
    const bob = Math.abs(Math.sin(b.phase)) * 0.06 * b.walkAmt + bounce + Math.sin(now * 2.2 + b.id) * 0.008;
    b.root.position.set(b.pos.x, b.ground + sitY + bob, b.pos.y);
    b.root.rotation.y = b.facing;
    b.body.rotation.z = Math.sin(b.phase) * 0.09 * b.walkAmt;
    b.legs[0].rotation.x = c.legL; b.legs[1].rotation.x = c.legR;
    b.arms[0].rotation.set(c.aLx, 0, c.aLz); b.arms[1].rotation.set(c.aRx, 0, c.aRz);
    // head: always turn toward whoever is being looked at — including bots that already voted
    let look = null;
    if (['speak', 'answer', 'ask', 'rebut', 'retract'].includes(role)) look = f.addressId ? bots.get(f.addressId) : null;
    if (faceTo) look = faceTo;
    else if (['listen', 'voted', 'think', 'idle', 'cheer-lite', 'cx-wait'].includes(role)) look = focus;
    if (f.addressId === b.id && focus) look = focus;   // 被点名 → 看向点名者
    let yaw = 0;
    if (look && look !== b) yaw = clamp(wrapAngle(Math.atan2(look.pos.x - b.pos.x, look.pos.y - b.pos.y) - b.facing), -1.2, 1.2);
    else if (role === 'idle') yaw = Math.sin(now * 0.4 + b.id * 1.7) * 0.5;
    c.headYaw = damp(c.headYaw, yaw, 5, dt);
    b.headPivot.rotation.set(c.headNod, c.headYaw, c.headTilt);
    b.mouth.scale.set(1, c.mouth, 1);
    b.brows[0].rotation.z = -(b.browBase + c.brow * 0.5); b.brows[1].rotation.z = b.browBase + c.brow * 0.5;
    if (b.propeller) b.propeller.rotation.y += dt * (6 + speed * 20);
    if (b.sparkle) { b.sparkle.rotation.y += dt * (role === 'think' ? 3.5 : 0.8); b.sparkle.position.y = 0.62 + Math.sin(now * 2) * 0.03; }
    // paddle billboard
    const pv = role === 'voted' ? f.votes.get(b.id) : null;
    if (pv && b.gBlend > 0.3) {
      if (!b.paddle) {
        b.paddle = new THREE.Sprite(new THREE.SpriteMaterial({ map: PADDLE_TEX.agree, transparent: true, depthTest: false, depthWrite: false }));
        b.paddle.renderOrder = 10; scene.add(b.paddle);
      }
      b.paddle.material.map = PADDLE_TEX[pv] || PADDLE_TEX.agree;
      b.paddle.visible = true;
      // held up above the head, shifted toward the raised (right) hand in camera space → always readable
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      b.paddle.position.set(b.pos.x, b.ground + b.sit * 0.11 + 2.0 + Math.sin(now * 3 + b.id) * 0.04, b.pos.y).addScaledVector(right, 0.28);
      const k = clamp((b.gBlend - 0.3) / 0.5, 0.05, 1);
      b.paddle.scale.set((IS_MOBILE ? 0.72 : 0.58) * k, (IS_MOBILE ? 0.9 : 0.72) * k, 1);
    } else if (b.paddle) b.paddle.visible = false;
    b.headTopY = b.ground + sitY + 1.5 * b.root.scale.y;
  }

  // ------------------------------------------------ overlay (tags, think dots, bubbles with collision avoidance)
  const proj = new THREE.Vector3();
  const placed = [];
  function layoutOverlay(dt) {
    const W = container.clientWidth, H = container.clientHeight;
    const f = frame;
    const pts = [];
    for (const [id, b] of bots) {
      const o = overlay.get(id);
      proj.set(b.pos.x, b.headTopY + 0.1, b.pos.y).project(camera);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
      const x = (proj.x * 0.5 + 0.5) * W, y = (-proj.y * 0.5 + 0.5) * H;
      o.anchor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      o.anchor.style.display = vis ? '' : 'none';
      o.anchor.style.zIndex = String(1000 - Math.round(proj.z * 500));
      o.think.classList.toggle('on', f.thinkingId === id);
      o.tag.classList.toggle('active', f.speakerId === id || f.thinkingId === id);
      pts.push({ id, x, y, z: proj.z, vis, o });
    }
    // bubbles: current speaker first, then most recent
    const bubbles = (f.bubbles || []).filter((bb) => bots.has(bb.id));
    const want = new Map(bubbles.map((bb, i) => [bb.id, { ...bb, prio: i }]));
    placed.length = 0;
    // reserved screen areas (HUD cards, replay bar) — bubbles must not cover them
    if (!layoutOverlay.res || ++layoutOverlay.n % 15 === 0) layoutOverlay.res = opts.reserved?.() || [];
    layoutOverlay.n = layoutOverlay.n || 0;
    for (const r of layoutOverlay.res) placed.push(r);
    for (const p of pts) {   // name tags are obstacles too
      if (!p.vis) continue;
      const o = p.o;
      if (!o.tagW) o.tagW = o.tag.offsetWidth || 70;
      placed.push({ x: p.x - o.tagW / 2, y: p.y + 6, w: o.tagW, h: 20 });
    }
    const order = pts.filter((p) => want.has(p.id) && p.vis).sort((a, b) => want.get(a.id).prio - want.get(b.id).prio);
    for (const p of pts) {
      if (!want.has(p.id) || !p.vis) { if (p.o.shown) { p.o.bubble.classList.remove('show'); p.o.shown = false; } }
    }
    const margin = 6;
    for (const p of order) {
      const bb = want.get(p.id), o = p.o;
      if (o.key !== bb.key) {
        o.key = bb.key;
        o.bubble.className = 'bubble t-' + (bb.type || 'status') + (bb.main ? ' main' : '');
        o.bubble.innerHTML = bb.html;
        o.bubble._idx = bb.idx;
        o.w = o.bubble.offsetWidth; o.h = o.bubble.offsetHeight;
        o.bubble.style.setProperty('--c', bots.get(p.id).color);
      }
      if (!o.shown) { o.bubble.classList.add('show'); o.shown = true; }
      const w = o.w || 160, h = o.h || 48;
      // candidate positions: above head, then stacked higher, then left/right
      const baseX = p.x - w / 2, baseY = p.y - 34 - h;
      const cands = [[0, 0], [0, -h - 8], [w * 0.55, -10], [-w * 0.55, -10], [w * 0.6, -h - 12], [-w * 0.6, -h - 12], [0, -2 * h - 16], [w * 1.05, 0], [-w * 1.05, 0]];
      let best = null;
      for (const [dx, dy] of cands) {
        let rx = clamp(baseX + dx, 4, W - w - 4), ry = clamp(baseY + dy, 4, H - h - 4);
        const hit = placed.some((r) => rx < r.x + r.w + margin && rx + w + margin > r.x && ry < r.y + r.h + margin && ry + h + margin > r.y);
        if (!hit) { best = [rx, ry]; break; }
      }
      if (!best) { // nothing free: hide lower-priority bubble (keeps the screen readable)
        if (!bb.main) { o.bubble.classList.remove('show'); o.shown = false; continue; }
        best = [clamp(baseX, 4, W - w - 4), clamp(baseY, 4, H - h - 4)];
      }
      placed.push({ x: best[0], y: best[1], w, h });
      o.ox = o.init ? damp(o.ox, best[0], 14, dt) : best[0];
      o.oy = o.init ? damp(o.oy, best[1], 14, dt) : best[1];
      o.init = true;
      // tail points toward the speaker's head
      const tail = clamp(p.x - o.ox, 12, w - 12);
      o.bubble.style.setProperty('--tail', tail.toFixed(0) + 'px');
      o.bubble.style.transform = `translate3d(${o.ox.toFixed(1)}px, ${o.oy.toFixed(1)}px, 0)`;
      o.bubble.style.zIndex = bb.main ? '3000' : String(2000 - bb.prio);
    }
  }

  // ------------------------------------------------ picking
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; controls.autoRotate = false; cam.userUntil = performance.now() / 1000 + 25; });
  renderer.domElement.addEventListener('wheel', () => { cam.userUntil = performance.now() / 1000 + 25; }, { passive: true });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([...bots.values()].map((b) => b.root), true);
    for (const h of hits) { let o = h.object; while (o && o.userData.botId == null) o = o.parent; if (o) { opts.onPickBot?.(o.userData.botId); break; } }
  });

  // ------------------------------------------------ loop (throttled on mobile, paused when hidden)
  let last = performance.now(), running = true, raf = 0, acc = 0, frames = 0, slowFor = 0;
  const minFrame = IS_MOBILE ? 1000 / 32 : 0;
  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!running || document.hidden || !layout) return;
    if (t - last < minFrame) return;
    const realDt = Math.min(0.3, (t - last) / 1000); last = t;
    const now = t / 1000;
    // fixed sub-steps keep walking speed real-time even on slow devices
    const steps = Math.max(1, Math.ceil(realDt / 0.04));
    const dt = realDt / steps;
    for (let k = 0; k < steps; k++) for (const b of bots.values()) updateBot(b, dt, now - (steps - 1 - k) * dt);
    const f = frame;
    if (layout.mode === 'debate') {
      drawTimerBoard(f.timer || {});
      drawSideBoard(f);
      if (layout.gavel) layout.gavel.rotation.z = celebrate && now - celebrate.t0 < 2.5 ? -Math.abs(Math.sin((now - celebrate.t0) * 9)) * 0.9 : 0;
    } else drawRoundBoard(f.boardTitle || '圆桌', f.boardSub || '', !!f.consensus);
    // who is speaking? → spotlight + dim the rest + gentle camera push-in
    const sb = frame.spotlight ? bots.get(frame.spotlight) : null;
    const k = realDt;
    if (sb) {
      focusSpot.position.set(sb.pos.x + 0.6, sb.ground + 6.5, sb.pos.y + 2.2);
      focusSpot.target.position.set(sb.pos.x, sb.ground + 0.8, sb.pos.y);
    }
    focusSpot.intensity = damp(focusSpot.intensity, sb ? (layout.mode === 'debate' ? 60 : 38) : 0, 4, k);
    hemi.intensity = damp(hemi.intensity, light0.hemi * (sb ? 0.5 : 1), 3, k);
    sun.intensity = damp(sun.intensity, light0.sun * (sb ? 0.55 : 1), 3, k);
    for (const [id, o] of overlay) o.tag.classList.toggle('dim', !!sb && id !== frame.spotlight && !(frame.cxPair || []).includes(id));
    if (cam.base && now > cam.userUntil && opts.autoCamera !== false) {
      const want = sb ? cam.base.clone().lerp(new THREE.Vector3(sb.pos.x, sb.ground + 1.1, sb.pos.y), 0.45) : cam.base;
      const wantDist = cam.dist * (sb ? 0.78 : 1);
      const off = camera.position.clone().sub(controls.target);
      const len = damp(off.length(), wantDist, 1.6, k);
      controls.target.set(damp(controls.target.x, want.x, 1.6, k), damp(controls.target.y, want.y, 1.6, k), damp(controls.target.z, want.z, 1.6, k));
      camera.position.copy(controls.target).addScaledVector(off.normalize(), len);
      if (sb) controls.autoRotate = false;
    }
    controls.update();
    renderer.render(scene, camera);
    layoutOverlay(realDt);
    // adaptive resolution if frames are slow
    acc += realDt; frames++;
    if (acc > 2) {
      const fps = frames / acc; acc = 0; frames = 0;
      if (fps < 24 && pixelRatio > 0.75) { slowFor++; if (slowFor >= 2) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); fitCamera(); slowFor = 0; } }
      else slowFor = 0;
    }
  }
  raf = requestAnimationFrame(tick);
  window.__stage = { get bots() { return bots; }, get layout() { return layout; }, get frame() { return frame; } };
  const ro = new ResizeObserver(() => { fitCamera(); });
  ro.observe(container);

  return {
    setup,
    update(f) {
      frame = f;
      if (f.verdict && f.showVerdict && !celebrate) celebrate = { winner: f.verdict.winner, t0: performance.now() / 1000 };
      if (!f.showVerdict) celebrate = null;
    },
    resetCamera() { if (layout) placeCamera(); },
    setRunning(v) { running = v; },
    botColor(id) { return bots.get(id)?.color || '#8a7d70'; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.removeChild(renderer.domElement); },
  };
}
