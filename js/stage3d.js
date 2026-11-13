// AI 圆桌 & 辩论厅 — 3D stage (three.js r170, vendored).
// Two layouts: 'roundtable' (round table + chairs) and 'debate' (aff/neg podiums, lectern, judge bench, timer board).
// The stage is driven by update(frame); it never fetches data itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { solveCameraFit, rayIntersectsBox } from './camera_fit.js';

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
// "Sculpted figurine" look: PBR MeshStandardMaterial (cached by color + params), smooth geometry, ACES tone mapping.
export const IS_COARSE = matchMedia('(pointer: coarse)').matches;
const MAT = {
  cloth: { roughness: 0.9, metalness: 0 },
  skin: { roughness: 0.78, metalness: 0 },
  hair: { roughness: 0.85, metalness: 0 },
  wood: { roughness: 0.68, metalness: 0 },
  brass: { roughness: 0.42, metalness: 0.55 },
  stone: { roughness: 0.86, metalness: 0 },
  gloss: { roughness: 0.45, metalness: 0 },
};
const matCache = new Map();
function std(color, extra) {
  const key = new THREE.Color(color).getHexString() + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, ...MAT.cloth, ...(extra || {}) }); matCache.set(key, m); }
  return m;
}
const toon = std;   // legacy name kept for the random-bot builder
const SEG = 1;      // same tessellation on phones and desktops (budget checked with __stage.audit())
const s = (n, min = 5) => Math.max(min, Math.round(n * SEG));
const G = {
  head: new THREE.SphereGeometry(1, 40, 30),
  sphere: new THREE.SphereGeometry(1, s(24, 12), s(16, 8)),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  sphereMid: new THREE.SphereGeometry(1, s(18, 10), s(12, 7)),
  hemi: new THREE.SphereGeometry(1, s(24, 12), s(10, 6), 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, s(20, 10)),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, s(20, 10), 1, true),
  taperCyl: new THREE.CylinderGeometry(0.84, 1, 1, s(20, 10)),
  limbCyl: new THREE.CylinderGeometry(0.86, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, s(14, 6)),
  torus: new THREE.TorusGeometry(1, 0.13, 8, s(24, 12)),
  torusThin: new THREE.TorusGeometry(1, 0.085, 6, s(24, 12)),
  torusSq: new THREE.TorusGeometry(1, 0.13, 5, 4),
  torusSqThin: new THREE.TorusGeometry(1, 0.075, 5, 4),
  arc: new THREE.TorusGeometry(1, 0.22, 6, 12, Math.PI),
  box: new THREE.BoxGeometry(1, 1, 1),
  rbox: roundedBox(1, 1, 1, 0.06, 3),
  disc: new THREE.CircleGeometry(1, s(24, 12)),
  leg: new THREE.CapsuleGeometry(0.075, 0.14, 4, 12),
  arm: new THREE.CapsuleGeometry(0.06, 0.15, 4, 12),
  torso: new THREE.CapsuleGeometry(0.21, 0.16, 6, s(16, 8)),
};
// Unit box with softly bevelled edges (furniture reads as carved/cast rather than flat blocks).
function roundedBox(w, h, d, r, seg) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1);
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const v = new THREE.Vector3(), inner = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(inner);
    if (v.lengthSq() < 1e-12) v.set(0, 1, 0);
    v.setLength(r);
    nrm.setXYZ(i, v.x / r, v.y / r, v.z / r);
    v.add(inner);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
const G_SET = new Set(Object.values(G));
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
// Merge static meshes that share a material into one draw call.
// deep=false: only direct children (their local matrices); deep=true: every descendant mesh whose ancestor chain up to
// `group` has no userData.dynamic flag (bakes the matrix relative to `group`) — used for static furniture.
function mergeStaticGroup(group, skipSet, deep = false) {
  const byMat = new Map();
  const rel = new Map();
  if (deep) group.updateMatrixWorld(true);
  const inv = deep ? group.matrixWorld.clone().invert() : null;
  const consider = (child) => {
    if (!child.isMesh || child.isInstancedMesh || skipSet?.has(child) || child.userData.keep) return;
    const m = child.material;
    if (!m || Array.isArray(m) || m.transparent || m.map || child.renderOrder) return;
    let list = byMat.get(m);
    if (!list) { list = []; byMat.set(m, list); }
    list.push(child);
  };
  if (deep) {
    const walk = (o) => { for (const c of o.children) { if (c.userData.dynamic) continue; consider(c); if (c.children.length) walk(c); } };
    walk(group);
  } else for (const child of [...group.children]) consider(child);
  const normMat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const [mat, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const parts = [];
    let totalVerts = 0;
    let cast = false, recv = false;
    for (const m of meshes) {
      let mx;
      if (deep) { mx = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld); }
      else { m.updateMatrix(); mx = m.matrix; }
      rel.set(m, mx);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      const pos = g.getAttribute('position');
      const norm = g.getAttribute('normal');
      if (!pos || !norm) { g.dispose(); continue; }
      normMat.getNormalMatrix(mx);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mx);
        pos.setXYZ(i, v.x, v.y, v.z);
        v.fromBufferAttribute(norm, i).applyMatrix3(normMat).normalize();
        norm.setXYZ(i, v.x, v.y, v.z);
      }
      totalVerts += pos.count;
      parts.push(g);
      if (m.castShadow) cast = true;
      if (m.receiveShadow) recv = true;
    }
    if (parts.length < 2) { parts.forEach((g) => g.dispose()); continue; }
    const posArr = new Float32Array(totalVerts * 3);
    const normArr = new Float32Array(totalVerts * 3);
    let off = 0;
    for (const g of parts) {
      const p = g.getAttribute('position').array;
      const n = g.getAttribute('normal').array;
      posArr.set(p, off);
      normArr.set(n, off);
      off += p.length;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    merged.computeBoundingSphere();
    const combined = new THREE.Mesh(merged, mat);
    combined.castShadow = cast;
    combined.receiveShadow = recv;
    for (const m of meshes) m.parent?.remove(m);
    group.add(combined);
  }
}
function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

// ---------------------------------------------------------------- photo avatar loader & texture cache (<= 256px)
const photoImgCache = new Map();
const badgeTexCache = new Map();
const badgeMatCache = new Map();
const faceTexCache = new Map();
const pendingTexPromises = new Set();
const texStats = { requested: 0, loaded: 0, failed: 0 };
function trackTexPromise(p) {
  pendingTexPromises.add(p);
  p.finally(() => pendingTexPromises.delete(p));
  return p;
}
export function waitForTextures() {
  return Promise.all([...pendingTexPromises]);
}
if (typeof window !== 'undefined') {
  window.__stageTexturesReady = waitForTextures;
  window.__stageTexStats = () => ({ ...texStats, pending: pendingTexPromises.size });
}

