/**
 * Pure ES camera framing & occlusion geometry helpers shared by stage3d.js and headless Node tests.
 * Zero external dependencies so browser importmaps and Node ESM run identically.
 */

const DEG2RAD = Math.PI / 180;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function makeCameraBasis(dirFromTarget) {
  const D = norm(dirFromTarget);
  let R = cross([0, 1, 0], D);
  if (Math.hypot(R[0], R[1], R[2]) < 1e-6) R = [1, 0, 0];
  else R = norm(R);
  const U = norm(cross(D, R));
  return { R, U, D };
}

/**
 * Project a 3D world point [x,y,z] to NDC [-1,1]^2 matching THREE.PerspectiveCamera.project().
 */
export function projectNDC(pt, camPos, target, fovDeg, aspect) {
  const D = norm(sub(camPos, target));
  const { R, U } = makeCameraBasis(D);
  const rel = sub(pt, camPos);
  const vx = dot(rel, R);
  const vy = dot(rel, U);
  const depth = -dot(rel, D);
  const ky = Math.tan((fovDeg * DEG2RAD) / 2);
  const kx = ky * aspect;
  return {
    x: vx / (depth * kx),
    y: vy / (depth * ky),
    depth,
  };
}

/**
 * Solve minimal camera distance along `dir` from `center` so all `pts` stay within their NDC bounds.
 * Each item in `pts` is `{ p: [x,y,z], b: { minX, maxX, minY, maxY } }`.
 */
export function solveCameraFit({ pts, center, dir, fovDeg, aspect, slack = 1 }) {
  const { R, U, D: Dvec } = makeCameraBasis(dir);
  const ky = Math.tan((fovDeg * DEG2RAD) / 2);
  const kx = ky * aspect;
  const q = pts.map((pt) => {
    const v = sub(pt.p, center);
    return { x: dot(v, R), y: dot(v, U), z: dot(v, Dvec), b: pt.b };
  });
  const interval = (dist) => {
    let xl = -Infinity, xh = Infinity, yl = -Infinity, yh = Infinity;
    for (const c of q) {
      const depth = dist - c.z;
      if (depth < 0.5) return null;
      xl = Math.max(xl, c.x - c.b.maxX * depth * kx);
      xh = Math.min(xh, c.x - c.b.minX * depth * kx);
      yl = Math.max(yl, c.y - c.b.maxY * depth * ky);
      yh = Math.min(yh, c.y - c.b.minY * depth * ky);
    }
    return xl <= xh && yl <= yh ? { xl, xh, yl, yh } : null;
  };
  let lo = 1, hi = 120;
  if (!interval(hi)) return null;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (interval(m)) hi = m;
    else lo = m;
  }
  const D = hi * slack;
  const iv = interval(D);
  if (!iv) return null;
  return { D, iv, R, U, dir: Dvec, center: [...center], interval };
}

/**
 * Slab AABB segment intersection from `origin` to `targetPt` over parametric t in [tMin, tMax].
 */
export function rayIntersectsBox(origin, targetPt, boxMin, boxMax, tMin = 1e-4, tMax = 0.99) {
  let lo = tMin, hi = tMax;
  for (let i = 0; i < 3; i++) {
    const d = targetPt[i] - origin[i];
    if (Math.abs(d) < 1e-9) {
      if (origin[i] < boxMin[i] || origin[i] > boxMax[i]) return false;
    } else {
      let t1 = (boxMin[i] - origin[i]) / d;
      let t2 = (boxMax[i] - origin[i]) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      lo = Math.max(lo, t1);
      hi = Math.min(hi, t2);
      if (lo > hi) return false;
    }
  }
  return lo <= hi;
}
