/* ============================================================================
 * kartefy-motion · km-core
 * Pure motion mathematics. No DOM, no wall clock, no dependencies.
 *
 * Every function here is a PURE FUNCTION OF TIME: given the same inputs it
 * returns the same outputs, always. That is the entire foundation the
 * deterministic renderer stands on.
 *
 * Works in Node (module.exports) and in the browser (window.KM).
 * ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.KM = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KM = {};

  /* ------------------------------------------------------------------ */
  /* basics                                                              */
  /* ------------------------------------------------------------------ */

  /** Clamp v into [lo, hi]. */
  KM.clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  /** Linear interpolation a → b by k. */
  KM.lerp = function (a, b, k) {
    return a + (b - a) * k;
  };

  /**
   * Progress of t within [t0, t1], clamped to [0, 1].
   * The workhorse: almost every animation starts as KM.seg(...).
   */
  KM.seg = function (t, t0, t1) {
    if (t1 <= t0) return t >= t1 ? 1 : 0;
    return KM.clamp((t - t0) / (t1 - t0), 0, 1);
  };

  /** Smoothstep: 3k² − 2k³. */
  KM.sstep = function (k) {
    k = KM.clamp(k, 0, 1);
    return k * k * (3 - 2 * k);
  };

  /** Smootherstep (Perlin): 6k⁵ − 15k⁴ + 10k³. */
  KM.smoother = function (k) {
    k = KM.clamp(k, 0, 1);
    return k * k * k * (k * (k * 6 - 15) + 10);
  };

  /* ------------------------------------------------------------------ */
  /* seeded randomness                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * mulberry32 seeded PRNG. Deterministic: same seed → same sequence.
   * Unseeded Math.random() is FORBIDDEN in compositions (breaks determinism).
   */
  KM.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ------------------------------------------------------------------ */
  /* easing curves — plain math, selected by measured t80 in practice     */
  /* ------------------------------------------------------------------ */

  var PI = Math.PI;

  KM.ease = {
    linear: function (k) { return k; },

    sineIn: function (k) { return 1 - Math.cos((k * PI) / 2); },
    sineOut: function (k) { return Math.sin((k * PI) / 2); },
    sineInOut: function (k) { return -(Math.cos(PI * k) - 1) / 2; },

    cubicIn: function (k) { return k * k * k; },
    cubicOut: function (k) { return 1 - Math.pow(1 - k, 3); },
    cubicInOut: function (k) {
      return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    },

    expoIn: function (k) { return k <= 0 ? 0 : Math.pow(2, 10 * k - 10); },
    expoOut: function (k) { return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); },
    expoInOut: function (k) {
      if (k <= 0) return 0;
      if (k >= 1) return 1;
      return k < 0.5
        ? Math.pow(2, 20 * k - 10) / 2
        : (2 - Math.pow(2, -20 * k + 10)) / 2;
    },

    /** Overshoot ease (c1 = 1.70158). */
    back: function (k) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    },

    /** Damped oscillation into place. */
    elastic: function (k) {
      if (k <= 0) return 0;
      if (k >= 1) return 1;
      return Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * PI) / 3)) + 1;
    },

    /** Bouncing settle. */
    bounce: function (k) {
      var n1 = 7.5625, d1 = 2.75;
      if (k < 1 / d1) return n1 * k * k;
      if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75;
      if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375;
      return n1 * (k -= 2.625 / d1) * k + 0.984375;
    },

    smoothstep: function (k) { return KM.sstep(k); },
    smootherstep: function (k) { return KM.smoother(k); }
  };

  /** Look up an easing by name (string) or pass a function straight through. */
  KM.resolveEase = function (e) {
    if (typeof e === 'function') return e;
    return KM.ease[e] || KM.ease.linear;
  };

  /* ------------------------------------------------------------------ */
  /* interpolate — map t from an input range to an output range          */
  /* ------------------------------------------------------------------ */

  /**
   * KM.interp(t, inRange, outRange, opts)
   *
   * Piecewise interpolation. Each segment gets the easing applied.
   *   opts.ease        — easing name or function (default 'linear')
   *   opts.extrapolate — 'clamp' (default) | 'extend' | 'identity'
   *     clamp:    stick to the nearest endpoint outside the range
   *     extend:   continue linearly along the nearest segment's slope
   *     identity: return t itself outside the range
   */
  KM.interp = function (t, inR, outR, opts) {
    opts = opts || {};
    var ease = KM.resolveEase(opts.ease || 'linear');
    var extrap = opts.extrapolate || 'clamp';
    var n = inR.length;

    if (n < 2 || outR.length < 2) return outR[0];

    function segSlope(i) {
      return (outR[i + 1] - outR[i]) / (inR[i + 1] - inR[i]);
    }

    // Before the first key.
    if (t <= inR[0]) {
      if (extrap === 'identity') return t;
      if (extrap === 'extend') return outR[0] + (t - inR[0]) * segSlope(0);
      return outR[0];
    }
    // After the last key.
    if (t >= inR[n - 1]) {
      if (extrap === 'identity') return t;
      if (extrap === 'extend') return outR[n - 1] + (t - inR[n - 1]) * segSlope(n - 2);
      return outR[n - 1];
    }
    // Inside: find the segment and ease across it.
    var i = 0;
    while (i < n - 2 && t > inR[i + 1]) i++;
    var k = (t - inR[i]) / (inR[i + 1] - inR[i]);
    return outR[i] + (outR[i + 1] - outR[i]) * ease(k);
  };

  /**
   * Interpolate between color stops. Stops: [{t, color}] with color as
   * '#rrggbb' (or '#rgb'). Returns an 'rgb(r,g,b)' string. Linear in sRGB —
   * fine for UI color; linear-light version lands in Phase 2 with blur.
   */
  KM.interpColor = function (t, stops) {
    function hex(h) {
      h = h.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var n = stops.length;
    if (!n) return 'rgb(0,0,0)';
    if (t <= stops[0].t) { var c0 = hex(stops[0].color); return 'rgb(' + c0.join(',') + ')'; }
    if (t >= stops[n - 1].t) { var c1 = hex(stops[n - 1].color); return 'rgb(' + c1.join(',') + ')'; }
    var i = 0;
    while (i < n - 2 && t > stops[i + 1].t) i++;
    var k = (t - stops[i].t) / (stops[i + 1].t - stops[i].t);
    var a = hex(stops[i].color), b = hex(stops[i + 1].color);
    var r = Math.round(KM.lerp(a[0], b[0], k));
    var g = Math.round(KM.lerp(a[1], b[1], k));
    var bl = Math.round(KM.lerp(a[2], b[2], k));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  };

  /* ------------------------------------------------------------------ */
  /* spring — analytic damped harmonic oscillator (closed form)          */
  /* ------------------------------------------------------------------ */

  /**
   * KM.spring(tau, {zeta, omega, from, to})
   *
   * Exact closed-form solution of  x'' + 2ζωx' + ω²(x − to) = 0
   * with x(0) = from, x'(0) = 0 (starts at rest).
   *
   *   zeta  — damping ratio. <1 bouncy, =1 critical, >1 sluggish.
   *   omega — angular frequency (rad/s). Higher = snappier.
   *
   * No numerical integration: unconditionally stable, deterministic,
   * and cheap. tau is seconds since the spring started (tau ≤ 0 → from).
   */
  KM.spring = function (tau, o) {
    o = o || {};
    var zeta = o.zeta == null ? 0.7 : o.zeta;
    var omega = o.omega == null ? 12 : o.omega;
    var from = o.from == null ? 0 : o.from;
    var to = o.to == null ? 1 : o.to;
    if (tau <= 0) return from;
    if (from === to) return to;

    var d = to - from; // signed distance to travel

    if (zeta < 1) {
      // Underdamped: decaying sinusoid.
      var w1 = omega * Math.sqrt(1 - zeta * zeta);
      var env = Math.exp(-zeta * omega * tau);
      return to - d * env * (Math.cos(w1 * tau) + ((zeta * omega) / w1) * Math.sin(w1 * tau));
    }
    if (zeta === 1) {
      // Critically damped.
      var e = Math.exp(-omega * tau);
      return to - d * e * (1 + omega * tau);
    }
    // Overdamped: two real decaying exponentials.
    var s = Math.sqrt(zeta * zeta - 1);
    var r1 = -omega * (zeta - s);
    var r2 = -omega * (zeta + s);
    return to - d * ((r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r2 - r1));
  };

  /**
   * How long (seconds) until the spring settles within `threshold`
   * (fraction of travel distance). Samples the closed form at 240 Hz —
   * exact enough for auto-timing scene beats.
   */
  KM.measureSpring = function (o, threshold) {
    o = o || {};
    threshold = threshold == null ? 0.001 : threshold;
    var from = o.from == null ? 0 : o.from;
    var to = o.to == null ? 1 : o.to;
    var tol = Math.abs(to - from) * threshold;
    if (tol === 0) return 0;
    var dt = 1 / 240, t = 0, quiet = 0;
    while (t < 10) {
      t += dt;
      if (Math.abs(KM.spring(t, o) - to) <= tol) {
        quiet += dt;
        if (quiet >= 0.2) return t - 0.2; // settled 0.2s straight → done
      } else {
        quiet = 0;
      }
    }
    return 10;
  };

  /* ------------------------------------------------------------------ */
  /* spline — Hermite curve through {t,x,y} knots                        */
  /* ------------------------------------------------------------------ */

  /**
   * KM.spline(knots, t) → [x, y].
   * Catmull-Rom-style Hermite interpolation per dimension.
   * Pure function; knots must be sorted by t.
   */
  KM.spline = function (knots, t) {
    var n = knots.length;
    if (!n) return [0, 0];
    if (t <= knots[0].t) return [knots[0].x, knots[0].y];
    if (t >= knots[n - 1].t) return [knots[n - 1].x, knots[n - 1].y];

    var i = 0;
    while (i < n - 2 && t > knots[i + 1].t) i++;
    var p0 = knots[Math.max(0, i - 1)];
    var p1 = knots[i];
    var p2 = knots[i + 1];
    var p3 = knots[Math.min(n - 1, i + 2)];
    var k = (t - p1.t) / (p2.t - p1.t);

    function cr(v0, v1, v2, v3) {
      var m1 = (v2 - v0) / 2, m2 = (v3 - v1) / 2;
      var k2 = k * k, k3 = k2 * k;
      return (2 * k3 - 3 * k2 + 1) * v1 + (k3 - 2 * k2 + k) * m1 +
             (-2 * k3 + 3 * k2) * v2 + (k3 - k2) * m2;
    }
    return [cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y)];
  };

  /* ------------------------------------------------------------------ */
  /* camera — keyframed operator with log-space zoom                     */
  /* ------------------------------------------------------------------ */

  /**
   * KM.camera(t, keys) → {x, y, zoom, rot}.
   * keys: [{t, x, y, zoom, rot, curve}] — curve is an easing name/function
   * applied to the INCOMING segment (stored on the later key).
   *
   * Zoom interpolates in LOG space so a 1×→4× push moves at constant
   * perceived speed instead of crawling then lunging.
   */
  KM.camera = function (t, keys) {
    var n = keys.length;
    if (!n) return { x: 540, y: 960, zoom: 1, rot: 0 };
    function snap(k) {
      return { x: k.x, y: k.y, zoom: k.zoom == null ? 1 : k.zoom, rot: k.rot || 0 };
    }
    if (t <= keys[0].t) return snap(keys[0]);
    if (t >= keys[n - 1].t) return snap(keys[n - 1]);

    var i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i++;
    var a = keys[i], b = keys[i + 1];
    var ease = KM.resolveEase(b.curve || 'sineInOut');
    var k = ease(KM.seg(t, a.t, b.t));
    return {
      x: KM.lerp(a.x, b.x, k),
      y: KM.lerp(a.y, b.y, k),
      zoom: Math.exp(KM.lerp(Math.log(a.zoom == null ? 1 : a.zoom),
                             Math.log(b.zoom == null ? 1 : b.zoom), k)),
      rot: KM.lerp(a.rot || 0, b.rot || 0, k)
    };
  };

  /**
   * KM.view(cam, {width, height, depth}) → [a,b,c,d,e,f]
   * Canvas 2D affine matrix mapping world → screen for one depth layer.
   * depth 0 = focus plane; positive = farther (moves/zooms less → parallax).
   */
  KM.view = function (cam, o) {
    o = o || {};
    var W = o.width || 1080, H = o.height || 1920;
    var depth = o.depth || 0;
    var z = (cam.zoom || 1) / (1 + depth * 0.6);
    var rot = cam.rot || 0;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var cx = cam.x == null ? W / 2 : cam.x;
    var cy = cam.y == null ? H / 2 : cam.y;
    return [
      z * cos, z * sin,
      -z * sin, z * cos,
      W / 2 - z * (cos * cx - sin * cy),
      H / 2 - z * (sin * cx + cos * cy)
    ];
  };

  /**
   * KM.chaseAhead(keys, lead) — shift every key's position sample `lead`
   * seconds into the future so the camera feels operated, not scripted.
   * (Implementation: returns new keys with t reduced by lead; the render
   *  clamps at the ends. Simple, pure, predictable.)
   */
  KM.chaseAhead = function (keys, lead) {
    lead = lead || 0.1;
    return keys.map(function (k) {
      var c = {};
      for (var p in k) c[p] = k[p];
      c.t = Math.max(0, k.t - lead);
      return c;
    });
  };

  /**
   * KM.handFloat(t, amp) — slow two-sine drift for handheld feel.
   * Returns {x, y} offsets. Deterministic (fixed frequencies).
   */
  KM.handFloat = function (t, amp) {
    amp = amp == null ? 6 : amp;
    return {
      x: amp * (0.6 * Math.sin(2 * PI * 0.23 * t) + 0.4 * Math.sin(2 * PI * 0.41 * t + 1.7)),
      y: amp * (0.6 * Math.cos(2 * PI * 0.19 * t + 0.6) + 0.4 * Math.sin(2 * PI * 0.37 * t + 2.9))
    };
  };

  /**
   * KM.landingShake(t, tHit, {amp, decay, freq, seed}) — decaying,
   * seeded shake that is exactly zero before tHit.
   */
  KM.landingShake = function (t, tHit, o) {
    o = o || {};
    var amp = o.amp == null ? 10 : o.amp;
    var decay = o.decay == null ? 6 : o.decay;
    var freq = o.freq == null ? 28 : o.freq;
    var seed = o.seed == null ? 7 : o.seed;
    if (t < tHit) return { x: 0, y: 0, rot: 0 };
    var tau = t - tHit;
    var env = amp * Math.exp(-decay * tau);
    // Seeded phases keep it deterministic across machines.
    var r = KM.rng(seed);
    var p1 = r() * 2 * PI, p2 = r() * 2 * PI, p3 = r() * 2 * PI;
    return {
      x: env * Math.sin(2 * PI * freq * tau + p1),
      y: env * 0.7 * Math.sin(2 * PI * freq * 0.83 * tau + p2),
      rot: (env * 0.002) * Math.sin(2 * PI * freq * 0.61 * tau + p3)
    };
  };

  /* ------------------------------------------------------------------ */
  /* carry moves — transitions where the next beat grows out of this one   */
  /*                                                                     */
  /* Every move is a pure function of absolute time. They return plain   */
  /* values the scene writes into DOM transforms or canvas calls. The    */
  /* contract: something visible SURVIVES the boundary and moves/scales   */
  /* into the next beat — that is what the carry oracle scores.          */
  /* ------------------------------------------------------------------ */

  /**
   * KM.morphRect(t, t0, t1, A, B, {curve, radius}) → {x, y, w, h, r}
   * One rect becomes another: the thing pressed becomes the result
   * (button → window, card → page). A, B: {x, y, w, h, r?}.
   */
  KM.morphRect = function (t, t0, t1, A, B, o) {
    o = o || {};
    var ease = KM.resolveEase(o.curve || 'expoInOut');
    var k = ease(KM.seg(t, t0, t1));
    return {
      x: KM.lerp(A.x, B.x, k),
      y: KM.lerp(A.y, B.y, k),
      w: KM.lerp(A.w, B.w, k),
      h: KM.lerp(A.h, B.h, k),
      r: KM.lerp(A.r || 0, B.r || 0, k)
    };
  };

  /**
   * KM.iris(t, t0, t1, cx, cy, {curve, maxR}) → {r, covered, x, y}
   * A circle opens FROM the subject point until it covers the frame —
   * the subject opens its own world. r=0 before t0. covered=true once
   * the circle contains the farthest frame corner.
   */
  KM.iris = function (t, t0, t1, cx, cy, o) {
    o = o || {};
    var W = o.width || 1080, H = o.height || 1920;
    var maxR = o.maxR || Math.sqrt(Math.max(cx, W - cx) * Math.max(cx, W - cx) +
                                   Math.max(cy, H - cy) * Math.max(cy, H - cy));
    var ease = KM.resolveEase(o.curve || 'expoInOut');
    var k = ease(KM.seg(t, t0, t1));
    var r = maxR * k;
    return { r: r, covered: r >= maxR * 0.999, x: cx, y: cy };
  };

  /**
   * KM.zoomThrough(t, t0, t1, target, {curve, fit}) → {s, tx, ty, matrix}
   * Log-space push until the target rect fills the frame — one card among
   * many becomes the next scene. target: {x, y, w, h} in world coords.
   * matrix is a canvas/DOM-ready [a,b,c,d,e,f] (transform-origin 0 0).
   */
  KM.zoomThrough = function (t, t0, t1, target, o) {
    o = o || {};
    var W = o.width || 1080, H = o.height || 1920;
    var ease = KM.resolveEase(o.curve || 'expoInOut');
    var k = ease(KM.seg(t, t0, t1));
    // Final zoom: target fills the frame (cover-fit).
    var sEnd = Math.max(W / target.w, H / target.h);
    var s = Math.exp(KM.lerp(0, Math.log(Math.max(sEnd, 1.0001)), k));
    // Keep the target's center glued to the frame center through the zoom.
    var tcx = target.x + target.w / 2, tcy = target.y + target.h / 2;
    var tx = W / 2 - s * tcx, ty = H / 2 - s * tcy;
    return { s: s, tx: tx, ty: ty, matrix: [s, 0, 0, s, tx, ty] };
  };

  /**
   * KM.hop(t, t0, t1, from, to, {height, curve}) → {x, y, landed}
   * An arc from one slot to the next; land it with KM.impact for the
   * squash. from/to: {x, y}.
   */
  KM.hop = function (t, t0, t1, from, to, o) {
    o = o || {};
    var h = o.height == null ? 160 : o.height;
    var ease = KM.resolveEase(o.curve || 'sineInOut');
    var k = ease(KM.seg(t, t0, t1));
    return {
      x: KM.lerp(from.x, to.x, k),
      y: KM.lerp(from.y, to.y, k) - h * 4 * k * (1 - k), // parabola, peak at k=0.5
      landed: t >= t1
    };
  };

  /**
   * KM.gather(t, t0, t1, items, to, {arc, spin, stagger}) → [{x, y, rot}]
   * The cast travels on fanned arcs into a cluster: many become one.
   * items: [{x, y}], to: {x, y}. Returns one entry per item.
   */
  KM.gather = function (t, t0, t1, items, to, o) {
    o = o || {};
    var arc = o.arc == null ? 120 : o.arc;
    var spin = o.spin == null ? 0 : o.spin;
    var stagger = o.stagger == null ? 0.12 : o.stagger;
    var n = items.length;
    var out = [];
    for (var i = 0; i < n; i++) {
      var lt0 = t0 + i * stagger * (t1 - t0) / Math.max(n, 1);
      var lt1 = t1;
      var ease = KM.resolveEase(o.curve || 'sineInOut');
      var k = ease(KM.seg(t, lt0, lt1));
      var dir = (i % 2 === 0) ? 1 : -1; // fan alternating sides
      out.push({
        x: KM.lerp(items[i].x, to.x, k),
        y: KM.lerp(items[i].y, to.y, k) - arc * dir * 4 * k * (1 - k),
        rot: spin * k * dir
      });
    }
    return out;
  };

  /**
   * KM.wordRise(t, t0, {zeta, omega, dist}) → {op, y, s}
   * A word lands: spring rise with scale; OPACITY LEADS the spring so it
   * never reads as a PowerPoint fade. The entrance for kinetic type.
   */
  KM.wordRise = function (t, t0, o) {
    o = o || {};
    var tau = t - t0;
    if (tau <= 0) return { op: 0, y: o.dist == null ? 60 : o.dist, s: 0.9 };
    var dist = o.dist == null ? 60 : o.dist;
    // Opacity on a faster clock than position — it leads.
    var opK = KM.seg(tau, 0, 0.18);
    var sk = KM.spring(tau, { zeta: o.zeta == null ? 0.62 : o.zeta,
                              omega: o.omega == null ? 14 : o.omega,
                              from: 0, to: 1 });
    return { op: opK, y: dist * (1 - sk), s: 0.9 + 0.1 * sk };
  };

  /**
   * KM.typeOn(t, t0, text, {cps, blinkHz}) → {n, str, done, caret}
   * Terminal typing at a steady rate; caret solid while typing, blinking
   * when done. n = chars shown.
   */
  KM.typeOn = function (t, t0, text, o) {
    o = o || {};
    var cps = o.cps || 28;
    var tau = t - t0;
    if (tau <= 0) return { n: 0, str: '', done: false, caret: true };
    var n = Math.min(text.length, Math.floor(tau * cps));
    var done = n >= text.length;
    var caret = done
      ? (Math.floor(tau * (o.blinkHz || 2)) % 2 === 0)
      : true;
    return { n: n, str: text.slice(0, n), done: done, caret: caret };
  };

  /**
   * KM.impact(t, tHit, {decay, omega, squash}) → {sx, sy, ring}
   * The landing: squash along the hit axis, then ring out. Pair with
   * KM.hop's landed flag or any arrival.
   */
  KM.impact = function (t, tHit, o) {
    o = o || {};
    var decay = o.decay == null ? 7 : o.decay;
    var omega = o.omega == null ? 26 : o.omega;
    var amp = o.squash == null ? 0.24 : o.squash;
    if (t < tHit) return { sx: 1, sy: 1, ring: 0 };
    var tau = t - tHit;
    var env = Math.exp(-decay * tau);
    var osc = Math.cos(omega * tau);
    var q = amp * env * osc;
    return { sx: 1 + q, sy: 1 - q, ring: env };
  };

  /* ------------------------------------------------------------------ */
  /* t80 — measure a curve's character instead of naming it              */
  /* ------------------------------------------------------------------ */

  /**
   * KM.t80(curveFn) → fraction of the duration before 80% of the
   * distance is covered. Snappy curves ≈ 0.2–0.35, S-curves ≈ 0.6–0.75.
   * Sampled at 1000 points — cheap and exact enough for curve choice.
   */
  KM.t80 = function (curveFn) {
    var f = KM.resolveEase(curveFn);
    var N = 1000, i;
    for (i = 0; i <= N; i++) {
      if (f(i / N) >= 0.8) return i / N;
    }
    return 1;
  };

  KM.version = 1;
  return KM;
});