function resolvePhotoPath(personaId, role) {
  const av = role?.avatar;
  if (av && /\.(jpe?g|png|webp)(\?|$)/i.test(av)) return av;
  if (personaId) return `assets/avatars/photo/${personaId}.jpg`;
  return null;
}
function photoFetchUrl(path) {
  if (/^(https?:|data:|blob:|\/)/i.test(path)) return path;
  return new URL('../' + path.replace(/^\.\//, ''), import.meta.url).href;
}
function mimeFromPath(path) {
  const ext = String(path).split('?')[0].split('.').pop().toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[ext] || 'image/jpeg';
}
function loadPhotoImage(path) {
  if (!path) return Promise.resolve(null);
  if (photoImgCache.has(path)) return photoImgCache.get(path);
  const p = trackTexPromise((async () => {
    try {
      const pre = typeof window !== 'undefined' ? window.__personas?.data?.get(path) : null;
      if (pre) {
        const img = new Image();
        img.src = pre;
        await img.decode();
        return img;
      }
      const url = photoFetchUrl(path);
      const res = await fetch(url);
      if (!res.ok) return null;
      const rawBlob = await res.blob();
      const blob = rawBlob.type && rawBlob.type.startsWith('image/') ? rawBlob : new Blob([rawBlob], { type: mimeFromPath(path) });
      if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(blob); } catch {}
      }
      const dataUrl = await new Promise((ok, err) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = err;
        fr.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      return img;
    } catch {
      return null;
    }
  })());
  photoImgCache.set(path, p);
  return p;
}
function getBadgeMaterial(path) {
  if (!path) return null;
  if (badgeMatCache.has(path)) return badgeMatCache.get(path);
  let t = badgeTexCache.get(path);
  const mat = new THREE.MeshBasicMaterial({ map: null });
  if (!t) {
    const ct = canvasTex(128, 128);
    t = ct.t;
    const { g } = ct;
    g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, 128, 128);
    t.needsUpdate = true;
    badgeTexCache.set(path, t);
    texStats.requested += 1;
    trackTexPromise(loadPhotoImage(path).then((img) => {
      if (!img) { texStats.failed += 1; return; }
      g.clearRect(0, 0, 128, 128);
      g.save();
      g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.clip();
      const iw = img.width || 512, ih = img.height || 512;
      const sq = Math.min(iw, ih);
      g.drawImage(img, (iw - sq) / 2, (ih - sq) * 0.16, sq, sq, 0, 0, 128, 128);
      g.restore();
      t.needsUpdate = true;
      mat.needsUpdate = true;
      texStats.loaded += 1;
    }));
  }
  mat.map = t;
  badgeMatCache.set(path, mat);
  return mat;
}
// Face decal: high-res (512px) crop around look.face_crop = [cx, cy, rx, ry] (normalised face ellipse in the photo).
// The canvas spans ±FACE_K ellipse radii; pixels are feathered (elliptical alpha) and tinted toward the photo's own
// cheek colour near the rim so the photo melts into the sculpted head. Returns the sampled skin colour so the
// figure's 3D skin can be matched to the photo.
const FACE_K = 1.3;
const FACE_TEX = 512;
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function getFaceDecalTexture(path, crop, skinHex, onReady) {
  if (!path || !crop) return null;
  const key = `${path}|${crop.join(',')}|${skinHex}`;
  if (faceTexCache.has(key)) {
    const entry = faceTexCache.get(key);
    if (entry.ready) onReady?.(entry.tex, entry.info);
    else if (onReady) entry.waiters.push(onReady);
    return entry.tex;
  }
  const N = FACE_TEX;
  const { g, t } = canvasTex(N, N);
  t.anisotropy = 16;   // clamped by three.js to the GPU maximum
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  const entry = { tex: t, ready: false, info: null, waiters: onReady ? [onReady] : [] };
  faceTexCache.set(key, entry);
  trackTexPromise(loadPhotoImage(path).then((img) => {
    if (!img) return;
    const iw = img.width || 512, ih = img.height || 512;
    const [cx, cy, rx, ry] = crop;
    g.clearRect(0, 0, N, N);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, (cx - rx * FACE_K) * iw, (cy - ry * FACE_K) * ih, rx * 2 * FACE_K * iw, ry * 2 * FACE_K * ih, 0, 0, N, N);
    const id = g.getImageData(0, 0, N, N), px = id.data;
    const half = N / 2;
    // 1. saturation → colourise black & white / sepia portraits with the look's skin tone
    let satSum = 0, satN = 0;
    for (let y = half * 0.6; y < half * 1.4; y += 4) for (let x = half * 0.6; x < half * 1.4; x += 4) {
      const i = ((y | 0) * N + (x | 0)) * 4;
      satSum += Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]); satN++;
    }
    const lookSkin = new THREE.Color(skinHex);
    if (satSum / satN < 18) {
      const hsl = lookSkin.getHSL({}, THREE.SRGBColorSpace);
      const c = new THREE.Color();
      for (let i = 0; i < px.length; i += 4) {
        const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        c.setHSL(hsl.h, hsl.s * 0.75, clamp(l * 0.92 + 0.04, 0, 1), THREE.LinearSRGBColorSpace);   // raw (sRGB-encoded) values
        const k = 0.62;
        px[i] = lerp(px[i], c.r * 255, k); px[i + 1] = lerp(px[i + 1], c.g * 255, k); px[i + 2] = lerp(px[i + 2], c.b * 255, k);
      }
    }
    // 2. sample cheek colour (robust mean of the mid-luminance band)
    const samples = [];
    for (let y = 0; y < N; y += 3) for (let x = 0; x < N; x += 3) {
      const ex = (x - half) / half * FACE_K, ey = -(y - half) / half * FACE_K;
      if (Math.abs(ex) < 0.22 || Math.abs(ex) > 0.62 || ey > 0.05 || ey < -0.55) continue;
      const i = (y * N + x) * 4;
      samples.push([px[i], px[i + 1], px[i + 2], 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]]);
    }
    samples.sort((a, b) => a[3] - b[3]);
    const lo = Math.floor(samples.length * 0.25), hi = Math.max(lo + 1, Math.floor(samples.length * 0.8));
    let sr = 0, sg = 0, sb = 0;
    for (let k = lo; k < hi; k++) { sr += samples[k][0]; sg += samples[k][1]; sb += samples[k][2]; }
    const n = hi - lo || 1;
    sr /= n; sg /= n; sb /= n;
    // 3. feather: tint toward cheek colour near the rim, elliptical alpha falloff (chin a little tighter than brow)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ex = (x - half) / half * FACE_K, ey = -(y - half) / half * FACE_K;
      const r = Math.hypot(ex, ey > 0 ? ey * 0.96 : ey * 1.02);
      const i = (y * N + x) * 4;
      const tint = smooth01(0.74, 1.0, r);
      if (tint > 0) { px[i] = lerp(px[i], sr, tint); px[i + 1] = lerp(px[i + 1], sg, tint); px[i + 2] = lerp(px[i + 2], sb, tint); }
      px[i + 3] = Math.round(255 * (1 - smooth01(0.86, 1.08, r)));
    }
    g.putImageData(id, 0, 0);
    t.needsUpdate = true;
    entry.ready = true;
    entry.info = { skin: new THREE.Color(sr / 255, sg / 255, sb / 255).convertSRGBToLinear() };
    for (const cb of entry.waiters) cb(t, entry.info);
    entry.waiters.length = 0;
  }));
  return t;
}
// Height-field face patch that hugs the sculpted skull + jaw (planar/frontal UVs → the photo is not wrapped around the
// sphere). Grid covers the feathered face ellipse only; vertices outside every head primitive are dropped.
function buildFacePatchGeometry(shapes, fx, fy, fy0, nose) {
  const NX = 30, NY = 34;
  const ext = 1.1;   // face-ellipse units covered (alpha is 0 beyond ~1.08)
  const pos = [], uv = [], valid = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const ex = (i / NX * 2 - 1) * ext, ey = (j / NY * 2 - 1) * ext;
    const x = ex * fx, y = fy0 + ey * fy;
    let z = -Infinity;
    for (const sh of shapes) {
      const t = 1 - ((x - sh.c[0]) / sh.r[0]) ** 2 - ((y - sh.c[1]) / sh.r[1]) ** 2;
      if (t > 0.002) z = Math.max(z, sh.c[2] + sh.r[2] * Math.sqrt(t));
    }
    const ok = z > -Infinity && Math.hypot(ex, ey) < ext + 0.05;
    if (ok && nose) z += nose.h * Math.exp(-((x / nose.w) ** 2) - (((y - nose.y) / nose.l) ** 2));
    valid.push(ok);
    pos.push(x, y, ok ? z + 0.0025 : 0);
    uv.push(0.5 + ex / (2 * FACE_K), 0.5 + ey / (2 * FACE_K));
  }
  const idx = [];
  const at = (i, j) => j * (NX + 1) + i;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    if (valid[a] && valid[b] && valid[c] && valid[d]) idx.push(a, b, c, a, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
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
    this.numId = Number.isFinite(+id) ? +id : (hashStr(String(id)) % 97);
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

    this.sitYOffset = 0.11;
    this.topOffset = 1.72;
    this.R = R;
    return { main, light };
  }

  // 人格辩手：真实成人比例（~1:6.5~7.5 头身）+ 脸型/五官/专人发型/胡须/眼镜/分层服饰 + 照片贴花与胸前名牌。
  // Keeps all rig fields as build() so animations, gestures, picking and paddles work identically.
  buildPersona(L, role = null, opts = {}) {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    const R = this.root;
    const hScale = L.height || 1.0;
    const build = L.build || 1.0;
    const wScale = 1 + (build - 1) * 1.15;
    const dScale = 1 + (build - 1) * 1.05;
    const shoulderScale = L.shoulder_scale || (build >= 1.2 ? 1.04 : 1);
    const stoop = L.posture === 'stoop';
    const body = new THREE.Group();
    if (stoop) body.rotation.x = 0.09;
    body.scale.setScalar(hScale);
    R.add(body);
    this.body = body;

    const skin = L.skin || '#efc39c';
    const skinShadow = new THREE.Color(skin).offsetHSL(0, 0.04, -0.1);
    const skinSoftShadow = new THREE.Color(skin).offsetHSL(0, 0.02, -0.055);
    const lipCol = new THREE.Color(skin).offsetHSL(-0.02, 0.16, -0.18);
    // per-figure skin materials (re-tinted to the photo's cheek colour once the face decal loads)
    const skinM = new THREE.MeshStandardMaterial({ color: skin, ...MAT.skin });
    const skinShadowM = new THREE.MeshStandardMaterial({ color: skinShadow, ...MAT.skin });
    const skinSoftM = new THREE.MeshStandardMaterial({ color: skinSoftShadow, ...MAT.skin });
    this.skinMats = [skinM, skinShadowM, skinSoftM];
    const hairCol = L.hair || '#231c18';
    const hair = std(hairCol, MAT.hair);
    const bc = std(L.beard_color || hairCol, MAT.hair);
    const main = new THREE.Color(L.outfit_color || '#334155');
    const mainDark = main.clone().offsetHSL(0, 0, -0.09);
    const mainLight = main.clone().offsetHSL(0, -0.05, 0.15);
    const accent = new THREE.Color(L.accent || '#c9a13b');
    const innerCol = L.inner_color || (L.outfit === 'jacket' ? '#20242c' : '#f4f6f9');
    this.color = '#' + (main.getHSL({}).l < 0.22 || main.getHSL({}).l > 0.85 ? accent : main).getHexString();

    const long = L.outfit === 'robe' || L.outfit === 'changshan';
    const shortSleeve = L.outfit === 'tee' || L.outfit === 'polo';
    const pants = L.pants_color || (L.accessory === 'jeans' ? '#36588a' : long ? main : L.outfit === 'polo' ? '#6b5e50' : '#23262e');
    const shoeCol = L.accessory === 'sandals' ? '#8b5a2b' : L.accessory === 'jeans' ? '#b8bec7' : '#19181a';

    // 1. Legs (thigh + knee + shin + sculpted shoe/sandal) — hip pivot at y = 0.81
    const hipY = 0.81, torsoS = 1.12;
    const ty = (y) => hipY + (y - 0.74) * torsoS;
    this.knees = [];
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group(); hip.position.set(0.098 * side * wScale, hipY, 0); body.add(hip);
      const legR = 0.068 * (0.35 + 0.65 * wScale);
      mesh(G.sphereMid, pants, { p: [0, -0.02, 0], s: [legR, legR, legR], parent: hip });
      mesh(G.limbCyl, pants, { p: [0, -0.185, 0], s: [legR * 0.96, 0.34, legR * 0.96], cast: true, parent: hip });
      const knee = new THREE.Group(); knee.position.set(0, -0.37, 0); hip.add(knee);
      this.knees.push(knee);
      mesh(G.sphereLo, pants, { s: legR * 0.82, parent: knee });
      const shinCol = L.accessory === 'sandals' ? skinM : pants;
      mesh(G.limbCyl, shinCol, { p: [0, -0.185, 0], s: [legR * 0.78, 0.34, legR * 0.78], cast: true, parent: knee });
      // Foot / Shoe
      if (L.accessory === 'sandals') {
        mesh(G.box, shoeCol, { p: [0, -0.39, 0.032], s: [0.095, 0.024, 0.19], cast: true, parent: knee });
        mesh(G.sphereMid, skinM, { p: [0, -0.37, 0.03], s: [0.044, 0.026, 0.088], parent: knee });
        mesh(G.box, shoeCol, { p: [0, -0.355, 0.045], s: [0.09, 0.014, 0.03], parent: knee });
      } else {
        mesh(G.sphereMid, shoeCol, { p: [0, -0.38, 0.04], s: [0.055, 0.04, 0.095], cast: true, parent: knee });
        mesh(G.box, shoeCol, { p: [0, -0.398, 0.02], s: [0.098, 0.03, 0.175], cast: true, parent: knee });
        if (L.accessory === 'jeans') mesh(G.box, '#eef0f3', { p: [0, -0.412, 0.025], s: [0.101, 0.015, 0.18], parent: knee });
      }
      return hip;
    });

    // 2. Pelvis, Waist, Chest, Shoulders, Neck
    const chestW = 0.205 * wScale * shoulderScale, chestD = 0.125 * dScale;
    const belly = L.belly ?? (build > 1.12 ? 1 + (build - 1.1) * 1.0 : 1);
    const waistW = 0.162 * wScale * belly, waistD = 0.112 * dScale * belly;
    const bodySkip = new Set();
    mesh(G.sphereMid, pants, { p: [0, ty(0.74), 0], s: [0.168 * wScale * Math.max(1, belly * 0.92), 0.085 * torsoS, 0.115 * dScale * Math.max(1, belly * 0.92)], cast: true, parent: body });
    mesh(G.taperCyl, main, { p: [0, ty(0.87), 0], s: [waistW, 0.19 * torsoS, waistD], cast: true, recv: true, parent: body });
    if (belly >= 1.12) {
      mesh(G.sphereMid, main, { p: [0, ty(0.90), chestD * 0.26], s: [waistW * 0.96, 0.145 * torsoS, waistD * 1.04], cast: true, recv: true, parent: body });
    }
    mesh(G.taperCyl, main, { p: [0, ty(1.06), 0], s: [chestW, 0.22 * torsoS, chestD], r: [Math.PI, 0, 0], cast: true, recv: true, parent: body });
    // Upper chest cap & shoulder fullness
    mesh(G.sphereMid, main, { p: [0, ty(1.13), 0], s: [chestW * 0.94, 0.08 * torsoS, chestD * 0.92], cast: true, parent: body });
    // Neck (connects seamlessly from upper chest into jaw/skull base — no floating head gap)
    const neckZ = stoop ? 0.025 : 0;
    const neckR = 0.048 * (L.neck_scale || (1 + (build - 1) * 1.15));
    mesh(G.cyl, skinM, { p: [0, 1.385, neckZ], s: [neckR, 0.19, neckR], r: [stoop ? -0.14 : 0, 0, 0], cast: true, parent: body });

    // 3. Outfits & Collars
    const frontZ = chestD * 0.92;
    const hipZ = waistD * 0.96;
    const lapelCol = main.clone().offsetHSL(0, 0, main.getHSL({}).l < 0.22 ? 0.045 : -0.05);
    if (long) {
      // Lower gown skirt over legs (slimmer cut for lean figures like Lu Xun)
      const skirtW = (build < 0.92 ? 0.202 : 0.235) * wScale;
      mesh(G.taperCyl, main, { p: [0, ty(0.44), 0], s: [skirtW, 0.64 * torsoS, 0.185 * dScale], r: [Math.PI, 0, 0], cast: true, recv: true, parent: body });
      if (L.outfit === 'robe') {
        if (L.accessory === 'scholar-hat' || L.hair_style === 'topknot') {
          // Hanfu (孔子): white inner collar + vivid royal blue crossed lapels + gold belt sash
          const beltCol = L.belt_color || mainDark;
          mesh(G.torus, innerCol, { p: [0, ty(1.175), 0.01], s: [0.082, 0.082, 0.22], r: [Math.PI / 2, 0, 0], parent: body });
          mesh(G.box, accent, { p: [-0.032, ty(1.06), frontZ + 0.002], s: [0.046, 0.24 * torsoS, 0.016], r: [0.08, 0, -0.42], parent: body });
          mesh(G.box, accent, { p: [0.032, ty(1.06), frontZ + 0.006], s: [0.046, 0.24 * torsoS, 0.016], r: [0.08, 0, 0.42], parent: body });
          mesh(G.cyl, beltCol, { p: [0, ty(0.85), 0], s: [waistW * 1.05, 0.058 * torsoS, waistD * 1.05], parent: body });
          mesh(G.box, beltCol, { p: [0.05, ty(0.71), hipZ + 0.015], s: [0.048, 0.26 * torsoS, 0.016], parent: body });
        } else {
          // Greek draped himation (苏格拉底): diagonal shoulder drape fold + warm sash
          mesh(G.box, mainLight, { p: [-0.02, ty(1.04), frontZ + 0.004], s: [0.11, 0.32 * torsoS, 0.024], r: [0.08, 0, 0.54], cast: true, parent: body });
          mesh(G.box, accent, { p: [0.01, ty(1.02), frontZ + 0.012], s: [0.03, 0.32 * torsoS, 0.016], r: [0.08, 0, 0.54], parent: body });
          mesh(G.cyl, accent, { p: [0, ty(0.84), 0], s: [waistW * 1.03, 0.04 * torsoS, waistD * 1.03], parent: body });
        }
      } else {
        // Changshan (鲁迅): crisp Mandarin stand collar + center placket + frog buttons
        mesh(G.cyl, mainDark, { p: [0, ty(1.19), 0], s: [0.078, 0.065 * torsoS, 0.078], parent: body });
        mesh(G.box, accent, { p: [0, ty(0.78), frontZ + 0.002], s: [0.028, 0.72 * torsoS, 0.012], parent: body });
        [1.11, 1.01, 0.91, 0.81].forEach((y) => mesh(G.box, '#1b1d22', { p: [0.01, ty(y), frontZ + 0.009], s: [0.04, 0.011, 0.009], parent: body }));
      }
    }
    if (L.outfit === 'turtleneck') {
      mesh(G.cyl, main, { p: [0, ty(1.21), 0], s: [0.076, 0.095 * torsoS, 0.076], parent: body });
      mesh(G.cyl, '#1f2024', { p: [0, ty(0.79), 0], s: [waistW * 1.02, 0.03 * torsoS, waistD * 1.02], parent: body });
    }
    if (L.outfit === 'suit' || L.outfit === 'jacket') {
      if (L.zip_jacket) {
        // Casual zip-up jacket over crew-neck tee (张雪峰) — rounded collar + visible front zipper
        const colR = Math.max(0.082, neckR * 1.12);
        mesh(G.torus, mainDark, { p: [0, ty(1.175), 0], s: [colR, colR, 0.22], r: [Math.PI / 2, 0, 0], parent: body });
        mesh(G.cone, innerCol, { p: [0, ty(1.10), frontZ - 0.002], s: [0.068, 0.13 * torsoS, 0.028], r: [Math.PI, 0, 0], parent: body });
        mesh(G.box, L.accent || '#717885', { p: [0, ty(0.91), Math.max(frontZ, waistD * 0.92) + 0.004], s: [0.01, 0.25 * torsoS, 0.01], parent: body });
      } else {
        // Tailored inner shirt V-opening + crisp collar + flush lapels (no protruding black bars)
        const wideV = L.outfit === 'jacket' && !L.tie_color && L.accessory !== 'x-logo';
        const vW = wideV ? 0.095 : 0.072;
        mesh(G.cone, innerCol, { p: [0, ty(1.065), frontZ - 0.004], s: [vW, 0.23 * torsoS, 0.032], r: [Math.PI, 0, 0], parent: body });
        [-1, 1].forEach((side) => {
          mesh(G.box, lapelCol, { p: [0.048 * side, ty(1.07), frontZ + 0.002], s: [0.032, 0.20 * torsoS, 0.012], r: [0.10, 0, 0.24 * side], parent: body });
          mesh(G.box, innerCol, { p: [0.034 * side, ty(1.17), frontZ * 0.80], s: [0.046, 0.028 * torsoS, 0.02], r: [0.2, 0, -0.42 * side], parent: body });
        });
        [0.9, 0.82].forEach((y) => mesh(G.sphereLo, '#27272a', { p: [0.02, ty(y), hipZ + 0.004], s: 0.01, parent: body }));
      }
    }
    if (L.outfit === 'shirt') {
      [-1, 1].forEach((side) => mesh(G.box, mainDark, { p: [0.042 * side, ty(1.175), frontZ * 0.78], s: [0.055, 0.032 * torsoS, 0.024], r: [0.2, 0, -0.42 * side], parent: body }));
      mesh(G.box, '#1b1d22', { p: [0, ty(0.79), 0], s: [waistW * 1.98, 0.028 * torsoS, waistD * 1.98], parent: body });
    }
    if (L.outfit === 'polo') {
      mesh(G.torus, mainDark, { p: [0, ty(1.18), 0], s: [0.076, 0.076, 0.25], r: [Math.PI / 2, 0, 0], parent: body });
      [-1, 1].forEach((side) => mesh(G.box, mainLight, { p: [0.05 * side, ty(1.17), frontZ * 0.82], s: [0.06, 0.036 * torsoS, 0.024], r: [0.2, 0, -0.35 * side], parent: body }));
      mesh(G.box, mainDark, { p: [0, ty(1.07), frontZ + 0.004], s: [0.034, 0.13 * torsoS, 0.014], parent: body });
      [1.11, 1.05].forEach((y) => mesh(G.sphereLo, accent, { p: [0, ty(y), frontZ + 0.012], s: 0.009, parent: body }));
    }
    if (L.outfit === 'tee') {
      mesh(G.torus, mainDark, { p: [0, ty(1.175), 0], s: [0.078, 0.078, 0.2], r: [Math.PI / 2, 0, 0], parent: body });
      if (L.accent && L.hair_style === 'curly-saltpepper') {
        mesh(G.cone, skinM, { p: [0, ty(1.13), frontZ * 0.88], s: [0.035, 0.08 * torsoS, 0.016], r: [Math.PI, 0, 0], parent: body });
      }
    }
    // Tie / Long Tie
    if (L.accessory === 'tie' || L.accessory === 'long-tie' || L.tie_color) {
      const tieCol = L.tie_color || accent;
      const ln = (L.accessory === 'long-tie' ? 0.36 : 0.24) * torsoS;
      mesh(G.sphereLo, tieCol, { p: [0, ty(1.155), frontZ + 0.012], s: [0.022, 0.02, 0.016], parent: body });
      mesh(G.box, tieCol, { p: [0, ty(1.14) - ln / 2, frontZ + 0.010], s: [0.04, ln, 0.012], parent: body });
      mesh(G.cone, tieCol, { p: [0, ty(1.13) - ln, frontZ + 0.010], s: [0.03, 0.05, 0.012], r: [Math.PI, 0, 0], parent: body });
    }
    // X-logo on chest (Musk)
    if (L.accessory === 'x-logo') {
      [-1, 1].forEach((side) => mesh(G.box, accent, { p: [0, ty(1.045), frontZ + 0.01], s: [0.014, 0.10 * torsoS, 0.008], r: [0, 0, 0.6 * side], parent: body }));
    }
    // Camera strap (Fengge)
    if (L.accessory === 'camera') {
      mesh(G.box, accent, { p: [-0.02, ty(1.01), frontZ + 0.01], s: [0.024, 0.36 * torsoS, 0.012], r: [0.08, 0, 0.56], parent: body });
    }

    // Chest Photo Nameplate Badge (conference speaker badge on left chest)
    const personaId = role?.persona_id || L.id || null;
    const photoPath = resolvePhotoPath(personaId, role);
    if (photoPath && opts.showBadge !== false) {
      const bMat = getBadgeMaterial(photoPath);
      if (bMat) {
        const badgeG = new THREE.Group();
        badgeG.position.set(0.098 * wScale, ty(1.07), frontZ + (belly > 1.12 ? 0.022 : 0.016));
        badgeG.rotation.y = 0.22;
        body.add(badgeG);
        mesh(G.cyl, '#d4af37', { p: [0, 0, -0.003], s: [0.045, 0.006, 0.045], r: [Math.PI / 2, 0, 0], parent: badgeG });
        mesh(G.disc, bMat, { p: [0, 0, 0.002], s: 0.041, parent: badgeG });
      }
    }

    // 4. Arms (shoulder -> upper arm -> elbow -> forearm -> hand + thumb)
    const wideSleeve = L.outfit === 'robe' && (L.accessory === 'scholar-hat' || L.hair_style === 'topknot');
    this.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group();
      sh.position.set((chestW + 0.035) * side, ty(1.13), 0);
      body.add(sh);
      const armR = 0.048 * (0.35 + 0.65 * wScale);
      const sleeveCol = main;
      const foreCol = shortSleeve ? skinM : main;
      mesh(G.sphereMid, sleeveCol, { s: armR * 1.15, cast: true, parent: sh });
      mesh(G.limbCyl, sleeveCol, { p: [0, -0.12, 0], s: [armR, 0.23, armR], cast: true, parent: sh });
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.24, 0);
      elbow.rotation.x = -0.22;
      sh.add(elbow);
      mesh(G.sphereLo, foreCol, { s: armR * (wideSleeve ? 1.1 : 0.88), parent: elbow });
      mesh(G.limbCyl, foreCol, { p: [0, -0.105, 0], s: [armR * (wideSleeve ? 1.38 : 0.84), 0.20, armR * (wideSleeve ? 1.38 : 0.84)], cast: true, parent: elbow });
      // Hand palm + thumb
      mesh(G.sphereMid, skinM, { p: [0, -0.215, 0.005], s: [0.032, 0.046, 0.022], cast: true, parent: elbow });
      mesh(G.sphereLo, skinM, { p: [-0.024 * side, -0.205, 0.02], s: [0.013, 0.024, 0.013], r: [0.3, 0, 0.4 * side], parent: elbow });
      return sh;
    });
    const hand = (i) => this.arms[i].children[2]; // elbow group (hand is at y = -0.215 inside elbow)
    if (L.accessory === 'mic') {
      const g = hand(1);
      mesh(G.cyl, '#1e1e22', { p: [0, -0.25, 0.045], s: [0.018, 0.13, 0.018], r: [0.6, 0, 0], parent: g });
      mesh(G.sphereMid, '#71717a', { p: [0, -0.2, 0.1], s: 0.036, parent: g });
    }
    if (L.accessory === 'camera') {
      const g = hand(0);
      mesh(G.box, '#1b1f26', { p: [0, -0.24, 0.055], s: [0.125, 0.08, 0.055], parent: g });
      mesh(G.cyl, '#38bdf8', { p: [0, -0.24, 0.088], s: [0.028, 0.02, 0.028], r: [Math.PI / 2, 0, 0], parent: g });
      mesh(G.sphereLo, '#ef4444', { p: [-0.04, -0.215, 0.084], s: 0.009, parent: g });
    }
    if (L.accessory === 'book') {
      const g = hand(0);
      mesh(G.box, accent, { p: [0.01, -0.24, 0.055], s: [0.13, 0.17, 0.034], parent: g });
      mesh(G.box, '#fef3c7', { p: [0.02, -0.24, 0.055], s: [0.115, 0.155, 0.024], parent: g });
    }
    if (L.accessory === 'bongo') {
      const g = hand(0);
      mesh(G.cyl, '#9c5221', { p: [0.07, -0.24, 0.06], s: [0.065, 0.12, 0.065], parent: g });
      mesh(G.cyl, '#f0dfc2', { p: [0.07, -0.18, 0.06], s: [0.062, 0.012, 0.062], parent: g });
      mesh(G.cyl, '#844218', { p: [0.17, -0.25, 0.045], s: [0.055, 0.105, 0.055], parent: g });
      mesh(G.cyl, '#f0dfc2', { p: [0.17, -0.198, 0.045], s: [0.053, 0.012, 0.053], parent: g });
    }
    if (L.prop === 'iphone') {
      const g = hand(1);
      mesh(G.box, '#f4f4f6', { p: [0, -0.23, 0.045], s: [0.05, 0.092, 0.01], r: [-0.25, 0, 0], parent: g });
      mesh(G.box, '#18181b', { p: [0, -0.23, 0.051], s: [0.042, 0.072, 0.002], r: [-0.25, 0, 0], parent: g });
    }

    // 5. Head & Face Geometry (adult 6.5~7.5 head-to-body proportion: uniform headScale 0.61, head center y = 1.57)
    const headScale = 0.61;
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.40, stoop ? 0.035 : 0);
    if (stoop) headPivot.rotation.x = -0.07;
    body.add(headPivot);
    this.headPivot = headPivot;

    const head = new THREE.Group();
    head.position.set(0, 0.17, 0);
    head.scale.setScalar(headScale);
    headPivot.add(head);
    this.head = head;

    const F = L.face || {};
    const fShape = F.shape || L.face_shape || 'oval';
    const SHAPES = {
      square:       { hx: 0.168, hy: 0.182, hz: 0.172, jx: 0.96, jy: -0.082, jz: 0.88, chinW: 0.78, chinY: -0.138 },
      round:        { hx: 0.180, hy: 0.172, hz: 0.176, jx: 1.02, jy: -0.064, jz: 0.95, chinW: 0.70, chinY: -0.128 },
      broad:        { hx: 0.182, hy: 0.184, hz: 0.176, jx: 0.98, jy: -0.075, jz: 0.92, chinW: 0.76, chinY: -0.138 },
      long:         { hx: 0.136, hy: 0.204, hz: 0.164, jx: 0.66, jy: -0.098, jz: 0.76, chinW: 0.42, chinY: -0.158 },
      gaunt:        { hx: 0.138, hy: 0.196, hz: 0.166, jx: 0.64, jy: -0.094, jz: 0.78, chinW: 0.40, chinY: -0.152 },
      oval:         { hx: 0.155, hy: 0.188, hz: 0.168, jx: 0.78, jy: -0.084, jz: 0.82, chinW: 0.54, chinY: -0.142 },
      'oval-round': { hx: 0.176, hy: 0.172, hz: 0.172, jx: 0.94, jy: -0.070, jz: 0.88, chinW: 0.66, chinY: -0.130 },
    };
    const fs = SHAPES[fShape] || SHAPES.oval;
    const fLen = F.length || 1;
    const fWid = F.width || 1;
    const hx = fs.hx * fWid, hy = fs.hy * fLen, hz = fs.hz * (0.96 + 0.04 * fWid);
    const jawW = fs.jx * (F.jaw || 1);
    const hyK = hy / 0.185;
    const onSculptHead = (x, y, k = 1) => {
      const t = 1 - (x / hx) ** 2 - (y / hy) ** 2;
      return hz * Math.sqrt(Math.max(0, t)) * k;
    };
    const headSkip = new Set();

    // Skull + Jaw/Chin + Cheeks/Jowls + Ears
    const skullMesh = mesh(G.head, skinM, { s: [hx, hy, hz], cast: true, recv: true, parent: head });
    this.skull = skullMesh;
    headSkip.add(skullMesh);
    mesh(G.sphereMid, skinM, { p: [0, fs.jy * fLen, 0.018], s: [hx * jawW, hy * 0.58, hz * fs.jz], cast: true, parent: head });
    if (fShape === 'square' || fShape === 'broad' || (F.jaw || 1) >= 1.08) {
      [-1, 1].forEach((side) => {
        mesh(G.sphereLo, skinM, { p: [hx * jawW * 0.62 * side, fs.jy * fLen - 0.032, hz * 0.24], s: [0.044 * (F.jaw || 1), 0.048, 0.052], parent: head });
      });
      mesh(G.box, skinM, { p: [0, fs.chinY * fLen, hz * 0.40], s: [hx * fs.chinW * 0.72, 0.042, 0.056], parent: head });
    } else if (fShape === 'long' || fShape === 'gaunt') {
      mesh(G.sphereMid, skinM, { p: [0, fs.chinY * fLen, hz * 0.34], s: [hx * fs.chinW, 0.048, 0.054], parent: head });
    }
    const cheeks = F.cheeks ?? 0;
    if (cheeks > 0.15) {
      [-1, 1].forEach((side) => {
        mesh(G.sphereMid, skinM, { p: [hx * 0.42 * side, -0.048, hz * 0.50], s: [0.046 + 0.014 * cheeks, 0.040 + 0.010 * cheeks, 0.044], parent: head });
      });
    } else if (cheeks < -0.1) {
      [-1, 1].forEach((side) => {
        mesh(G.sphereLo, skinM, { p: [hx * 0.62 * side, -0.014, hz * 0.60], s: [0.034, 0.021, 0.028], parent: head });
        mesh(G.sphereLo, skinSoftM, { p: [hx * 0.55 * side, -0.058, hz * 0.54], s: [0.028, 0.032, 0.015], parent: head });
      });
    }
    const jowls = F.jowls ?? 0;
    if (jowls > 0.1) {
      [-1, 1].forEach((side) => {
        mesh(G.sphereMid, skinM, { p: [hx * 0.44 * side, -0.090 * fLen, hz * 0.46], s: [0.044 + 0.010 * jowls, 0.042, 0.044], parent: head });
      });
    }
    [-1, 1].forEach((side) => {
      mesh(G.sphereMid, skinM, { p: [hx * 0.96 * side, -0.005, -0.012], s: [0.022, 0.046, 0.03], r: [0, -0.15 * side, -0.08 * side], parent: head });
      mesh(G.sphereLo, skinShadowM, { p: [hx * 0.99 * side, -0.005, -0.008], s: [0.01, 0.026, 0.016], parent: head });
    });

    // Sculpted 3D Eyes, Sockets, Brows, Nose, Mouth, Age Lines (sockets/brows/nose/lines live in faceFeat → hidden under the photo face)
    const faceFeat = new THREE.Group(); head.add(faceFeat);
    const beardG = new THREE.Group(); head.add(beardG);
    const ex = hx * 0.37 * (F.eyeDist || 1), ey = 0.016;
    const es = F.eyeSize || 1;
    const deepSet = F.deepSet ?? 0;
    const eyeTilt = F.eyeTilt || 0;
    if (deepSet > 0.15) {
      [-1, 1].forEach((side) => {
        const x = ex * side;
        mesh(G.sphereLo, skinSoftM, { p: [x, ey - 0.003, onSculptHead(x, ey) - 0.008], s: [0.036, 0.025, 0.015], parent: faceFeat });
        mesh(G.sphereLo, skinM, { p: [x * 0.92, ey + 0.025, onSculptHead(x, ey + 0.025) + 0.002 * deepSet], s: [0.050, 0.014, 0.016 + 0.008 * deepSet], parent: faceFeat });
      });
    }
    const irisCol = ['musk', 'jobs', 'munger', 'trump', 'feynman', 'paulgraham', 'nietzsche', 'socrates'].includes(personaId) ? '#3b4e63' : '#231b17';
    this.eyes = [-1, 1].map((side) => {
      const g = new THREE.Group();
      const x = ex * side, z = onSculptHead(x, ey);
      g.position.set(x, ey, z - 0.007 - 0.005 * deepSet);
      g.rotation.z = eyeTilt * side;
      head.add(g);
      mesh(G.sphereLo, '#ffffff', { s: [0.027 * (0.65 + 0.35 * es), 0.021 * es, 0.016], parent: g });
      mesh(G.sphereLo, irisCol, { p: [0, -0.001, 0.011], s: [0.014 * (0.7 + 0.3 * es), 0.015 * es, 0.009], parent: g });
      mesh(G.box, '#111111', { p: [0, -0.001, 0.016], s: [0.01 * (0.7 + 0.3 * es), 0.011 * es, 0.007], parent: g });
      mesh(G.box, '#ffffff', { p: [0.005, 0.005 * es, 0.019], s: [0.005, 0.005, 0.004], parent: g });
      const heavyLid = es < 0.88 || eyeTilt < -0.04 || deepSet > 0.5;
      mesh(G.box, skinShadowM, { p: [0, 0.015 * es, 0.004], s: [0.048, heavyLid ? 0.010 : 0.007, 0.016], r: [0, 0, -0.12 * side], parent: g });
      return g;
    });
    const bald = L.hair_style === 'bald' || L.hair_style === 'bald-ring' || L.hair_style === 'bald-curly-ring' || L.hair_style === 'bald-sparse' || L.hair_style === 'balding-fringe';
    const browCol = L.brow_color || (bald ? (L.beard_color || hairCol) : hairCol);
    const bushyBrow = ['socrates', 'munger', 'trump', 'zhangxuefeng', 'luxun', 'confucius', 'nietzsche'].includes(personaId);
    const bThick = F.browThick || (bushyBrow ? 1.4 : 1.0);
    const bWidth = F.browWidth || 1.0;
    this.browBase = F.browAngle ?? (personaId === 'confucius' ? 0.14 : personaId === 'luxun' ? 0.12 : 0.05);
    this.brows = [-1, 1].map((side) => {
      const x = ex * side, y = ey + 0.036;
      const br = mesh(G.box, browCol, { p: [x, y, onSculptHead(x, y) + 0.007 + 0.009 * deepSet], s: [0.048 * bWidth, 0.010 * bThick, 0.015], r: [0, 0, this.browBase * side], parent: faceFeat });
      headSkip.add(br);
      return br;
    });
    // Nose bridge + tip + wings (snub / aquiline / broad / button / straight)
    const nStyle = F.noseStyle || L.nose_style || 'straight';
    const ns = F.noseSize || 1;
    const nl = F.noseLen || 1;
    const nTilt = nStyle === 'aquiline' ? -0.30 : nStyle === 'snub' ? -0.18 : -0.25;
    const bridgeW = (nStyle === 'snub' ? 0.018 : nStyle === 'broad' ? 0.016 : 0.0125) * ns;
    const bridgeL = (nStyle === 'snub' ? 0.036 : nStyle === 'button' ? 0.044 : 0.055) * nl;
    mesh(G.limbCyl, skinShadowM, { p: [0, -0.008, onSculptHead(0, -0.008) + 0.008], s: [bridgeW, bridgeL, 0.017 * (0.7 + 0.3 * ns)], r: [nTilt, 0, 0], parent: faceFeat });
    const tipY = -0.008 - bridgeL * 0.48;
    const tipZ = onSculptHead(0, tipY) + 0.015 + (nStyle === 'aquiline' ? 0.004 : 0);
    mesh(G.sphereLo, skinShadowM, { p: [0, tipY, tipZ], s: [(nStyle === 'snub' ? 0.022 : 0.015) * ns, 0.013 * (nStyle === 'snub' ? 1.15 : 1), (nStyle === 'snub' ? 0.019 : 0.016) * (0.7 + 0.3 * ns)], parent: faceFeat });
    if (nStyle === 'snub' || nStyle === 'broad') {
      [-1, 1].forEach((side) => mesh(G.sphereLo, skinShadowM, { p: [0.015 * ns * side, tipY - 0.002, tipZ - 0.004], s: [0.010 * ns, 0.009, 0.010], parent: faceFeat }));
    }
    // Mouth (lips + expression)
    const my = -0.088 * (0.94 + 0.06 * fLen);
    const mw = F.mouthW || 1;
    const mExpr = F.mouthExpr || ((personaId === 'trump' || personaId === 'paulgraham' || personaId === 'feynman') ? 'grin' : 'neutral');
    const mouth = new THREE.Group();
    mouth.position.set(0, my, onSculptHead(0, my) + 0.002);
    head.add(mouth);
    this.mouth = mouth;
    if (mExpr === 'grin') {
      mesh(G.sphereLo, '#ffffff', { p: [0, 0, 0.003], s: [0.034 * mw, 0.013, 0.008], parent: mouth });
      mesh(G.arc, lipCol, { p: [0, 0.006, 0.004], s: [0.036 * mw, 0.022, 0.02], r: [0, 0, Math.PI], parent: mouth });
    } else if (mExpr === 'open-smile') {
      mesh(G.sphereLo, '#4a1c19', { p: [0, -0.001, 0.002], s: [0.028 * mw, 0.014, 0.007], parent: mouth });
      mesh(G.box, '#ffffff', { p: [0, 0.004, 0.005], s: [0.032 * mw, 0.007, 0.005], parent: mouth });
      mesh(G.arc, lipCol, { p: [0, 0.005, 0.005], s: [0.032 * mw, 0.020, 0.018], r: [0, 0, Math.PI], parent: mouth });
    } else if (mExpr === 'smile') {
      mesh(G.arc, lipCol, { p: [0, 0.007, 0.004], s: [0.030 * mw, 0.017, 0.016], r: [0, 0, Math.PI], parent: mouth });
      mesh(G.box, lipCol, { p: [0, 0.004, 0.003], s: [0.042 * mw, 0.005, 0.010], parent: mouth });
    } else if (mExpr === 'smirk') {
      mesh(G.box, lipCol, { p: [0, 0.002, 0.003], s: [0.044 * mw, 0.007, 0.011], r: [0, 0, 0.07], parent: mouth });
      mesh(G.sphereLo, lipCol, { p: [0.002, -0.004, 0.004], s: [0.022 * mw, 0.006, 0.009], parent: mouth });
    } else {
      mesh(G.box, lipCol, { p: [0, 0.003, 0.003], s: [0.046 * mw, 0.008, 0.012], parent: mouth });
      mesh(G.sphereLo, lipCol, { p: [0, -0.004, 0.004], s: [0.024 * mw, 0.007, 0.01], parent: mouth });
    }
    // Age lines / nasolabial folds & forehead creases
    const ageLines = F.ageLines || 0;
    if (ageLines > 0.2) {
      [-1, 1].forEach((side) => {
        const ax = 0.038 * fWid * side, ay = -0.062 * fLen;
        mesh(G.box, skinShadowM, { p: [ax, ay, onSculptHead(ax, ay) + 0.002], s: [0.0045, 0.038, 0.006], r: [0.16, 0, -0.36 * side], parent: faceFeat });
      });
      if (ageLines >= 0.6) {
        [0.088, 0.106].forEach((fy) => {
          const y = fy * fLen;
          mesh(G.box, skinShadowM, { p: [0, y, onSculptHead(0, y) + 0.001], s: [hx * 0.54, 0.0035, 0.005], parent: faceFeat });
        });
      }
    }

    // Photo face (default on when the persona has a photo + face_crop; opts.faceDecal === false keeps the pure 3D face).
    // High-res feathered crop on a height-field patch that hugs skull + jaw (planar UVs → no wrap-around stretching).
    const useDecal = opts.faceDecal !== false && photoPath && L.face_crop;
    this.faceReady = false;
    if (useDecal) {
      const fit = L.face_fit || {};
      const fx = hx * (fit.sx || 0.9), fy = hy * (fit.sy || 1.0), fy0 = (fit.dy || 0) * hy;
      const shapes = [
        { c: [0, 0, 0], r: [hx, hy, hz] },
        { c: [0, fs.jy * fLen, 0.018], r: [hx * jawW, hy * 0.58, hz * fs.jz] },
      ];
      const nose = { h: 0.016 * (F.noseSize || 1), w: 0.02 * (F.noseSize || 1), l: 0.04 * (F.noseLen || 1), y: fy0 - fy * 0.3 };
      const fMat = new THREE.MeshStandardMaterial({ color: 0xffffff, ...MAT.skin, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const fPatch = new THREE.Mesh(buildFacePatchGeometry(shapes, fx, fy, fy0, nose), fMat);
      fPatch.renderOrder = 2; fPatch.receiveShadow = true;
      head.add(fPatch);
      headSkip.add(fPatch);
      this.facePatch = fPatch;
      const thinBeard = ['mustache', 'goatee', 'stubble', 'light-stubble', 'short', 'walrus'].includes(L.beard);
      const skinBase = this.skinMats.map((m) => m.color.clone());
      const decalTex = getFaceDecalTexture(photoPath, L.face_crop, skin, (tex, info) => {
        fMat.map = tex;
        fMat.opacity = 1;
        fMat.needsUpdate = true;
        this.faceReady = true;
        for (const e of this.eyes) e.visible = false;
        faceFeat.visible = false;
        this.mouth.visible = false;
        if (thinBeard) beardG.visible = false;
        // match sculpted skin (neck, ears, hands) to the photo so the face edge disappears
        if (info?.skin) {
          const k = fit.skinMix ?? 0.8;
          const base = skinBase[0];
          this.skinMats.forEach((m, i) => {
            const target = info.skin.clone().multiply(new THREE.Color(skinBase[i].r / Math.max(1e-4, base.r), skinBase[i].g / Math.max(1e-4, base.g), skinBase[i].b / Math.max(1e-4, base.b)));
            m.color.copy(skinBase[i]).lerp(target, k);
          });
        }
      });
      if (decalTex) fMat.map = decalTex;
    }

    // 6. Dedicated 3D Hairstyles (no shared generic helmet!)
    const st = L.hair_style || 'short';
    const sideBackCrown = (col, h = 1.03, zOff = -0.022) => {
      mesh(G.sphere, col, { p: [0, 0.03, zOff], s: [hx * 1.04, hy * h, hz * 1.03], cast: true, parent: head });
    };
    if (st === 'musk-swept') {
      mesh(G.sphere, hair, { p: [0, 0.055 * hyK, -0.035], s: [hx * 1.03, hy * 0.92, hz * 0.98], cast: true, parent: head });
      mesh(G.sphereMid, hair, { p: [-0.02, 0.165 * hyK, 0.02], s: [hx * 0.86, 0.055, hz * 0.78], r: [-0.18, 0.12, 0.08], cast: true, parent: head });
      mesh(G.sphereMid, hair, { p: [0.05, 0.15 * hyK, 0.03], s: [hx * 0.52, 0.048, hz * 0.65], r: [-0.1, -0.1, -0.18], parent: head });
      [-1, 1].forEach((side) => mesh(G.box, hair, { p: [hx * 0.92 * side, 0.04, -0.01], s: [0.03, 0.095, 0.09], parent: head }));
    } else if (st === 'bald-curly-ring' || st === 'bald-ring') {
      // Exposed bald dome + curly white hair ring ONLY around sides & back (z <= 0)
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * 0.68 + (i / 8) * Math.PI * 1.36; // a=0 is BACK (-z), ±0.68π is temples
        mesh(G.sphereLo, hair, {
          p: [Math.sin(a) * hx * 0.98, 0.015 + Math.cos(a) * -0.01, -Math.cos(a) * hz * 0.95],
          s: [0.045, 0.052, 0.045], cast: true, parent: head
        });
      }
      mesh(G.sphereMid, hair, { p: [0, 0.02, -hz * 0.55], s: [hx * 0.96, hy * 0.58, hz * 0.52], parent: head });
    } else if (st === 'textured-crop' || st === 'short') {
      // Zhang Xuefeng: full short textured black crop brushed slightly up in front
      sideBackCrown(hair, 0.96, -0.025);
      mesh(G.sphereMid, hair, { p: [0, 0.158 * hyK, 0.015], s: [hx * 0.88, 0.055, hz * 0.76], r: [0.15, 0, 0], cast: true, parent: head });
      [-1, 0, 1].forEach((i) => mesh(G.box, hair, { p: [i * 0.04, 0.185 * hyK, 0.035], s: [0.048, 0.032, 0.055], r: [0.22, 0, -i * 0.14], parent: head }));
      [-1, 1].forEach((side) => mesh(G.box, hair, { p: [hx * 0.92 * side, 0.03, -0.015], s: [0.026, 0.085, 0.08], parent: head }));
    } else if (st === 'shaggy-wild') {
      // Fengge: voluminous untamed curls — crown lifted, side masses down past the ears to the jaw, heavy back
      sideBackCrown(hair, 1.06, -0.02);
      const pts = [
        [0, 0.215, 0.0], [-0.1, 0.205, 0.05], [0.1, 0.2, 0.05], [-0.16, 0.17, -0.04], [0.16, 0.175, -0.04], [0, 0.17, -0.14],
        [-0.2, 0.09, 0.0], [0.2, 0.1, 0.0], [-0.22, 0.0, -0.04], [0.22, 0.01, -0.05], [-0.21, -0.08, -0.05], [0.21, -0.07, -0.06],
        [-0.17, -0.14, -0.08], [0.17, -0.13, -0.09], [-0.12, 0.08, -0.17], [0.12, 0.08, -0.17], [0, -0.02, -0.2], [-0.1, -0.1, -0.16],
        [0.1, -0.1, -0.16], [-0.06, 0.19, 0.09], [0.05, 0.2, 0.1], [-0.14, 0.13, 0.08], [0.14, 0.12, 0.08]
      ];
      pts.forEach(([x, y, z], idx) => mesh(G.sphereLo, hair, { p: [x * (hx / 0.17) * 0.86, y * hyK, z], s: 0.062 + (idx % 4) * 0.011, cast: true, parent: head }));
    } else if (st === 'shaggy-curly' || st === 'curly') {
      sideBackCrown(hair, 1.0, -0.02);
      const pts = [
        [-0.17, 0.1, 0.02], [0.17, 0.1, 0.02], [-0.19, 0.02, -0.02], [0.19, 0.02, -0.02],
        [-0.18, -0.06, -0.04], [0.18, -0.06, -0.04], [-0.11, 0.18, 0.04], [0.11, 0.18, 0.04],
        [0, 0.19, 0.01], [-0.13, 0.15, -0.09], [0.13, 0.15, -0.09], [0, 0.12, -0.16],
        [-0.08, 0.14, 0.09], [0.07, 0.15, 0.08]
      ];
      pts.forEach(([x, y, z], idx) => mesh(G.sphereLo, hair, { p: [x * (hx / 0.17), y * hyK, z], s: 0.056 + (idx % 3) * 0.01, cast: true, parent: head }));
    } else if (st === 'balding-fringe' || st === 'short-thin') {
      // Jobs: high receding forehead + very close-cropped grey-brown hair on back, sides, and high crown
      mesh(G.sphere, hair, { p: [0, 0.035 * hyK, -0.048], s: [hx * 0.97, hy * 0.86, hz * 0.80], parent: head });
      mesh(G.sphereMid, hair, { p: [0, 0.135 * hyK, -0.038], s: [hx * 0.72, 0.052, hz * 0.62], parent: head });
      [-1, 1].forEach((side) => mesh(G.box, hair, { p: [hx * 0.92 * side, 0.035, -0.03], s: [0.02, 0.085, 0.075], parent: head }));
    } else if (st === 'bald-sparse') {
      // Elderly dome + side tufts + thin silver combover strands
      [-1, 1].forEach((side) => mesh(G.sphereMid, hair, { p: [hx * 0.9 * side, 0.02, -0.04], s: [0.032, 0.058, 0.075], parent: head }));
      mesh(G.sphere, hair, { p: [0, 0.02, -0.09], s: [hx * 0.88, hy * 0.65, hz * 0.6], parent: head });
      [-0.03, 0.02].forEach((z, idx) => mesh(G.box, hair, { p: [0, (0.178 - idx * 0.008) * hyK, z], s: [hx * 1.1, 0.012, 0.022], r: [0, 0, -0.08], parent: head }));
    } else if (st === 'wavy-50s' || st === 'wavy') {
      sideBackCrown(hair, 0.98, -0.025);
      mesh(G.sphereMid, hair, { p: [-0.05, 0.165 * hyK, 0.04], s: [0.125, 0.052, 0.105], r: [0.15, 0.2, 0.25], cast: true, parent: head });
      mesh(G.sphereMid, hair, { p: [0.08, 0.155 * hyK, 0.03], s: [0.095, 0.044, 0.095], r: [0.1, -0.15, -0.2], parent: head });
      [-1, 1].forEach((side) => mesh(G.sphereLo, hair, { p: [hx * 0.9 * side, 0.05, -0.02], s: [0.036, 0.07, 0.07], parent: head }));
    } else if (st === 'trump-swoop' || st === 'swoop') {
      sideBackCrown(hair, 1.02, -0.02);
      mesh(G.sphere, hair, { p: [0.02, 0.175 * hyK, 0.075], s: [hx * 1.08, 0.068, hz * 0.78], r: [0.28, 0.15, -0.1], cast: true, parent: head });
      mesh(G.sphereMid, hair, { p: [-0.07, 0.15 * hyK, 0.09], s: [0.095, 0.048, 0.08], r: [0.2, 0, 0.25], parent: head });
      [-1, 1].forEach((side) => mesh(G.sphereMid, hair, { p: [hx * 0.88 * side, 0.04, -0.01], s: [0.052, 0.085, 0.115], r: [0, 0, -0.15 * side], parent: head }));
      mesh(G.sphereMid, hair, { p: [0, 0.02, -hz * 0.88], s: [hx * 0.92, 0.11, 0.06], parent: head });
    } else if (st === 'bald') {
      [-1, 1].forEach((side) => mesh(G.box, hair, { p: [hx * 0.94 * side, 0.02, -0.015], s: [0.016, 0.055, 0.05], parent: head }));
    } else if (st === 'curly-saltpepper' || st === 'wavy-short') {
      const alt = '#9ca3af';
      mesh(G.sphere, hair, { p: [0, 0.06 * hyK, -0.035], s: [hx * 0.96, hy * 0.82, hz * 0.92], parent: head });
      [
        [-0.09, 0.16, 0.05], [0, 0.175, 0.04], [0.09, 0.16, 0.05], [-0.13, 0.11, -0.02], [0.13, 0.11, -0.02],
        [-0.06, 0.17, -0.06], [0.06, 0.17, -0.06], [0, 0.14, -0.12], [-0.14, 0.04, -0.03], [0.14, 0.04, -0.03]
      ].forEach(([x, y, z], idx) => mesh(G.sphereLo, idx % 3 === 0 ? alt : hair, { p: [x * (hx / 0.15), y * hyK, z], s: 0.048, cast: true, parent: head }));
    } else if (st === 'neat-side' || st === 'side') {
      sideBackCrown(hair, 0.95, -0.022);
      mesh(G.sphereMid, hair, { p: [-0.045, 0.152 * hyK, 0.045], s: [0.105, 0.038, 0.095], r: [0.18, 0, 0.22], parent: head });
      mesh(G.sphereMid, hair, { p: [0.075, 0.142 * hyK, 0.04], s: [0.075, 0.032, 0.085], r: [0.18, 0, -0.22], parent: head });
      mesh(G.box, skinM, { p: [0.035, 0.175 * hyK, 0.05], s: [0.007, 0.015, 0.07], parent: head });
    } else if (st === 'luxun-crew' || st === 'crew') {
      mesh(G.sphere, hair, { p: [0, 0.045 * hyK, -0.04], s: [hx * 0.95, hy * 0.85, hz * 0.88], parent: head });
      mesh(G.box, hair, { p: [0, 0.175 * hyK, 0.005], s: [hx * 1.48, 0.085, hz * 1.38], cast: true, parent: head });
      mesh(G.box, hair, { p: [0, 0.13 * hyK, -0.08], s: [hx * 1.42, 0.12, 0.08], parent: head });
    } else if (st === 'nietzsche-swept' || st === 'swept') {
      mesh(G.sphere, hair, { p: [0, 0.055 * hyK, -0.045], s: [hx * 1.04, hy * 0.94, hz * 1.02], cast: true, parent: head });
      mesh(G.sphereMid, hair, { p: [0, 0.165 * hyK, -0.03], s: [hx * 0.95, 0.068, hz * 0.95], r: [-0.32, 0, 0], cast: true, parent: head });
      [-1, 1].forEach((side) => mesh(G.sphereMid, hair, { p: [hx * 0.88 * side, 0.05, -0.035], s: [0.045, 0.095, 0.095], parent: head }));
    } else if (st === 'topknot') {
      sideBackCrown(hair, 0.94, -0.025);
      mesh(G.sphereMid, hair, { p: [0, 0.21 * hyK, -0.02], s: 0.058, cast: true, parent: head });
    } else if (st === 'receding-side') {
      mesh(G.sphere, hair, { p: [0, 0.048 * hyK, -0.04], s: [hx * 0.98, hy * 0.88, hz * 0.92], parent: head });
      mesh(G.sphereMid, hair, { p: [0.015, 0.168 * hyK, 0.008], s: [hx * 0.78, 0.052, hz * 0.72], r: [0.08, 0, -0.14], cast: true, parent: head });
      [-1, 1].forEach((side) => mesh(G.box, hair, { p: [hx * 0.92 * side, 0.025, -0.02], s: [0.024, 0.08, 0.075], parent: head }));
    } else if (st === 'short-spiky') {
      // Zhang Yiming: fluffy slightly-spiky short hair with high forehead
      mesh(G.sphere, hair, { p: [0, 0.06 * hyK, -0.032], s: [hx * 0.98, hy * 0.86, hz * 0.92], parent: head });
      [[-0.06, 0.175, 0.02], [0, 0.186, 0.025], [0.06, 0.175, 0.02], [-0.04, 0.178, -0.03], [0.04, 0.178, -0.03]].forEach(([x, y, z]) =>
        mesh(G.sphereLo, hair, { p: [x * (hx / 0.17), y * hyK, z], s: [0.048, 0.036, 0.048], cast: true, parent: head }));
    }

    // Scholar-hat (Confucius dark blue cloth cap with long side ribbons)
    if (L.accessory === 'scholar-hat') {
      mesh(G.box, accent, { p: [0, 0.225 * hyK, -0.015], s: [0.125, 0.072, 0.145], r: [-0.08, 0, 0], cast: true, parent: head });
      mesh(G.box, accent, { p: [0, 0.19 * hyK, -0.01], s: [0.22, 0.028, 0.08], parent: head });
      [-1, 1].forEach((side) => {
        mesh(G.box, accent, { p: [0.115 * side, 0.08, -0.13], s: [0.026, 0.18, 0.016], r: [0.15, 0, 0.12 * side], parent: head });
        mesh(G.box, accent, { p: [0.135 * side, -0.18, 0.04], s: [0.022, 0.24, 0.012], r: [-0.1, 0, -0.06 * side], parent: head });
      });
    }

    // 7. Facial Hair / Beards (beardG; thin moustache/goatee/stubble styles are hidden when the photo face shows them)
    if (L.beard === 'full') {
      [[-0.07, -0.12, 0.11], [0.07, -0.12, 0.11], [-0.04, -0.175, 0.105], [0.04, -0.175, 0.105], [0, -0.2, 0.11], [0, -0.135, 0.125]].forEach(([x, y, z]) =>
        mesh(G.sphereLo, bc, { p: [x, y, z], s: [0.068, 0.065, 0.06], cast: true, parent: beardG }));
      [-1, 1].forEach((side) => mesh(G.sphereLo, bc, { p: [0.048 * side, -0.068, onSculptHead(0.04, -0.068) + 0.016], s: [0.056, 0.028, 0.028], r: [0, 0, 0.35 * side], parent: beardG }));
    } else if (L.beard === 'long') {
      mesh(G.cone, bc, { p: [0, -0.26, 0.115], s: [0.105, 0.29, 0.055], r: [Math.PI, 0, 0], cast: true, parent: beardG });
      mesh(G.sphereLo, bc, { p: [0, -0.12, 0.12], s: [0.115, 0.055, 0.06], parent: beardG });
      [-1, 1].forEach((side) => {
        mesh(G.sphereLo, bc, { p: [0.05 * side, -0.068, onSculptHead(0.04, -0.068) + 0.018], s: [0.055, 0.024, 0.024], r: [0, 0, 0.42 * side], parent: beardG });
        mesh(G.cone, bc, { p: [0.095 * side, -0.17, 0.105], s: [0.03, 0.16, 0.028], r: [Math.PI, 0, -0.14 * side], parent: beardG });
      });
    } else if (L.beard === 'short') {
      mesh(G.sphereMid, bc, { p: [0, -0.115, 0.065], s: [hx * 0.88, 0.085, hz * 0.82], parent: beardG });
      [-1, 1].forEach((side) => mesh(G.sphereLo, '#363230', { p: [0.036 * side, -0.066, onSculptHead(0.035, -0.066) + 0.012], s: [0.042, 0.016, 0.018], r: [0, 0, 0.2 * side], parent: beardG }));
    } else if (L.beard === 'goatee') {
      mesh(G.cone, bc, { p: [0, -0.145, 0.115], s: [0.055, 0.095, 0.045], r: [Math.PI, 0, 0], cast: true, parent: beardG });
      [-1, 1].forEach((side) => mesh(G.box, bc, { p: [0.028 * side, -0.065, onSculptHead(0.028, -0.065) + 0.014], s: [0.048, 0.018, 0.018], r: [0, 0, 0.18 * side], parent: beardG }));
    } else if (L.beard === 'stubble') {
      // Jobs: fitted grey-white jaw/chin beard + subtle mustache around mouth
      mesh(G.sphereMid, bc, { p: [0, -0.128, 0.052], s: [hx * 0.74, 0.058, hz * 0.72], parent: beardG });
      [-1, 1].forEach((side) => mesh(G.box, bc, { p: [0.025 * side, -0.068, onSculptHead(0.025, -0.068) + 0.008], s: [0.038, 0.011, 0.01], r: [0, 0, 0.15 * side], parent: beardG }));
    } else if (L.beard === 'light-stubble') {
      mesh(G.sphereMid, std(L.beard_color || hairCol, { ...MAT.hair, transparent: true, opacity: 0.18 }), { p: [0, -0.095, 0.036], s: [hx * 0.94, 0.09, hz * 0.88], parent: beardG });
    } else if (L.beard === 'mustache') {
      [-1, 1].forEach((side) => mesh(G.box, bc, { p: [0.032 * side, -0.058, onSculptHead(0.028, -0.058) + 0.016], s: [0.058, 0.022, 0.022], r: [0, 0, 0.12 * side], parent: beardG }));
    } else if (L.beard === 'walrus') {
      [-1, 1].forEach((side) => mesh(G.sphereMid, bc, { p: [0.044 * side, -0.082, onSculptHead(0.03, -0.068) + 0.024], s: [0.072, 0.048, 0.042], r: [0, 0, 0.45 * side], cast: true, parent: beardG }));
      mesh(G.sphereMid, bc, { p: [0, -0.07, onSculptHead(0, -0.07) + 0.028], s: [0.045, 0.032, 0.03], parent: beardG });
    }
    if (L.accessory === 'pipe') {
      const pz = onSculptHead(0.04, my) + 0.02;
      mesh(G.cyl, '#5a3a22', { p: [0.052, my - 0.01, pz + 0.03], s: [0.007, 0.085, 0.007], r: [Math.PI / 2, 0, 0.3], parent: head });
      mesh(G.cyl, '#4a2e18', { p: [0.08, my + 0.005, pz + 0.072], s: [0.018, 0.034, 0.018], parent: head });
    }

    // 8. Glasses (distinct rimless round / thick elderly / rect dark / rect-thin silver)
    if (L.glasses) {
      const thick = L.glasses === 'thick', round = L.glasses === 'round', thin = L.glasses === 'rect-thin';
      const frame = round ? '#64748b' : thin ? '#64748b' : thick ? '#231f20' : '#18181b';
      const gz = onSculptHead(ex, ey) + 0.026;
      const lensMat = toon('#e2e8f0', { transparent: true, opacity: 0.22 });
      [-1, 1].forEach((side) => {
        const x = ex * side;
        if (round) {
          mesh(G.torusThin, frame, { p: [x, ey, gz], s: [0.041, 0.041, 0.06], parent: head });
          mesh(G.disc, lensMat, { p: [x, ey, gz - 0.002], s: 0.039, parent: head });
        } else if (thin) {
          mesh(G.box, frame, { p: [x, ey + 0.018, gz], s: [0.078, 0.005, 0.008], parent: head });
          mesh(G.box, frame, { p: [x + 0.038 * side, ey + 0.003, gz], s: [0.004, 0.032, 0.008], parent: head });
          mesh(G.box, lensMat, { p: [x, ey + 0.001, gz - 0.002], s: [0.074, 0.034, 0.003], parent: head });
        } else {
          const geo = thick ? G.torusSq : G.torusSqThin;
          mesh(geo, frame, { p: [x, ey, gz], s: [thick ? 0.056 : 0.052, thick ? 0.046 : 0.036, thick ? 0.075 : 0.045], r: [0, 0, Math.PI / 4], parent: head });
        }
        mesh(G.box, frame, { p: [hx * 0.72 * side, ey + 0.006, gz - 0.075], s: [0.005, 0.006, 0.145], parent: head });
      });
      mesh(G.box, frame, { p: [0, ey + (thin ? 0.015 : 0.008), onSculptHead(0, ey) + 0.024], s: [0.042, thick ? 0.01 : 0.006, 0.008], parent: head });
    }

    // Merge static meshes sharing materials on head & body to cut draw calls cleanly
    mergeStaticGroup(head, headSkip);
    mergeStaticGroup(faceFeat, headSkip);
    mergeStaticGroup(beardG);
    mergeStaticGroup(body, bodySkip);
    // limbs: merge inside every joint group (shoulder / elbow / hip / knee) — keeps the rig, cuts draw calls
    for (const j of [...this.arms, ...this.arms.map((a) => a.children.find((c) => c.isGroup)), ...this.legs, ...this.knees]) if (j) mergeStaticGroup(j);

    this.isAdultFigure = true;
    this.propeller = null;
    this.headScale = headScale;
    this.sitYOffset = 0.46 - hipY * hScale;
    R.updateMatrixWorld(true);
    const localBox = new THREE.Box3().setFromObject(R);
    const rx = Math.max(Math.abs(localBox.min.x), Math.abs(localBox.max.x));
    const rz = Math.max(Math.abs(localBox.min.z), Math.abs(localBox.max.z));
    this.radius = Math.max(0.28, Math.hypot(rx, rz));
    this.topOffset = localBox.max.y;
    this.R = R;
    return { main: new THREE.Color(this.color), light: mainLight };
  }
}

