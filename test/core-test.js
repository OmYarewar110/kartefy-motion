/* kmotion phase-1 smoke tests: km-core math + seek purity. */
'use strict';
const KM = require('../runtime/km-core.js');

let pass = 0, fail = 0;
function eq(name, got, want, tol) {
  tol = tol == null ? 1e-9 : tol;
  const ok = Math.abs(got - want) <= tol;
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got', got, 'want', want); }
}

// basics
eq('clamp', KM.clamp(5, 0, 3), 3);
eq('lerp', KM.lerp(10, 20, 0.25), 12.5);
eq('seg', KM.seg(1.5, 1, 2), 0.5);
eq('sstep', KM.sstep(0.5), 0.5);

// rng determinism
const r1 = KM.rng(42), r2 = KM.rng(42);
let same = true;
for (let i = 0; i < 100; i++) if (r1() !== r2()) same = false;
if (same) pass++; else { fail++; console.log('FAIL rng determinism'); }

// interp
eq('interp mid', KM.interp(0.5, [0, 1], [10, 20]), 15);
eq('interp ease', KM.interp(0.5, [0, 1], [0, 100], { ease: 'sineInOut' }), 50, 1e-6);
eq('interp clamp lo', KM.interp(-5, [0, 1], [10, 20]), 10);
eq('interp clamp hi', KM.interp(5, [0, 1], [10, 20]), 20);
eq('interp extend', KM.interp(2, [0, 1], [10, 20], { extrapolate: 'extend' }), 30);

// spring: starts at from, settles at to, underdamped overshoots
eq('spring t0', KM.spring(0, { from: 0, to: 1 }), 0);
eq('spring neg', KM.spring(-1, { from: 0, to: 1 }), 0);
const sSettle = KM.spring(10, { zeta: 0.7, omega: 12, from: 0, to: 1 });
eq('spring settles', sSettle, 1, 1e-6);
const sMid = KM.spring(0.2, { zeta: 0.3, omega: 12, from: 0, to: 1 });
if (sMid > 1) pass++; else { fail++; console.log('FAIL spring overshoot', sMid); }
// critical damping: monotonic, no overshoot (approaches asymptotically)
let mono = true, prev = 0;
for (let i = 1; i <= 500; i++) {
  const v = KM.spring(i / 500, { zeta: 1, omega: 8, from: 0, to: 1 });
  if (v < prev - 1e-12) mono = false;
  prev = v;
}
if (mono && prev > 0.99 && prev <= 1) pass++; else { fail++; console.log('FAIL spring critical'); }
// overdamped: monotonic too (slower — just check monotonic + positive progress)
mono = true; prev = 0;
for (let i = 1; i <= 500; i++) {
  const v = KM.spring(i / 500, { zeta: 2.5, omega: 8, from: 0, to: 1 });
  if (v < prev - 1e-12) mono = false;
  prev = v;
}
if (mono && prev > 0.5 && prev <= 1) pass++; else { fail++; console.log('FAIL spring overdamped'); }

// measureSpring returns something sane
const ms = KM.measureSpring({ zeta: 0.7, omega: 12 });
if (ms > 0.2 && ms < 5) pass++; else { fail++; console.log('FAIL measureSpring', ms); }

// camera: log-space zoom midpoint of 1→4 is 2
const cam = KM.camera(0.5, [
  { t: 0, x: 0, y: 0, zoom: 1, curve: 'linear' },
  { t: 1, x: 100, y: 0, zoom: 4, curve: 'linear' }
]);
eq('camera zoom logspace', cam.zoom, 2, 1e-9);
eq('camera x linear', cam.x, 50, 1e-9);

// view: camera center maps to screen center
const m = KM.view({ x: 540, y: 960, zoom: 2, rot: 0 }, { width: 1080, height: 1920, depth: 0 });
eq('view cx', m[0] * 540 + m[2] * 960 + m[4], 540, 1e-6);
eq('view cy', m[1] * 540 + m[3] * 960 + m[5], 960, 1e-6);

// spline passes through knots
const sp = KM.spline([{ t: 0, x: 0, y: 0 }, { t: 1, x: 10, y: 20 }, { t: 2, x: 20, y: 0 }], 1);
eq('spline x', sp[0], 10, 1e-9);
eq('spline y', sp[1], 20, 1e-9);

// landingShake is zero before the hit
const sh = KM.landingShake(0.5, 1.0, { amp: 10 });
eq('shake pre-hit', sh.x + sh.y + sh.rot, 0);

// t80: snappy vs smooth
const t80expo = KM.t80('expoOut'), t80sine = KM.t80('sineInOut');
if (t80expo < t80sine) pass++; else { fail++; console.log('FAIL t80', t80expo, t80sine); }

console.log(`\nkm-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