// Per-persona 3D look corrections. Kept here (not in assets/personas.json, which build_personas.py generates and other
// code reads). Only shape cues the photo face cannot carry: silhouette (hair mass), build, outfit colour.
const LOOK_OVERRIDES = {
  // 峰哥 — reference assets/avatars/photo/fengge.jpg: big wild shoulder-length curly mop well outside the face outline,
  // stocky, coral running tee (moustache + chin beard come from the photo face itself).
  fengge: { hair_style: 'shaggy-wild', hair: '#171312', outfit_color: '#e0644f', build: 1.14, belly: 1.06, neck_scale: 1.12 },
};
function neutralAdultLook(role, rng, hue) {
  const side = role?.side || role?.role || '';
  if (side === 'judge') {
    return {
      outfit: 'suit', outfit_color: '#2b3452', inner_color: '#eef2f9', accent: '#7aa2f7', tie_color: '#4f6ab8',
      pants_color: '#1d2233', skin: '#d8b494', hair: '#232630', hair_style: 'neat-side',
      height: 1.0, build: 0.98, face: { shape: 'oval', jaw: 0.96, eyeSize: 0.96 },
    };
  }
  if (side === 'chair' || role?.role === 'chair' || role?.role === 'host') {
    return {
      outfit: 'jacket', outfit_color: '#464e5c', inner_color: '#f2f4f7', accent: '#c9a13b',
      pants_color: '#262b34', skin: '#deb896', hair: '#28221e', hair_style: 'short',
      height: 0.98, build: 0.96, accessory: 'glasses', face: { shape: 'oval', jaw: 0.94, eyeSize: 0.96 },
    };
  }
  const skins = ['#ebd0b6', '#dfb895', '#d3a883', '#e5c1a0'];
  const hairs = ['#1e1916', '#2f2620', '#45372d', '#2b2e36'];
  const hairStyles = ['neat-side', 'short', 'wavy-short', 'receding-side'];
  const suitCol = new THREE.Color().setHSL(hue, 0.36, 0.34).getStyle();
  const accentCol = new THREE.Color().setHSL(hue, 0.42, 0.56).getStyle();
  const outfit = chance(rng, 0.55) ? 'suit' : 'jacket';
  return {
    outfit,
    outfit_color: suitCol,
    inner_color: '#eff2f6',
    accent: accentCol,
    tie_color: outfit === 'suit' ? accentCol : undefined,
    pants_color: '#21252e',
    skin: pick(rng, skins),
    hair: pick(rng, hairs),
    hair_style: pick(rng, hairStyles),
    accessory: chance(rng, 0.25) ? 'glasses' : undefined,
    height: rand(rng, 0.96, 1.02),
    build: rand(rng, 0.94, 1.04),
    face: { shape: chance(rng, 0.35) ? 'square' : 'oval', jaw: rand(rng, 0.92, 1.02), eyeSize: rand(rng, 0.92, 1.0) },
  };
}
function resolveLook(id, look) {
  const o = look && id ? LOOK_OVERRIDES[id] : null;
  if (!o) return look;
  return { ...look, ...o, face: { ...(look.face || {}), ...(o.face || {}) } };
}
export function buildPersonaFigure(personaOrLook, sceneOrGroup, opts = {}) {
  const L = resolveLook(personaOrLook.id, personaOrLook.look || personaOrLook);
  const role = personaOrLook.look ? { persona_id: personaOrLook.id, avatar: personaOrLook.avatar, name: personaOrLook.name, look: L } : null;
  const b = new Bot(personaOrLook.id || 'preview', sceneOrGroup);
  const res = b.buildPersona(L, role, opts);
  return { bot: b, ...res };
}

// ---------------------------------------------------------------- Gemini judge: restrained four-point crest above the head
function sparkleGeometry() {
  const sh = new THREE.Shape();
  const R = 0.10, r = 0.025;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, rad = i % 2 === 0 ? R : r;
    const x = Math.sin(a) * rad, y = Math.cos(a) * rad;
    i === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2 });
}
function addGeminiStar(b) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8fb5f8, emissive: 0x4539b8, emissiveIntensity: 0.42, roughness: 0.45, metalness: 0.15 });
  const star = new THREE.Mesh(sparkleGeometry(), mat); star.position.z = -0.011; g.add(star);
  const small = new THREE.Mesh(sparkleGeometry(), new THREE.MeshStandardMaterial({ color: 0xc59bf5, emissive: 0x6b2ec4, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.15 }));
  small.scale.setScalar(0.42); small.position.set(0.12, 0.08, 0); g.add(small);
  g.position.set(0, 0.312, 0);
  b.head.add(g);
  b.sparkle = g;
  b.root.updateMatrixWorld(true);
  const starBox = new THREE.Box3().setFromObject(b.root);
  const sy = b.root.scale.y || 1;
  b.topOffset = Math.max(b.topOffset ?? 0, (starBox.max.y - b.root.position.y) / sy);
  g.position.set(0, 0.30, 0);
}

// ---------------------------------------------------------------- contact shadow (one shared radial-gradient texture)
let contactTex = null;
function contactShadowMaterial() {
  if (!contactTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    contactTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, toneMapped: false, fog: false });
}
const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ---------------------------------------------------------------- procedural studio environment (PBR reflections; no downloads)
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const top = new THREE.Color(0xe9edf3), mid = new THREE.Color(0x8d939c), bot = new THREE.Color(0x2b2f36);
  const pos = geo.getAttribute('position'), cols = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 10;
    if (t >= 0) c.copy(mid).lerp(top, Math.pow(t, 0.7)); else c.copy(mid).lerp(bot, Math.pow(-t, 0.6));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  env.add(sky);
  const box = new THREE.PlaneGeometry(1, 1);
  const lightMat = (k, hex = 0xffffff) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide });
  for (const [p, sc, k, hex] of [[[5, 7, 5], [6, 3], 5, 0xfff3e2], [[-6, 4, 3], [4, 3], 2.2, 0xdbe6ff], [[0, 5, -8], [8, 2], 2.6, 0xe8eeff]]) {
    const m = new THREE.Mesh(box, lightMat(k, hex)); m.position.set(...p); m.scale.set(sc[0], sc[1], 1); m.lookAt(0, 0, 0); env.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.04);
  pm.dispose(); geo.dispose(); box.dispose(); sky.material.dispose();
  env.traverse((o) => o.material?.dispose?.());
  return rt.texture;
}

// ---------------------------------------------------------------- stage
const NDC_BOUNDS = { minX: -0.9, maxX: 0.9, minY: -0.92, maxY: 0.8 };
export function createStage(container, overlayRoot, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: IS_MOBILE ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const DPR_STEPS = [2, 1.5, 1.25, 1];
  let pixelRatio = clamp(devicePixelRatio || 1, 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = !IS_MOBILE;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'stage-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  try { scene.environment = makeEnvironment(renderer); } catch { scene.environment = null; }
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 140);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.rotateSpeed = IS_MOBILE ? 0.6 : 0.8;
  // sane wide default before the first fit (never a close-up on the lectern)
  camera.position.set(0, 8, 24); controls.target.set(0, 1.1, -1.4); controls.update();
  // Compact stages (coarse pointer, or stage < 1024 px matching CSS mobile/tablet breakpoint):
  // Default camera control is locked (camControl=false, controls.enabled=false) with canvas touchAction='none'
  // (NOT global) so mobile UAs do not fire pointercancel on vertical drag over the non-pane-descendant canvas;
  // vertical drags forward cleanly via opts.onScroll while taps still pick figures. Clicking #camToggle enables full OrbitControls.
  let lastW = 0, lastH = 0;
  let compactInput = null;
  let userCamOverride = null;   // null = follow viewport compact rule, boolean = explicit #camToggle choice
  let camControl = true;
  let downAt = null;
  const drag = { id: null, y0: 0, y: 0, t: 0, v: 0, on: false, pts: new Set(), fling: 0 };
  const scrollBy = (dy) => { if (dy) opts.onScroll?.(dy); };

  function syncInputMode(notify = false) {
    const coarse = matchMedia('(pointer: coarse)').matches || IS_COARSE;
    const vw = window.innerWidth || lastW;
    const compact = coarse || (vw > 0 && vw < 1024);
    compactInput = compact;
    const nextCam = userCamOverride !== null ? userCamOverride : !compact;
    const changed = nextCam !== camControl;
    camControl = nextCam;
    if (camControl) {
      drag.id = null; drag.on = false; cancelAnimationFrame(drag.fling);
      controls.enabled = true;
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
      renderer.domElement.style.touchAction = 'none';
    } else {
      controls.enabled = false;
      controls.enableRotate = false;
      controls.enableZoom = false;
      controls.touches = { ONE: null, TWO: null };
      controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
      renderer.domElement.style.touchAction = 'none';
    }
    if (notify || changed) opts.onCamControlChange?.(camControl);
  }
  function applyInputMode() { syncInputMode(false); }
  function setCameraControl(on) {
    userCamOverride = !!on;
    syncInputMode(true);
    return camControl;
  }
  syncInputMode(true);

  function onDragDown(e) {
    drag.pts.add(e.pointerId);
    cancelAnimationFrame(drag.fling);
    if (drag.pts.size === 1) downAt = [e.clientX, e.clientY];
    else downAt = null;
    if (camControl) { drag.id = null; drag.on = false; return; }
    if (drag.pts.size !== 1) {
      drag.id = null; drag.on = false; downAt = null;
      return;
    }
    drag.id = e.pointerId; drag.y0 = drag.y = e.clientY; drag.t = performance.now(); drag.v = 0; drag.on = false;
  }
  function onDragMove(e) {
    if (camControl || drag.id !== e.pointerId || drag.pts.size !== 1) return;
    if (!drag.on && Math.abs(e.clientY - drag.y0) > 6) { drag.on = true; downAt = null; }
    if (!drag.on) return;
    const now = performance.now(), dy = drag.y - e.clientY, dt = Math.max(1, now - drag.t);
    drag.v = 0.8 * (dy / dt) + 0.2 * drag.v; drag.y = e.clientY; drag.t = now;
    scrollBy(dy);
    e.stopPropagation();
  }
  function onDragUp(e) {
    drag.pts.delete(e.pointerId);
    if (drag.id !== e.pointerId) return;
    const wasDrag = drag.on;
    const flingV = wasDrag && e.type === 'pointerup' && e.pointerType !== 'mouse' ? drag.v : 0;
    drag.id = null; drag.on = false;
    if (e.type === 'pointercancel') { downAt = null; return; }
    if (wasDrag && !camControl) { downAt = null; e.stopPropagation(); }
    if (!camControl && Math.abs(flingV) > 0.15) {
      let v = flingV * 16, last = performance.now();
      const step = (t) => { if (camControl) return; const k = Math.min(3, (t - last) / 16); last = t; scrollBy(v * k); v *= Math.pow(0.95, k); if (Math.abs(v) > 0.5) drag.fling = requestAnimationFrame(step); };
      drag.fling = requestAnimationFrame(step);
    }
  }
  function onStageWheel(e) {
    if (camControl || !compactInput) return;
    e.preventDefault(); e.stopPropagation();
    scrollBy(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
  }
  for (const el of [container, overlayRoot]) {
    el.addEventListener('pointerdown', onDragDown, true);
    el.addEventListener('pointermove', onDragMove, true);
    el.addEventListener('pointerup', onDragUp, true);
    el.addEventListener('pointercancel', onDragUp, true);
    el.addEventListener('wheel', onStageWheel, { capture: true, passive: false });
  }

  const hemi = new THREE.HemisphereLight(0xe3ebf6, 0x3a3631, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0de, 2.4);   // key
  sun.position.set(5, 11, 7); sun.castShadow = !IS_MOBILE;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8.5, right: 8.5, top: 8.5, bottom: -8.5, near: 2, far: 34 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xc6d6ff, 1.4);   // back/rim light separates figures from the dark hall
  rim.position.set(-4, 7, -9); scene.add(rim);

  let world = new THREE.Group(); scene.add(world);
  // speaker spotlight (scene-level, survives layout changes)
  const focusSpot = new THREE.SpotLight(0xfff3d6, 0, 18, 0.3, 0.6, 2);
  focusSpot.castShadow = false; scene.add(focusSpot, focusSpot.target);
  const light0 = { hemi: 0.8, sun: 2.4, rim: 1.4, env: 0.4, spot: 60 };
  const cam = { userUntil: 0, goal: null, fit: null, needFit: 0, narrow: null };
  let layout = null;          // {mode, obstacles, homes, ...}
  let bots = new Map();       // id -> Bot
  let overlay = new Map();    // id -> {anchor, tag, think, bubble}
  let frame = {};             // last frame from app
  let board = null;           // debate timer board / roundtable holo
  let sceneKey = '';
  let presentedKey = '';
  let expectedBots = 0;
  let buildErrors = [];
  let celebrate = null;       // {winner, t0}
  const stats = { fps: 0 };

  // ------------------------------------------------ layouts
  function clearWorld() {
    scene.remove(world);
    world.traverse((o) => { if (o.geometry && !G_SET.has(o.geometry) && o.geometry !== contactGeo) o.geometry.dispose?.(); });
    world = new THREE.Group(); scene.add(world);
    for (const b of bots.values()) {
      b.root.traverse((o) => { if (o.geometry && !G_SET.has(o.geometry)) o.geometry.dispose?.(); });
      scene.remove(b.root);
      if (b.paddle) { scene.remove(b.paddle); b.paddle.material.dispose(); }
      if (b.contact) { scene.remove(b.contact); b.contact.material.dispose(); }
    }
    bots = new Map();
    overlayRoot.innerHTML = '';
    overlay = new Map();
  }

  function holoBoard(w, h, pos, scale) {
    const tex = canvasTex(w, h);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.t, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    sp.scale.set(...scale); sp.position.set(...pos); sp.renderOrder = 2;
    world.add(sp);
    return { ...tex, sprite: sp, key: '' };
  }

  function buildRoundtable(roles) {
    const BG = 0xe4e7e2;
    scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 20, 46);
    const n = roles.length;
    const TABLE_R = n > 7 ? 2.2 : 1.8, TABLE_TOP = 0.6, SEAT_R = TABLE_R + 1.35;
    const ang = (i) => (i / n) * Math.PI * 2 + Math.PI / n;
    const ring = (i, r) => new THREE.Vector2(Math.sin(ang(i)) * r, Math.cos(ang(i)) * r);
    const wood = std(0x9a6a43, MAT.wood), woodDark = std(0x6f4a30, MAT.wood), brass = std(0xa8842c, MAT.brass);
    mesh(new THREE.CircleGeometry(60, 64), std(0xd6d9d2, { roughness: 0.9 }), { r: [-Math.PI / 2, 0, 0], recv: true, parent: world });
    mesh(new THREE.CircleGeometry(SEAT_R + 1.85, 96), std(0xc8ccc4, { roughness: 0.95 }), { r: [-Math.PI / 2, 0, 0], p: [0, 0.005, 0], recv: true, parent: world });
    mesh(new THREE.RingGeometry(SEAT_R + 1.32, SEAT_R + 1.4, 96), brass, { r: [-Math.PI / 2, 0, 0], p: [0, 0.01, 0], recv: true, parent: world });
    const table = new THREE.Group(); world.add(table);
    mesh(G.cyl, wood, { p: [0, TABLE_TOP - 0.06, 0], s: [TABLE_R, 0.12, TABLE_R], cast: true, recv: true, parent: table });
    mesh(G.torus, woodDark, { p: [0, TABLE_TOP - 0.05, 0], s: [TABLE_R, TABLE_R, 0.55], r: [Math.PI / 2, 0, 0], cast: true, parent: table });
    mesh(G.cyl, std(0x3f5a52, { roughness: 0.95 }), { p: [0, TABLE_TOP + 0.003, 0], s: [TABLE_R - 0.3, 0.01, TABLE_R - 0.3], recv: true, parent: table });
    mesh(G.cyl, woodDark, { p: [0, TABLE_TOP / 2 - 0.05, 0], s: [0.38, TABLE_TOP - 0.1, 0.38], cast: true, parent: table });
    mesh(G.cyl, woodDark, { p: [0, 0.04, 0], s: [0.9, 0.08, 0.9], cast: true, recv: true, parent: table });
    const homes = new Map(), facings = new Map(), stands = new Map(), cushions = new Map();
    const obstacles = [{ x: 0, z: 0, r: TABLE_R + 0.25, big: true }];
    roles.forEach((r, i) => {
      const p = ring(i, SEAT_R);
      const c = new THREE.Group(); c.position.set(p.x, 0, p.y); c.rotation.y = ang(i) + Math.PI; world.add(c);
      const cushion = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      mesh(G.cyl, woodDark, { p: [0, 0.17, 0], s: [0.06, 0.34, 0.06], cast: true, parent: c });
      mesh(G.cyl, woodDark, { p: [0, 0.02, 0], s: [0.26, 0.04, 0.26], parent: c });
      mesh(G.cyl, wood, { p: [0, 0.33, 0], s: [0.34, 0.05, 0.34], cast: true, parent: c });
      mesh(G.cyl, cushion, { p: [0, 0.37, 0], s: [0.3, 0.05, 0.3], cast: true, recv: true, parent: c });
      mesh(G.rbox, wood, { p: [0, 0.68, -0.31], s: [0.56, 0.5, 0.07], r: [-0.12, 0, 0], cast: true, parent: c });
      mesh(G.rbox, cushion, { p: [0, 0.69, -0.27], s: [0.46, 0.38, 0.03], r: [-0.12, 0, 0], parent: c });
      cushions.set(r.id, cushion);
      homes.set(r.id, p); facings.set(r.id, ang(i) + Math.PI);
      stands.set(r.id, ring(i, TABLE_R + 0.6));
      // chair backrest is the obstacle (the seat itself is where the bot sits)
      const back = ring(i, SEAT_R + 0.32);
      obstacles.push({ x: back.x, z: back.y, r: 0.36, owner: r.id });
      const pp = ring(i, TABLE_R - 0.6);
      mesh(G.box, std(0xf7f8f5, { roughness: 0.95 }), { p: [pp.x, TABLE_TOP + 0.012, pp.y], s: [0.3, 0.005, 0.4], r: [0, ang(i), 0], recv: true, parent: world });
    });
    // plants
    [[-7, -4, 1.2], [7, -3.6, 1], [-6, 6, 0.9], [6.5, 5.5, 1.3]].forEach(([x, z, k]) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(k); world.add(g);
      mesh(G.cyl, std(0xb0715a, { roughness: 0.8 }), { p: [0, 0.25, 0], s: [0.32, 0.5, 0.32], cast: true, parent: g });
      [[0, 0.95, 0, 0.45], [0.25, 0.8, 0.1, 0.33], [-0.22, 0.85, -0.1, 0.35]].forEach(([a, b, c, r], i) =>
        mesh(G.sphereMid, std(i % 2 ? 0x5e8c6a : 0x4f7e5e, { roughness: 0.85 }), { p: [a, b, c], s: r, cast: true, parent: g }));
    });
    mergeStaticGroup(world, null, true);
    board = holoBoard(512, 256, [0, 2.9, 0], [2.4, 1.2, 1]);
    controls.target.set(0, 0.9, 0);
    controls.minDistance = 4; controls.maxDistance = 30; controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.36;
    controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.3;
    Object.assign(light0, { hemi: 1.0, sun: 2.3, rim: 0.7, env: 0.55, spot: 34 });
    return { mode: 'roundtable', homes, facings, stands, cushions, obstacles, center: new THREE.Vector2(0, 0),
             radius: SEAT_R + 1.4, tableR: TABLE_R, seatR: SEAT_R, sitAtHome: true, ringPoint: (a, r) => new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r) };
  }

  function buildDebate(roles, spread = 1) {
    const BG = 0x1b2028;
    scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 24, 48);
    const stone = std(0x3b424c, MAT.stone), stoneLight = std(0x48505b, MAT.stone);
    const wood = std(0x6b4630, MAT.wood), woodDark = std(0x452e21, MAT.wood), woodTop = std(0x86593a, MAT.wood);
    const brass = std(0xa8842c, MAT.brass);
    mesh(new THREE.PlaneGeometry(80, 80), std(0x1f252d, { roughness: 0.95 }), { r: [-Math.PI / 2, 0, 0], recv: true, parent: world });
    // stage floor (graphite stone platform with a lighter inlay) + runner with brass edges
    mesh(G.rbox, stone, { p: [0, 0.06, -0.8], s: [13, 0.12, 8.6], recv: true, cast: true, parent: world });
    mesh(G.box, stoneLight, { p: [0, 0.122, -0.8], s: [12.4, 0.01, 8.0], recv: true, parent: world });
    mesh(G.box, std(0x262c35, { roughness: 0.92 }), { p: [0, 0.13, 0.6], s: [2.0, 0.01, 5.6], recv: true, parent: world });
    [-1, 1].forEach((sx) => mesh(G.box, brass, { p: [sx * 1.02, 0.132, 0.6], s: [0.04, 0.012, 5.6], parent: world }));
    // back wall + pilasters + banner
    mesh(G.box, std(0x2a313b, MAT.stone), { p: [0, 2.6, -5.2], s: [13, 5.2, 0.2], recv: true, parent: world });
    [-6.2, -2.0, 2.0, 6.2].forEach((x) => mesh(G.rbox, std(0x323a45, MAT.stone), { p: [x, 2.6, -5.02], s: [0.42, 5.2, 0.22], recv: true, parent: world }));
    const banner = canvasTex(1024, 128);
    banner.g.fillStyle = '#232a33'; banner.g.fillRect(0, 0, 1024, 128);
    banner.g.fillStyle = '#a8842c'; banner.g.fillRect(0, 6, 1024, 3); banner.g.fillRect(0, 119, 1024, 3);
    banner.g.fillStyle = '#d6bb72'; banner.g.font = `800 58px ${FONT}`; banner.g.textAlign = 'center'; banner.g.textBaseline = 'middle';
    banner.g.fillText('AI 辩论厅 · POLICY DEBATE', 512, 66);
    banner.t.needsUpdate = true;
    mesh(new THREE.PlaneGeometry(7, 0.875), new THREE.MeshBasicMaterial({ map: banner.t, toneMapped: false }), { p: [0, 4.6, -5.08], parent: world });
    const Y0 = 0.13;
    const homes = new Map(), facings = new Map(), stands = new Map(), cushions = new Map();
    const obstacles = [];
    const fitPts = [];
    const blockerBoxes = [];
    // podiums: aff (blue) left, neg (red) right
    const podium = (x, z, color, side) => {
      const g = new THREE.Group(); g.position.set(x, Y0, z); g.rotation.y = side === 'aff' ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35; world.add(g);
      mesh(G.rbox, woodDark, { p: [0, 0.5, 0], s: [1.25, 1.0, 0.5], cast: true, recv: true, parent: g });
      mesh(G.rbox, std(color, { roughness: 0.55 }), { p: [0, 0.6, 0.255], s: [1.08, 0.36, 0.03], parent: g });
      mesh(G.box, brass, { p: [0, 0.965, 0.262], s: [1.2, 0.025, 0.02], parent: g });
      mesh(G.rbox, woodTop, { p: [0, 1.02, -0.05], s: [1.35, 0.06, 0.62], cast: true, parent: g });
      for (const dx of [-0.62, 0.62]) for (const dz of [-0.55, 0.55]) {
        fitPts.push([x + dx, Y0, z + dz], [x + dx, Y0 + 1.05, z + dz]);
      }
      blockerBoxes.push({ name: `podium-${side}`, min: [x - 0.62, Y0, z - 0.55], max: [x + 0.62, Y0 + 1.05, z + 0.55], owner: null });
      return g;
    };
    const lecternPos = new THREE.Vector2(0, 0.9);
    // lectern (center, facing audience)
    const lec = new THREE.Group(); lec.position.set(lecternPos.x, Y0, lecternPos.y); world.add(lec);
    mesh(G.rbox, woodDark, { p: [0, 0.55, 0], s: [0.8, 1.1, 0.45], cast: true, recv: true, parent: lec });
    mesh(G.rbox, wood, { p: [0, 1.12, 0.05], s: [0.95, 0.06, 0.6], r: [0.25, 0, 0], cast: true, parent: lec });
    mesh(G.cyl, brass, { p: [0, 0.6, 0.235], s: [0.16, 0.02, 0.16], r: [Math.PI / 2, 0, 0], parent: lec });
    obstacles.push({ x: lecternPos.x, z: lecternPos.y, r: 0.55, big: true });
    blockerBoxes.push({ name: 'lectern', min: [lecternPos.x - 0.48, Y0, lecternPos.y - 0.3], max: [lecternPos.x + 0.48, Y0 + 1.15, lecternPos.y + 0.3], owner: null });
    const sideColor = { aff: 0x2f5bd3, neg: 0xc23a2e };
    const debaters = roles.filter((r) => r.side === 'aff' || r.side === 'neg');
    const slotIdx = { aff: 0, neg: 0 };
    for (const r of debaters) {
      const k = slotIdx[r.side]++;
      const sx = r.side === 'aff' ? -1 : 1;
      const px = sx * (4.0 - k * 0.35) * spread, pz = -2.2 + k * 1.9;
      podium(px, pz, sideColor[r.side], r.side);
      obstacles.push({ x: px, z: pz, r: 0.68, big: true, owner: r.id });
      // stand behind the podium (outer side)
      const toward = new THREE.Vector2(-sx, 0.35).normalize();
      const home = new THREE.Vector2(px - toward.x * 0.95, pz - toward.y * 0.95);
      homes.set(r.id, home);
      facings.set(r.id, Math.atan2(toward.x, toward.y));
    }
    // judge bench (raised) at back center — dark wood + brass
    const bench = new THREE.Group(); bench.position.set(0, Y0, -3.9); world.add(bench);
    mesh(G.rbox, woodDark, { p: [0, 0.3, 0], s: [3.6, 0.6, 1.6], cast: true, recv: true, parent: bench });
    mesh(G.rbox, wood, { p: [0, 1.05, 0.7], s: [3.4, 0.9, 0.18], cast: true, parent: bench });
    mesh(G.box, brass, { p: [0, 1.2, 0.8], s: [1.4, 0.3, 0.02], parent: bench });
    mesh(G.box, brass, { p: [0, 1.5, 0.7], s: [3.42, 0.03, 0.2], parent: bench });
    obstacles.push({ x: 0, z: -3.2, r: 0.4, big: false }, { x: -1.3, z: -3.2, r: 0.4 }, { x: 1.3, z: -3.2, r: 0.4 });
    const gavel = new THREE.Group(); gavel.position.set(0.6, Y0 + 1.53, -3.35); gavel.userData.dynamic = true; world.add(gavel);
    mesh(G.cyl, woodDark, { p: [0, 0, 0], s: [0.07, 0.22, 0.07], r: [0, 0, Math.PI / 2], cast: true, parent: gavel });
    [-0.08, 0.08].forEach((x) => mesh(G.cyl, brass, { p: [x, 0, 0], s: [0.074, 0.025, 0.074], r: [0, 0, Math.PI / 2], parent: gavel }));
    mesh(G.cyl, wood, { p: [0.0, -0.18, 0], s: [0.025, 0.36, 0.025], parent: gavel });
    gavel.userData.base = gavel.rotation.z;
    blockerBoxes.push({ name: 'bench', min: [-1.71, Y0, -3.3], max: [1.71, Y0 + 1.52, -3.1], owner: 'judge' });
    for (const r of roles) {
      if (r.side === 'judge') { homes.set(r.id, new THREE.Vector2(0, -4.1)); facings.set(r.id, 0); }
      if (r.side === 'chair') { homes.set(r.id, new THREE.Vector2(-2.75 * spread, -3.6)); facings.set(r.id, 0.45); }
    }
    // key furniture points for framing (podium tops, bench corners, lectern)
    fitPts.push([0, Y0 + 1.2, lecternPos.y + 0.3], [-1.8, Y0 + 1.5, -3.2], [1.8, Y0 + 1.5, -3.2]);
    // Single timer board on the back wall (schedule lives in #phasebar)
    board = holoBoard(640, 360, [0, 3.45, -4.9], [3.1, 1.74, 1]);
    mergeStaticGroup(world, null, true);
    // Soft three-point + bounce lighting (sculpted figurine look, less specular glare)
    const spot = new THREE.SpotLight(0xfff1dc, 16, 16, 0.52, 0.75, 2);
    spot.position.set(0, 7, 3); spot.target.position.set(0, 0, 0.9); world.add(spot, spot.target);
    controls.target.set(0, 1.55, -1.1);
    controls.minDistance = 4; controls.maxDistance = 34; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.4;
    controls.minAzimuthAngle = -0.75; controls.maxAzimuthAngle = 0.75;
    controls.autoRotate = false;
    Object.assign(light0, { hemi: 0.92, sun: 1.85, rim: 0.95, env: 0.48, spot: 38 });
    return { mode: 'debate', homes, facings, stands, cushions, obstacles, lectern: lecternPos, gavel, sideBoard: null, fitPts, blockerBoxes, spread,
             ground: (id) => (roles.find((r) => r.id === id)?.side === 'judge' ? Y0 + 0.6 : Y0), sitAtHome: false };
  }

  // ------------------------------------------------ camera: size, continuous fov, fit-all framing
  const fovFor = (a) => lerp(50, 38, smooth01(0.6, 1.6, a));             // continuous (no hard switch at 0.8)
  const elevFor = (a) => (layout?.mode === 'roundtable' ? lerp(0.66, 0.5, smooth01(0.6, 1.6, a)) : lerp(0.5, 0.3, smooth01(0.6, 1.6, a)));
  function applySize(force) {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) { lastW = 0; lastH = 0; return false; }
    if (!force && Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return false;
    lastW = w; lastH = h;
    applyInputMode();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    return true;
  }
  function fitCamera() { applySize(true); }

  // points that must stay on screen: every bot's feet box, head box and name-tag anchor at every place it can stand
  function framingPoints() {
    const pts = [];
    const W = lastW || 1, H = lastH || 1;
    const box = (x, z, y0, y1, r, xb, yb) => {
      for (const dx of [-r, r]) for (const dz of [-r, r]) { pts.push({ p: [x + dx, y0, z + dz], b: xb }); pts.push({ p: [x + dx, y1, z + dz], b: xb }); }
      if (yb) pts.push({ p: [x, y1 + yb.dy, z], b: yb.b });
    };
    const tagBounds = (b) => {
      const o = overlay.get(b.id);
      const tw = (o?.tagW || 80) / 2 + 6, th = (o?.tagH || 22) + 6;
      const mx = Math.min(NDC_BOUNDS.maxX, 1 - (2 * tw) / W);
      return { minX: -mx, maxX: mx, minY: NDC_BOUNDS.minY, maxY: Math.min(NDC_BOUNDS.maxY, 1 - (2 * th) / H) };
    };
    if (layout.mode === 'roundtable') {
      // rotation-invariant rings (autoRotate keeps working without ever cropping anyone)
      let top = 1.7, tagB = null;
      for (const b of bots.values()) { top = Math.max(top, (b.topOffset ?? 1.5) * b.root.scale.y); const tb = tagBounds(b); if (!tagB || tb.maxX < tagB.maxX) tagB = tb; }
      const R = Math.max(layout.seatR + 0.4, layout.radius + 0.45);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, x = Math.sin(a) * R, z = Math.cos(a) * R;
        pts.push({ p: [x, 0, z], b: NDC_BOUNDS }, { p: [x, top, z], b: NDC_BOUNDS }, { p: [x, top + 0.42, z], b: tagB || NDC_BOUNDS });
      }
      return pts;
    }
    let dTop = 1.7;
    for (const b of bots.values()) if (b.side === 'aff' || b.side === 'neg') dTop = Math.max(dTop, (b.topOffset ?? 1.5) * b.root.scale.y);
    for (const b of bots.values()) {
      const sc = b.root.scale.y, r = (b.radius ?? 0.3) * sc, top = (b.topOffset ?? 1.5) * sc;
      const home = layout.homes.get(b.id) || b.pos;
      const tb = tagBounds(b);
      box(home.x, home.y, b.ground, b.ground + top, r, NDC_BOUNDS, { dy: 0.42 * sc, b: tb });
    }
    // places debaters walk to: lectern + cross-examination spots
    const Y0 = 0.13;
    for (const [x, z] of [[layout.lectern.x, layout.lectern.y - 0.55], [-0.85, -0.55], [0.85, -0.55]]) box(x, z, Y0, Y0 + dTop, 0.3, NDC_BOUNDS, null);
    for (const p of layout.fitPts || []) pts.push({ p, b: NDC_BOUNDS });
    return pts;
  }
  // Exact minimal-distance fit: camera direction fixed (front, elevation by aspect); the target may slide in the image
  // plane, so for a given distance D the feasible slide is an interval per axis; binary-search the smallest feasible D.
  const _v = new THREE.Vector3();
  function solveFit(pts, center, dir, slack = 1) {
    const res = solveCameraFit({
      pts,
      center: [center.x, center.y, center.z],
      dir: [dir.x, dir.y, dir.z],
      fovDeg: camera.fov,
      aspect: camera.aspect,
      slack,
    });
    if (!res) return null;
    return {
      D: res.D,
      iv: res.iv,
      R: new THREE.Vector3(...res.R),
      U: new THREE.Vector3(...res.U),
      dir: new THREE.Vector3(...res.dir),
      center: center.clone(),
      interval: res.interval,
    };
  }
  // safe wide shot of the whole hall, used before/if the exact fit can't be solved — never the close default
  function fallbackFit(snap) {
    const elev = elevFor(camera.aspect || 1);
    const target = layout?.mode === 'roundtable' ? new THREE.Vector3(0, 0.9, 0) : new THREE.Vector3(0, 1.1, -1.4);
    const dist = clamp(18 / Math.max(0.6, Math.min(1.6, camera.aspect || 1)), 12, 34);
    cam.fit = { target, dist, phi: Math.PI / 2 - elev, theta: 0, mode: 'fallback' };
    cam.goal = { target: target.clone(), dist, phi: cam.fit.phi, theta: 0 };
    if (snap) {
      controls.target.copy(target);
      camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(dist, cam.fit.phi, 0));
      camera.lookAt(target); controls.update();
    }
  }
  function frameAll({ snap = true } = {}) {
    if (!layout || !lastW) return;
    if (!bots.size) { fallbackFit(snap); return; }
    const a = camera.aspect || 1;
    const elev = elevFor(a);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const pts = framingPoints();
    let center, fit;
    if (layout.mode === 'roundtable') {
      // target stays on the table axis (autoRotate-safe): search the best target height, no lateral slide
      let best = null;
      for (let h = 0.2; h <= 1.8; h += 0.1) {
        const c = new THREE.Vector3(0, h, 0);
        const f = solveFit(pts, c, dir);
        if (!f) continue;
        // require zero slide: find smallest D whose interval contains (0,0)
        let lo = f.D, hi = 120;
        const ok = (D) => { const iv = f.interval(D); return iv && iv.xl <= 0 && iv.xh >= 0 && iv.yl <= 0 && iv.yh >= 0; };
        if (!ok(hi)) continue;
        if (!ok(lo)) { for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; } } else hi = lo;
        if (!best || hi < best.D) best = { D: hi * 1.03, c };
      }
      if (!best) { fallbackFit(snap); return; }
      cam.fit = { target: best.c.clone(), dist: best.D, phi: Math.PI / 2 - elev, theta: null, mode: 'roundtable' };
    } else {
      center = new THREE.Vector3(0, 1.1, -1.4);
      const desk = !IS_MOBILE && a >= 1.2;
      fit = solveFit(pts, center, dir, desk ? 1.05 : 1.0);
      if (!fit) { fallbackFit(snap); return; }
      const ox = (fit.iv.xl + fit.iv.xh) / 2, oy = (fit.iv.yl + fit.iv.yh) / 2;
      const target = center.clone().addScaledVector(fit.R, ox).addScaledVector(fit.U, oy);
      cam.fit = { target, dist: fit.D, phi: Math.PI / 2 - elev, theta: 0, mode: 'debate', solve: fit, desk, base: { ox, oy } };
    }
    cam.goal = { target: cam.fit.target.clone(), dist: cam.fit.dist, phi: cam.fit.phi, theta: cam.fit.theta };
    controls.maxDistance = Math.max(controls.maxDistance, cam.fit.dist * 1.6);
    if (snap) {
      controls.target.copy(cam.goal.target);
      const theta = cam.goal.theta ?? sphericalOf().theta;
      camera.position.copy(cam.goal.target).add(new THREE.Vector3().setFromSphericalCoords(cam.goal.dist, cam.goal.phi, theta));
      camera.lookAt(controls.target);
      controls.update();
    }
  }
  const _sph = new THREE.Spherical();
  function sphericalOf() { _v.copy(camera.position).sub(controls.target); return _sph.setFromVector3(_v); }
  // desktop only: ≤6 % push toward the speaker, only inside the slack of the fit (all bots provably stay in bounds)
  function speakerGoal(sb) {
    const f = cam.fit;
    if (!f || f.mode !== 'debate' || !f.desk || !sb) return { target: f?.target, dist: f?.dist };
    const s = f.solve;
    const D = Math.max(s.D / 1.05, s.D * 0.94);
    const iv = s.interval(D);
    if (!iv) return { target: f.target, dist: f.dist };
    _v.set(sb.pos.x, sb.ground + 1.0, sb.pos.y).sub(s.center);
    const px = _v.dot(s.R), py = _v.dot(s.U);
    const ox = clamp(lerp(f.base.ox, px, 0.25), iv.xl, iv.xh), oy = clamp(f.base.oy, iv.yl, iv.yh);
    return { target: s.center.clone().addScaledVector(s.R, ox).addScaledVector(s.U, oy), dist: D };
  }
  // narrow screens pull the debate podiums slightly inward; rebuild when the class flips
  const narrowOf = () => (lastW && lastH ? lastW / lastH < 1 : false);
  // podium spread by stage size: portrait stages and phone-width stages (≤ 600 px) pull everyone inward so people read bigger
  const spreadOf = () => (!lastW || !lastH ? 1 : lastW / lastH < 1 ? 0.8 : lastW < 600 ? 0.76 : lastW < 900 ? 0.88 : 1);

  // ------------------------------------------------ overlay helpers
  const put = (el, prop, val) => { const c = el._s || (el._s = {}); if (c[prop] !== val) { c[prop] = val; el.style[prop] = val; } };
  const putVar = (el, name, val) => { const c = el._s || (el._s = {}); if (c[name] !== val) { c[name] = val; el.style.setProperty(name, val); } };
  function avatarFor(r) {
    const P = typeof window !== 'undefined' ? window.__personas : null;
    const path = (r.persona_id && P?.byId?.get(r.persona_id)?.avatar) || (r.persona_id && /\.(jpe?g|png|webp)(\?|$)/i.test(r.avatar || '') ? r.avatar : null);
    if (!path) return null;
    return P?.data?.get(path) || (typeof location !== 'undefined' && location.href ? new URL(path, location.href).href : path);
  }
  const shortName = (n) => { const s = String(n || ''); const i = Math.max(s.lastIndexOf('·'), s.lastIndexOf('・')); return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : s; };

  // ------------------------------------------------ setup
  let lastSetup = null;
  function hasCompleteScene() {
    return !!layout && !!sceneKey && !buildErrors.length && bots.size > 0 && (expectedBots <= 0 || bots.size === expectedBots);
  }
  function setup({ mode, roles, seed }, force = false) {
    const pVer = typeof window !== 'undefined' ? (window.__personas?.version || 0) : 0;
    applySize(false);
    const narrow = mode === 'debate' ? spreadOf() : 1;
    const key = mode + '|' + seed + '|' + pVer + '|' + narrow + '|' + roles.map((r) => r.id + r.name).join(',');
    if (key === sceneKey && !force && layout && !buildErrors.length && bots.size === expectedBots) return;
    sceneKey = key;
    presentedKey = '';
    cam.narrow = narrow;
    const curArgs = { mode, roles, seed };
    lastSetup = curArgs;
    if (typeof window !== 'undefined' && window.__personas?.loaded && !window.__personas.byId?.size) {
      window.__personas.loaded.then(() => { if (lastSetup === curArgs && window.__personas?.byId?.size) setup(curArgs); });
    }
    clearWorld();
    cam.fit = null; cam.goal = null;
    const bodies = roles.filter((r) => mode !== 'debate' || r.side);
    expectedBots = bodies.length;
    buildErrors = [];
    layout = mode === 'debate' ? buildDebate(bodies, narrow) : buildRoundtable(bodies);
    hemi.intensity = light0.hemi; sun.intensity = light0.sun; rim.intensity = light0.rim; scene.environmentIntensity = light0.env;
    const base = mulberry32(hashStr('palette:' + seed));
    const hue0 = base();
    bodies.forEach((r, i) => { try {   // record build failures cleanly so stage.isReady() never reports ready on broken figures
      const b = new Bot(r.id, scene);
      let hue = (hue0 + i / bodies.length + (base() - 0.5) * 0.03 + 1) % 1;
      if (mode === 'debate') {
        if (r.side === 'aff') hue = 0.6 + (base() - 0.5) * 0.06;
        if (r.side === 'neg') hue = 0.01 + (base() - 0.5) * 0.04;
        if (r.side === 'judge') hue = 0.12;
        if (r.side === 'chair') hue = 0.33;
      }
      const livePersona = r.persona_id && typeof window !== 'undefined' ? window.__personas?.byId?.get(r.persona_id) : null;
      const rng = mulberry32(hashStr(seed + '#' + r.id));
      const look = resolveLook(r.persona_id, livePersona?.look || r.look) || neutralAdultLook(r, rng, hue);
      const roleCtx = livePersona ? { ...r, avatar: livePersona.avatar || r.avatar } : r;
      const { main } = b.buildPersona(look, roleCtx);
      b.persona = r.persona_id || null;
      b.color = '#' + main.getHexString();
      b.name = r.name; b.side = r.side;
      if (layout.cushions.get(r.id)) layout.cushions.get(r.id).color.copy(main);
      const home = layout.homes.get(r.id) || new THREE.Vector2();
      b.pos.copy(home); b.goal.copy(home);
      b.facing = layout.facings.get(r.id) || 0;
      b.ground = layout.ground ? layout.ground(r.id) : 0;
      b.sit = layout.sitAtHome ? 1 : 0;
      if (r.side === 'judge') { b.root.scale.setScalar(1.03); addGeminiStar(b); }
      b.contact = new THREE.Mesh(contactGeo, contactShadowMaterial());
      b.contact.renderOrder = 1; scene.add(b.contact);
      // Synchronously establish initial transforms & crown bounds before frameAll / pre-tick audit
      const sitY = b.sit * (b.sitYOffset ?? 0.11);
      b.root.position.set(b.pos.x, b.ground + sitY, b.pos.y);
      b.root.rotation.y = b.facing;
      b.headTopY = b.ground + sitY + (b.topOffset ?? 1.5) * b.root.scale.y;
      b.anchorY = b.headTopY;
      b.contact.position.set(b.pos.x, b.ground + 0.004, b.pos.y);
      bots.set(r.id, b);
      // overlay
      const anchor = document.createElement('div'); anchor.className = 'anchor';
      const tag = document.createElement('button'); tag.className = 'tag'; tag.type = 'button'; tag.style.setProperty('--c', b.color);
      tag.title = r.name;
      const av = avatarFor(r);
      if (av) { const img = document.createElement('img'); img.className = 'tag-av'; img.alt = ''; img.width = 18; img.height = 18; img.decoding = 'async'; img.src = av; tag.append(img); }
      const nm = document.createElement('span'); nm.className = 'tag-n'; nm.textContent = r.name; tag.append(nm);
      const think = document.createElement('div'); think.className = 'think'; think.innerHTML = '<i></i><i></i><i></i>';
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      anchor.append(think, tag);
      overlayRoot.append(anchor, bubble);
      tag.addEventListener('click', (e) => { e.stopPropagation(); opts.onPickBot?.(r.id); });
      bubble.addEventListener('click', (e) => { e.stopPropagation(); opts.onPickMsg?.(bubble._idx, r.id); });
      overlay.set(r.id, { anchor, tag, nm, full: r.name, short: shortName(r.name), think, bubble, key: '', w: 0, h: 0, ox: 0, oy: 0, shown: false, cand: -1, conflict: 0 });
    } catch (e) {
      buildErrors.push({ id: r?.id, error: String(e?.message || e) });
      console.error('[stage] figure build failed', r?.id, e);
    } });
    applySize(true);
    frameAll({ snap: true });
    cam.needFit = 2;            // refit once name tags have been measured
    cam.userUntil = 0;
    celebrate = null;
  }

  // ------------------------------------------------ boards
  function drawRoundBoard(title, sub, good) {
    const k = title + '|' + sub + '|' + good;
    if (!board || board.key === k) return; board.key = k;
    const c = board.g; c.clearRect(0, 0, 512, 256);
    c.beginPath(); c.roundRect(16, 26, 480, 196, 40);
    c.fillStyle = good ? 'rgba(30,142,90,.94)' : 'rgba(28,33,39,.9)'; c.fill();
    c.lineWidth = 6; c.strokeStyle = good ? '#d9ffe9' : '#a8842c'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.font = `800 60px ${FONT}`; c.fillText(title, 256, 104, 440);
    c.font = `700 34px ${FONT}`; c.fillStyle = good ? '#eafff3' : '#d6bb72'; c.fillText(sub, 256, 176, 440);
    board.t.needsUpdate = true;
  }
  function drawTimerBoard(t) {
    const k = JSON.stringify(t);
    if (!board || board.key === k) return; board.key = k;
    const c = board.g; c.clearRect(0, 0, 640, 360);
    c.beginPath(); c.roundRect(10, 10, 620, 340, 26); c.fillStyle = '#12161c'; c.fill();
    c.lineWidth = 6; c.strokeStyle = t.over ? '#c23a2e' : '#a8842c'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#d6bb72'; c.font = `800 40px ${FONT}`; c.fillText(t.label || '计时牌', 320, 62, 580);
    c.fillStyle = t.over ? '#ff6a5c' : t.remain != null && t.remain < 20 ? '#ffb347' : '#eef3ee';
    c.font = `800 130px ${FONT}`;
    c.fillText(t.clock || '--:--', 320, 182);
    c.fillStyle = '#b9c0c9'; c.font = `600 32px ${FONT}`; c.fillText(t.sub || '', 320, 300, 590);
    board.t.needsUpdate = true;
  }
  function drawSideBoard(f) {
    const sb = layout.sideBoard; if (!sb) return;
    const k = JSON.stringify([f.phaseIdx, f.phases?.length, f.verdict?.winner]);
    if (sb.key === k) return; sb.key = k;
    const c = sb.g; c.clearRect(0, 0, 640, 360);
    c.beginPath(); c.roundRect(10, 10, 620, 340, 26); c.fillStyle = '#12161c'; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#3a424d'; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'left';
    const ph = f.phases || [];
    c.font = `800 30px ${FONT}`; c.fillStyle = '#d6bb72'; c.fillText('赛程 · Policy（简化）', 36, 46);
    ph.forEach((p, i) => {
      const y = 92 + i * 31;
      const done = i < f.phaseIdx, cur = i === f.phaseIdx;
      c.fillStyle = cur ? '#ffffff' : done ? '#7d8592' : '#c9cfd6';
      c.font = `${cur ? 800 : 600} 25px ${FONT}`;
      c.fillText(`${done ? '✓' : cur ? '▶' : '·'} ${p.label}`, 40, y, 560);
    });
    if (f.verdict) {
      c.fillStyle = f.verdict.winner === 'aff' ? '#7d9ef0' : '#ef7a6e'; c.font = `900 30px ${FONT}`;
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
    T.headTilt = Math.sin(now * 0.9 + b.numId) * 0.06; T.headNod = 0; T.mouth = 1; T.brow = 0;
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
      mix('aRz', 2.75 + Math.sin(now * 3 + b.numId) * 0.1); mix('aRx', -0.15); mix('aLz', -0.35);
      const v = f.votes.get(b.id);
      if (v === 'disagree') { mix('headTilt', Math.sin(now * 7) * 0.12); T.brow = g; } else mix('headNod', Math.sin(now * 4 + b.numId) * 0.1);
    } else if (role === 'listen') {
      mix('headNod', 0.05 + Math.sin(now * 3.2 + b.numId) * 0.1); mix('aLz', -0.3); mix('aRz', 0.3);
    } else if (role === 'cheer' || role === 'cheer-lite') {
      const k = role === 'cheer' ? 1 : 0.5;
      mix('aLz', -2.6 + Math.sin(now * 9 + b.numId) * 0.25); mix('aRz', 2.6 - Math.sin(now * 9 + b.numId) * 0.25);
      T.mouth = lerp(1, 1.6, g); bounce = Math.abs(Math.sin(now * 4.5 + b.numId)) * 0.3 * g * k;
    } else if (role === 'sad') {
      mix('headNod', 0.35); mix('aLz', -0.05); mix('aRz', 0.05); T.mouth = lerp(1, 0.4, g);
    } else if (role === 'gavel') {
      mix('aRz', 1.4 + Math.max(0, Math.sin(now * 6)) * 0.9); mix('aRx', -0.8);
    }
    if (b.sit > 0.01) {
      T.legL = lerp(T.legL, -1.45 + Math.sin(now * 3 + b.numId) * 0.15, b.sit);
      T.legR = lerp(T.legR, -1.45 - Math.sin(now * 3 + b.numId) * 0.15, b.sit);
      T.aLx = lerp(T.aLx, -0.5, b.sit); T.aRx = lerp(T.aRx, -0.5, b.sit);
    }
    for (const k in T) c[k] = damp(c[k], T[k], 12, dt);
    b.blinkIn -= dt;
    if (b.blinkIn <= 0) { b.blinkT = 0.13; b.blinkIn = Math.random() < 0.2 ? 0.25 : 1.8 + Math.random() * 3.5; }
    b.blinkT -= dt;
    for (const e of b.eyes) e.scale.y = b.blinkT > 0 ? 0.12 : 1;
    const sitY = b.sit * (b.sitYOffset ?? 0.11);
    const bob = Math.abs(Math.sin(b.phase)) * 0.06 * b.walkAmt + bounce + Math.sin(now * 2.2 + b.numId) * 0.008;
    b.root.position.set(b.pos.x, b.ground + sitY + bob, b.pos.y);
    b.root.rotation.y = b.facing;
    b.body.rotation.z = Math.sin(b.phase) * 0.09 * b.walkAmt;
    b.legs[0].rotation.x = c.legL; b.legs[1].rotation.x = c.legR;
    if (b.knees) { b.knees[0].rotation.x = b.sit * 1.35; b.knees[1].rotation.x = b.sit * 1.35; }
    b.arms[0].rotation.set(c.aLx, 0, c.aLz); b.arms[1].rotation.set(c.aRx, 0, c.aRz);
    // head: always turn toward whoever is being looked at — including bots that already voted
    let look = null;
    if (['speak', 'answer', 'ask', 'rebut', 'retract'].includes(role)) look = f.addressId ? bots.get(f.addressId) : null;
    if (faceTo) look = faceTo;
    else if (['listen', 'voted', 'think', 'idle', 'cheer-lite', 'cx-wait'].includes(role)) look = focus;
    if (f.addressId === b.id && focus) look = focus;   // 被点名 → 看向点名者
    let yaw = 0;
    if (look && look !== b) yaw = clamp(wrapAngle(Math.atan2(look.pos.x - b.pos.x, look.pos.y - b.pos.y) - b.facing), -1.2, 1.2);
    else if (role === 'idle') yaw = Math.sin(now * 0.4 + b.numId * 1.7) * 0.5;
    c.headYaw = damp(c.headYaw, yaw, 5, dt);
    b.headPivot.rotation.set(c.headNod, c.headYaw, c.headTilt);
    b.mouth.scale.set(1, c.mouth, 1);
    b.brows[0].rotation.z = -(b.browBase + c.brow * 0.5); b.brows[1].rotation.z = b.browBase + c.brow * 0.5;
    if (b.propeller) b.propeller.rotation.y += dt * (6 + speed * 20);
    if (b.sparkle) { b.sparkle.rotation.y += dt * (role === 'think' ? 3.5 : 0.8); b.sparkle.position.y = 0.30 + Math.sin(now * 2) * 0.012; }
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
      b.paddle.position.set(b.pos.x, b.ground + sitY + (b.topOffset ?? 1.5) * b.root.scale.y + 0.5 + Math.sin(now * 3 + b.numId) * 0.04, b.pos.y).addScaledVector(right, 0.28);
      const k = clamp((b.gBlend - 0.3) / 0.5, 0.05, 1);
      b.paddle.scale.set((IS_MOBILE ? 0.72 : 0.58) * k, (IS_MOBILE ? 0.9 : 0.72) * k, 1);
    } else if (b.paddle) b.paddle.visible = false;
    b.headTopY = b.ground + sitY + (b.topOffset ?? 1.5) * b.root.scale.y;
    b.anchorY = b.ground + b.sit * (b.sitYOffset ?? 0.11) + (b.topOffset ?? 1.5) * b.root.scale.y;   // no bob → steady tags
    if (b.contact) {
      const k = b.root.scale.x * (1 - 0.25 * clamp(bob * 3, 0, 1));
      b.contact.position.set(b.pos.x, b.ground + 0.012, b.pos.y);
      b.contact.scale.set(0.95 * k, 1, 0.8 * k);
      b.contact.rotation.y = b.facing;
    }
  }

  // ------------------------------------------------ overlay (tags, think dots, bubbles with collision avoidance)
  // Integer-pixel transforms, DOM writes only on change, candidate hysteresis (a bubble keeps its slot until a conflict
  // persists ≥ 6 frames). Narrow stages (< 600 px) show at most the main bubble, and none while the live subtitle shows.
  const proj = new THREE.Vector3();
  const placed = [];
  const ovl = { n: 0, res: [], subOn: false, narrow: null };
  function layoutOverlay(dt) {
    const W = lastW, H = lastH;
    const f = frame;
    const narrow = W < 600;
    const compact = narrow || H < 340;
    if (ovl.narrow !== narrow) {    // short names on phones ("正方一辩·特朗普" → "特朗普"; full name stays in title)
      ovl.narrow = narrow;
      for (const o of overlay.values()) { o.nm.textContent = narrow ? o.short : o.full; o.tagW = 0; }
      cam.needFit = Math.max(cam.needFit, 1);
    }
    if (ovl.n++ % 15 === 0) {
      ovl.res = opts.reserved?.() || [];
      const sub = typeof document !== 'undefined' ? document.getElementById('subtitle') : null;
      ovl.subOn = !!sub && !sub.classList.contains('hidden') && sub.getClientRects().length > 0;
    }
    // bubbles: exclude verdict/announce from floating on stage; compact views show at most 1 compact cue when no subtitle/verdict
    let bubbles = (f.bubbles || []).filter((bb) => bots.has(bb.id) && bb.type !== 'verdict' && bb.type !== 'announce');
    if (compact) bubbles = (ovl.subOn || f.verdict) ? [] : bubbles.filter((bb, i) => bb.main || (i === 0 && !bubbles.some((x) => x.main))).slice(0, 1);
    const want = new Map(bubbles.map((bb, i) => [bb.id, { ...bb, prio: i }]));

    const rawPts = [];
    for (const [id, b] of bots) {
      const o = overlay.get(id);
      proj.set(b.pos.x, (b.anchorY ?? b.headTopY) + 0.42 * b.root.scale.y, b.pos.y).project(camera);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
      const x = Math.round((proj.x * 0.5 + 0.5) * W), y = Math.round((-proj.y * 0.5 + 0.5) * H);
      o.think.classList.toggle('on', f.thinkingId === id);
      o.tag.classList.toggle('active', f.speakerId === id || f.thinkingId === id);
      if (!o.tagW && vis) { o.tagW = o.tag.offsetWidth || 70; o.tagH = o.tag.offsetHeight || 20; }
      const score = (f.speakerId === id ? 400 : 0) + (f.thinkingId === id ? 300 : 0) + (want.has(id) ? 200 : 0) + ((f.cxPair || []).includes(id) ? 120 : 0) + (b.side === 'judge' ? 20 : 0) - proj.z;
      rawPts.push({ id, x, y, z: proj.z, vis, o, score });
    }

    // Tag de-crowding: compact view keeps <= 2 focal tags (others via #roleStrip); desktop resolves 2D overlap
    const focalSet = new Set();
    const sortedByPrio = rawPts.filter((p) => p.vis).sort((a, b) => b.score - a.score);
    if (compact) {
      for (const p of sortedByPrio) {
        if (focalSet.size < 2 && (p.score >= 100 || focalSet.size === 0)) focalSet.add(p.id);
      }
      if (focalSet.size === 0 && sortedByPrio[0]) focalSet.add(sortedByPrio[0].id);
    }

    const placedTags = [];
    const pts = [];
    for (const p of sortedByPrio) {
      const { id, o } = p;
      const tw = o.tagW || 70, th = o.tagH || 20;
      const quiet = compact && !focalSet.has(id) && !o.think.classList.contains('on');
      o.tag.classList.toggle('tag-quiet', quiet);
      const bx = clamp(p.x, 4 + tw / 2, Math.max(4 + tw / 2, W - 4 - tw / 2));
      let tx = bx, ty = p.y;
      if (!quiet && !compact) {
        const tagHits = (cx, cy) => placedTags.some((r) => (cx - tw / 2) < r.x + r.w + 4 && (cx + tw / 2 + 4) > r.x && (cy - th) < r.y + r.h + 3 && (cy + 3) > r.y);
        const offsets = [[0, 0], [0, -th - 4], [0, th + 4], [-tw * 0.55, -th - 4], [tw * 0.55, -th - 4], [-tw * 0.7, 0], [tw * 0.7, 0]];
        for (const [dx, dy] of offsets) {
          const cx = clamp(bx + dx, 4 + tw / 2, Math.max(4 + tw / 2, W - 4 - tw / 2));
          const cy = clamp(p.y + dy, th + 4, Math.max(th + 4, H - 4));
          if (!tagHits(cx, cy)) { tx = cx; ty = cy; break; }
        }
        placedTags.push({ x: tx - tw / 2, y: ty - th, w: tw, h: th });
      }
      const shift = Math.round(tx - p.x);
      put(o.anchor, 'transform', `translate3d(${Math.round(p.x)}px, ${Math.round(ty)}px, 0)`);
      put(o.anchor, 'display', (p.vis && (!quiet || o.think.classList.contains('on'))) ? '' : 'none');
      put(o.anchor, 'zIndex', String(1000 - Math.round(p.z * 500)));
      put(o.tag, 'marginLeft', shift ? shift + 'px' : '');
      pts.push({ id, x: tx, y: ty, z: p.z, vis: p.vis && !quiet, o });
    }
    for (const p of rawPts) {
      if (!p.vis) {
        p.o.tag.classList.add('tag-quiet');
        put(p.o.anchor, 'display', 'none');
        pts.push({ id: p.id, x: p.x, y: p.y, z: p.z, vis: false, o: p.o });
      }
    }

    placed.length = 0;
    for (const r of ovl.res) placed.push(r);
    for (const p of pts) {   // visible name tags are obstacles too
      if (!p.vis) continue;
      const o = p.o, tw = o.tagW || 70, th = o.tagH || 20;
      placed.push({ x: p.x - tw / 2, y: p.y - th, w: tw, h: th });
      if (o.think.classList.contains('on')) placed.push({ x: p.x - 24, y: p.y - th - 24, w: 48, h: 22 });
    }
    const order = pts.filter((p) => want.has(p.id) && p.vis).sort((a, b) => want.get(a.id).prio - want.get(b.id).prio);
    for (const p of pts) {
      if (!want.has(p.id) || !p.vis) { if (p.o.shown) { p.o.bubble.classList.remove('show'); p.o.shown = false; p.o.cand = -1; } }
    }
    const margin = 6;
    const hits = (rx, ry, w, h) => placed.some((r) => rx < r.x + r.w + margin && rx + w + margin > r.x && ry < r.y + r.h + margin && ry + h + margin > r.y);
    for (const p of order) {
      const bb = want.get(p.id), o = p.o;
      let fresh = false;
      if (o.key !== bb.key) {
        o.key = bb.key;
        o.bubble.className = 'bubble t-' + (bb.type || 'status') + (bb.main ? ' main' : '') + (o.shown ? ' show' : '');
        o.bubble.innerHTML = bb.html;
        o.bubble._idx = bb.idx;
        o.w = o.bubble.offsetWidth; o.h = o.bubble.offsetHeight;
        putVar(o.bubble, '--c', bots.get(p.id).color);
        o.cand = -1; fresh = true;
      }
      if (!o.shown) { o.bubble.classList.add('show'); o.shown = true; fresh = true; }
      const w = o.w || 160, h = o.h || 48;
      // candidate positions: above head, then stacked higher, then left/right
      const tagH = o.tagH || 20;
      const baseX = p.x - w / 2, baseY = p.y - tagH - 8 - h;
      const cands = [[0, 0], [0, -h - 8], [w * 0.55, -10], [-w * 0.55, -10], [w * 0.6, -h - 12], [-w * 0.6, -h - 12], [0, -2 * h - 16], [w * 1.05, 0], [-w * 1.05, 0]];
      const posOf = (i) => [clamp(baseX + cands[i][0], 4, Math.max(4, W - w - 4)), clamp(baseY + cands[i][1], 4, Math.max(4, H - h - 4))];
      let best = null;
      if (o.cand >= 0) {
        const pp = posOf(o.cand);
        if (!hits(pp[0], pp[1], w, h)) { best = pp; o.conflict = 0; }
        else if (++o.conflict < 6) best = pp;            // tolerate short conflicts → no flicker
      }
      if (!best) {
        o.conflict = 0;
        for (let i = 0; i < cands.length; i++) { const pp = posOf(i); if (!hits(pp[0], pp[1], w, h)) { best = pp; o.cand = i; break; } }
      }
      if (!best) { // nothing free: hide lower-priority bubble (keeps the screen readable)
        if (!bb.main) { o.bubble.classList.remove('show'); o.shown = false; o.cand = -1; continue; }
        best = posOf(0); o.cand = 0;
      }
      placed.push({ x: best[0], y: best[1], w, h });
      if (fresh || !o.init) { o.ox = best[0]; o.oy = best[1]; }
      else { o.ox = damp(o.ox, best[0], 14, dt); o.oy = damp(o.oy, best[1], 14, dt); }
      o.init = true;
      const bx = Math.round(o.ox), by = Math.round(o.oy);
      // tail points toward the speaker's head
      putVar(o.bubble, '--tail', Math.round(clamp(p.x - bx, 12, w - 12)) + 'px');
      put(o.bubble, 'transform', `translate3d(${bx}px, ${by}px, 0)`);
      put(o.bubble, 'zIndex', bb.main ? '3000' : String(2000 - bb.prio));
    }
  }

  // ------------------------------------------------ picking (tap = pointerup within 6 px of pointerdown)
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const markUser = () => { cam.userUntil = performance.now() / 1000 + 25; controls.autoRotate = false; };
  controls.addEventListener('start', markUser);   // real gestures only (drag / pinch / wheel), not taps
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    downAt = null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([...bots.values()].map((b) => b.root), true);
    for (const h of hits) { let o = h.object; while (o && o.userData.botId == null) o = o.parent; if (o) { opts.onPickBot?.(o.userData.botId); break; } }
  });

  // ------------------------------------------------ loop (30 fps cap on phones with 4 ms tolerance; paused when hidden / stopped / 0-size)
  let last = performance.now(), running = true, raf = 0, acc = 0, frames = 0, slowFor = 0;
  const FRAME_MS = IS_MOBILE ? 1000 / 30 : 0;
  const TARGET_FPS = IS_MOBILE ? 30 : 60;
  function downgrade() {
    if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; return true; }
    const next = DPR_STEPS.find((d) => d < pixelRatio - 0.01);
    if (next && next >= 1) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); applySize(true); return true; }
    return false;
  }
  function stepFrame(realDt, now) {
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
    // who is speaking? → spotlight + name-tag highlight; everyone else only dims to 85 % (no camera push on phones)
    const sb = frame.spotlight ? bots.get(frame.spotlight) : null;
    const k = realDt;
    if (sb) {
      focusSpot.position.set(sb.pos.x + 0.6, sb.ground + 6.5, sb.pos.y + 2.2);
      focusSpot.target.position.set(sb.pos.x, sb.ground + 0.8, sb.pos.y);
    }
    const dim = sb ? 0.88 : 1;
    focusSpot.intensity = damp(focusSpot.intensity, sb ? light0.spot : 0, 4, k);
    hemi.intensity = damp(hemi.intensity, light0.hemi * dim, 3, k);
    sun.intensity = damp(sun.intensity, light0.sun * dim, 3, k);
    rim.intensity = damp(rim.intensity, light0.rim, 3, k);
    scene.environmentIntensity = damp(scene.environmentIntensity ?? light0.env, light0.env * dim, 3, k);
    for (const [id, o] of overlay) o.tag.classList.toggle('dim', !!sb && id !== frame.spotlight && !(frame.cxPair || []).includes(id));
    if (cam.goal && now > cam.userUntil && opts.autoCamera !== false) {
      const g = sb && cam.fit?.desk ? speakerGoal(sb) : cam.goal;
      const sph = sphericalOf();
      const tgt = g.target || cam.goal.target;
      controls.target.set(damp(controls.target.x, tgt.x, 1.8, k), damp(controls.target.y, tgt.y, 1.8, k), damp(controls.target.z, tgt.z, 1.8, k));
      const r = damp(sph.radius, g.dist ?? cam.goal.dist, 1.8, k);
      const phi = damp(sph.phi, cam.goal.phi, 1.8, k);
      const theta = cam.goal.theta == null ? sph.theta : dampAngle(sph.theta, cam.goal.theta, 1.8, k);
      camera.position.copy(controls.target).add(_v.setFromSphericalCoords(r, phi, theta));
      if (layout.mode === 'roundtable' && !controls.autoRotate && now > cam.userUntil + 4) controls.autoRotate = true;
    }
    controls.update();
    renderer.render(scene, camera);
    presentedKey = hasCompleteScene() ? sceneKey : '';
    layoutOverlay(realDt);
    if (!cam.fit) frameAll({ snap: true });   // e.g. setup ran while the stage had no size yet
    else if (cam.needFit && --cam.needFit === 0 && now > cam.userUntil) frameAll({ snap: true });
  }
  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!running || document.hidden || !layout || !lastW || !lastH) { last = t; acc = 0; frames = 0; return; }
    if (FRAME_MS && t - last < FRAME_MS - 4) return;
    const realDt = Math.min(0.3, (t - last) / 1000); last = t;
    const now = t / 1000;
    stepFrame(realDt, now);
    // adaptive quality: shadows off → DPR 2 → 1.5 → 1.25 → 1 (never below 1)
    acc += realDt; frames++;
    if (acc > 2) {
      const fps = frames / acc; acc = 0; frames = 0;
      stats.fps = +fps.toFixed(1);
      if (fps < TARGET_FPS * 0.72) { if (++slowFor >= 2) { downgrade(); slowFor = 0; } }
      else slowFor = 0;
    } else if (!stats.fps && acc > 0.5) stats.fps = +(frames / acc).toFixed(1);
  }
  raf = requestAnimationFrame(tick);

  function audit() {
    const W = lastW, H = lastH, v = new THREE.Vector3();
    camera.updateMatrixWorld();
    const eps = 0.005, B = NDC_BOUNDS;
    const camPos = [camera.position.x, camera.position.y, camera.position.z];
    const target = [controls.target.x, controls.target.y, controls.target.z];
    const blockers = layout?.blockerBoxes || [];
    const list = [...bots.values()].map((b) => {
      const sc = b.root.scale.y, r = (b.radius ?? 0.3) * sc;
      const y0 = b.root.position.y, y1 = b.headTopY ?? (y0 + 1.5 * sc);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [y0, y1]) {
        v.set(b.pos.x + dx, y, b.pos.y + dz).project(camera);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      const rd = (n) => +n.toFixed(3);
      const inView = minX >= B.minX - eps && maxX <= B.maxX + eps && minY >= B.minY - eps && maxY <= B.maxY + eps;
      const tagEl = overlay.get(b.id)?.tag;
      let tagInView = null;
      if (tagEl && W) {
        const cr = container.getBoundingClientRect(), tr = tagEl.getBoundingClientRect();
        tagInView = tr.width > 0 && tr.left >= cr.left - 1 && tr.right <= cr.right + 1 && tr.top >= cr.top - 1 && tr.bottom <= cr.bottom + 1;
      }
      const chestPt = [b.pos.x, b.ground + Math.max(1.15, (b.topOffset ?? 1.5) * 0.72 * sc), b.pos.y];
      const headPt = [b.pos.x, y1 - 0.12 * sc, b.pos.y];
      let occluded = false;
      for (const box of blockers) {
        if (rayIntersectsBox(camPos, headPt, box.min, box.max) || rayIntersectsBox(camPos, chestPt, box.min, box.max)) {
          occluded = true;
          break;
        }
      }
      if (!occluded) {
        for (const other of bots.values()) {
          if (other.id === b.id) continue;
          const osc = other.root.scale.y, or = 0.28 * osc;
          const oy0 = other.ground + 0.55 * osc, oy1 = other.headTopY ?? (other.ground + 1.5 * osc);
          const omin = [other.pos.x - or, oy0, other.pos.y - or];
          const omax = [other.pos.x + or, oy1, other.pos.y + or];
          if (rayIntersectsBox(camPos, headPt, omin, omax) && rayIntersectsBox(camPos, chestPt, omin, omax)) {
            occluded = true;
            break;
          }
        }
      }
      const ndcCenterX = rd((minX + maxX) / 2);
      const screenH = H ? ((maxY - minY) * 0.5) * H : 0;
      return {
        id: b.id,
        name: b.name,
        worldPos: [rd(b.root.position.x), rd(b.root.position.y), rd(b.root.position.z)],
        topOffset: +(b.topOffset ?? 1.5).toFixed(3),
        ndc: { minX: rd(minX), maxX: rd(maxX), minY: rd(minY), maxY: rd(maxY) },
        ndcCenterX,
        screenH: +screenH.toFixed(2),
        inView,
        inFrame: inView,
        occluded,
        tagInView,
      };
    });
    const furnitureBounds = (layout?.fitPts || []).map((p, idx) => {
      v.set(...p).project(camera);
      return {
        name: `fit-${idx}`,
        ndc: { x: +v.x.toFixed(3), y: +v.y.toFixed(3) },
        inFrame: v.x >= B.minX - eps && v.x <= B.maxX + eps && v.y >= B.minY - eps && v.y <= B.maxY + eps,
      };
    });
    return {
      w: W, h: H, width: W, height: H, camPos, target, dpr: renderer.getPixelRatio(), fps: stats.fps,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      shadows: renderer.shadowMap.enabled, fov: +camera.fov.toFixed(2), bounds: { ...B },
      bots: list, furnitureBounds,
    };
  }

  window.__stage = {
    get bots() { return bots; }, get layout() { return layout; }, get frame() { return frame; },
    get renderer() { return renderer; }, get camera() { return camera; }, get controls() { return controls; },
    waitForTextures,
    audit,
    frameAll: () => { cam.userUntil = 0; frameAll({ snap: true }); },
    focusBot(id) {
      const b = bots.get(id);
      if (!b) return;
      cam.userUntil = performance.now() / 1000 + 60;
      controls.autoRotate = false;
      controls.target.set(b.pos.x, b.ground + 1.05, b.pos.y);
      camera.position.set(b.pos.x + 1.6, b.ground + 2.2, b.pos.y + 3.8);
      controls.update();
    },
    frameBots() { cam.userUntil = 0; frameAll({ snap: true }); },
  };
  // resize: rAF-debounced, ignores < 2 px changes, refits cleanly on hidden -> visible transitions
  let roRaf = 0;
  const ro = new ResizeObserver(() => {
    if (roRaf) return;
    roRaf = requestAnimationFrame(() => {
      roRaf = 0;
      const wasZero = !lastW || !lastH;
      if (!applySize(false)) return;
      if (layout?.mode === 'debate' && lastSetup && spreadOf() !== cam.narrow) { setup(lastSetup, true); return; }
      if (!cam.fit || wasZero || performance.now() / 1000 > cam.userUntil) {
        frameAll({ snap: true });
        if (!cam.fit || wasZero) cam.needFit = 2;
      }
    });
  });
  ro.observe(container);
  applySize(true);

  function isReady() {
    return hasCompleteScene() && presentedKey === sceneKey;
  }
  function present() {
    if (!layout) return false;
    applySize(false);
    if (lastW && lastH) {
      if (!cam.fit) frameAll({ snap: true });
      layoutOverlay(0);
    }
    renderer?.render?.(scene, camera);
    presentedKey = hasCompleteScene() ? sceneKey : '';
    return isReady();
  }

  return {
    setup,
    present,
    isReady,
    getError: () => (buildErrors.length ? `${buildErrors.length} figure(s) failed` : ''),
    clear() {
      sceneKey = '';
      presentedKey = '';
      expectedBots = 0;
      buildErrors = [];
      lastSetup = null;
      layout = null;
      frame = {};
      celebrate = null;
      clearWorld();
      renderer?.render?.(scene, camera);
    },
    update(f) {
      frame = f;
      if (f.verdict && f.showVerdict && !celebrate) celebrate = { winner: f.verdict.winner, t0: performance.now() / 1000 };
      if (!f.showVerdict) celebrate = null;
      if (layout && lastW && lastH) layoutOverlay(0);
    },
    setActive(id) { frame = { ...frame, spotlight: id || null }; },
    tick(dtSec = 0.016) {
      if (!layout || !lastW || !lastH) return;
      stepFrame(Math.min(0.3, Math.max(0.001, dtSec)), performance.now() / 1000);
    },
    audit,
    setCameraControl,
    getCameraControl: () => camControl,
    resetCamera() { if (layout) { cam.userUntil = 0; frameAll({ snap: true }); } },
    setRunning(v) { running = !!v; },
    botColor(id) { return bots.get(id)?.color || '#8a7d70'; },
    dispose() {
      cancelAnimationFrame(raf);
      if (roRaf) cancelAnimationFrame(roRaf);
      cancelAnimationFrame(drag.fling);
      for (const el of [container, overlayRoot]) {
        el.removeEventListener('pointerdown', onDragDown, true);
        el.removeEventListener('pointermove', onDragMove, true);
        el.removeEventListener('pointerup', onDragUp, true);
        el.removeEventListener('pointercancel', onDragUp, true);
        el.removeEventListener('wheel', onStageWheel, true);
      }
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
