/* ============================================================================
 * kartefy-motion · km-fx
 * Effect primitives — original implementations. All effects are pure
 * functions of absolute time t (seek-pure by construction).
 *
 * Randomness discipline (the boilSeed idea): every effect that needs
 * randomness takes a seed and derives PER-ELEMENT streams —
 *   rngFor(seed, elementIndex) = KM.rng(seed * 7919 + elementIndex * 104729)
 * so moving elements never jitter still ones, and re-seeking is stable.
 *
 * Requires: km-core.js loaded first (window.KM).
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var KM = window.KM;
  if (!KM) throw new Error('km-fx: km-core.js (window.KM) must load first.');

  var FX = {};

  /** Per-element RNG stream: stable across seeks, independent per element. */
  FX.rngFor = function (seed, idx) {
    return KM.rng(((seed * 7919) + (idx * 104729)) >>> 0);
  };

  /* ------------------------------------------------------------------ */
  /* glitch — RGB channel split + slice displacement, seeded            */
  /* ------------------------------------------------------------------ */

  /**
   * FX.glitch(el, t, t0, t1, intensity, seed)
   * Applies a digital glitch to el while t ∈ [t0, t1]. intensity 0..1.
   * Outside the window the element is restored exactly (seek-pure).
   *
   * Implementation: clip-path slices offset horizontally + hue-rotate
   * flicker. Cheap (no canvas), deterministic via seeded slice layout.
   */
  FX.glitch = function (el, t, t0, t1, intensity, seed) {
    intensity = intensity == null ? 0.7 : intensity;
    seed = seed == null ? 11 : seed;
    if (t < t0 || t >= t1) {
      el.style.clipPath = '';
      el.style.transform = '';
      el.style.filter = '';
      el.style.textShadow = '';
      return;
    }
    var k = KM.seg(t, t0, t1);
    // Glitch energy: bursts — strongest at the edges, perlin-ish middle.
    var env = Math.sin(Math.PI * KM.clamp(k, 0, 1));
    var e = intensity * (0.35 + 0.65 * env);
    var r = FX.rngFor(seed, Math.floor((t - t0) * 24)); // new slice layout per ~frame
    var n = 3 + Math.floor(r() * 4);
    var slices = [];
    var y = 0;
    for (var i = 0; i < n && y < 100; i++) {
      var h = 4 + r() * 14;
      var dx = (r() - 0.5) * 46 * e;
      if (Math.abs(dx) > 2) {
        slices.push('inset(' + y.toFixed(1) + '% -100% ' +
                    (100 - y - h).toFixed(1) + '% ' + (-dx).toFixed(1) + 'px)');
      }
      y += h + r() * 9;
    }
    // Apply displacement via a translated clone trick is expensive; instead
    // offset the whole element in slices using clip-path on layered copies
    // is overkill — we do: whole-element jitter + slice clip + RGB split
    // via text-shadow (text) / drop-shadow (shapes).
    var jx = (r() - 0.5) * 18 * e;
    var jy = (r() - 0.5) * 10 * e;
    el.style.transform = 'translate(' + jx.toFixed(2) + 'px,' + jy.toFixed(2) + 'px)';
    el.style.clipPath = slices.length ? slices.join(',') : '';
    var split = (6 * e).toFixed(1);
    el.style.textShadow =
      (-split) + 'px 0 0 rgba(255,0,80,' + (0.75 * e).toFixed(2) + '),' +
      split + 'px 0 0 rgba(0,255,255,' + (0.75 * e).toFixed(2) + ')';
    el.style.filter = 'hue-rotate(' + ((r() - 0.5) * 40 * e).toFixed(1) + 'deg) ' +
                      'saturate(' + (1 + 0.9 * e).toFixed(2) + ')';
  };

  /* ------------------------------------------------------------------ */
  /* particles — GPU-cheap canvas particles with per-element RNG        */
  /* ------------------------------------------------------------------ */

  /**
   * FX.createParticles(canvas, opts) → update(t)
   * opts: { n, seed, area {x,y,w,h}, size [min,max], colors [],
   *         vy [min,max] (px/s upward drift), vx, life, alpha, shape }
   *
   * Each particle i owns rng stream FX.rngFor(seed, i): its spawn position,
   * velocity, phase and size NEVER change — position is a pure function
   * of t, so seeking is stable and still particles never jitter.
   */
  FX.createParticles = function (canvas, opts) {
    opts = opts || {};
    var n = opts.n || 60;
    var seed = opts.seed == null ? 42 : opts.seed;
    var area = opts.area || { x: 0, y: 0, w: 1080, h: 1920 };
    var colors = opts.colors || ['#FFFFFF'];
    var W = canvas.width, H = canvas.height;
    var sx = W / 1080, sy = H / 1920; // design space → canvas space
    var ctx = canvas.getContext('2d');

    var ps = [];
    for (var i = 0; i < n; i++) {
      var r = FX.rngFor(seed, i);
      var life = (opts.life && opts.life[0] != null)
        ? opts.life[0] + r() * (opts.life[1] - opts.life[0]) : 4 + r() * 5;
      ps.push({
        x0: area.x + r() * area.w,
        y0: area.y + r() * area.h,
        vx: (opts.vx ? opts.vx[0] + r() * (opts.vx[1] - opts.vx[0]) : (r() - 0.5) * 30),
        vy: (opts.vy ? opts.vy[0] + r() * (opts.vy[1] - opts.vy[0]) : -(20 + r() * 60)),
        size: (opts.size ? opts.size[0] + r() * (opts.size[1] - opts.size[0]) : 2 + r() * 5),
        color: colors[Math.floor(r() * colors.length)],
        phase: r() * 6.283,
        life: life,
        off: r() * life, // birth offset so the field is alive at t=0
        alpha: (opts.alpha ? opts.alpha[0] + r() * (opts.alpha[1] - opts.alpha[0]) : 0.5 + r() * 0.5)
      });
    }

    function update(t) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var age = (t + p.off) % p.life;
        var k = age / p.life; // 0→1 over the particle's life
        var x = (p.x0 + p.vx * age + 8 * Math.sin(p.phase + age * 2)) * sx;
        var y = (p.y0 + p.vy * age) * sy;
        // Wrap vertically so the field never empties.
        var yy = ((y % H) + H) % H;
        var a = p.alpha * Math.sin(Math.PI * KM.clamp(k, 0, 1)); // fade in/out
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        var s = p.size * sx * (0.6 + 0.4 * Math.sin(Math.PI * k));
        ctx.beginPath();
        ctx.arc(x, yy, Math.max(s, 0.5), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    update.t = 0;
    return update;
  };

  /* ------------------------------------------------------------------ */
  /* glow — light leak / persistent glow as punctuation                 */
  /* ------------------------------------------------------------------ */

  /**
   * FX.glow(el, t, o) — o: { level (0..1), color, x, y, r }
   * A radial glow whose level is a pure function of t. Drive level with
   * KM.seg/spring in the scene: rise → flood → drain onto the next beat.
   */
  FX.glow = function (el, t, o) {
    o = o || {};
    var level = o.level == null ? 0 : o.level;
    var color = o.color || '64,110,255';
    var r = o.r || 900;
    var x = o.x == null ? 50 : o.x, y = o.y == null ? 62 : o.y;
    el.style.opacity = KM.clamp(level, 0, 1).toFixed(3);
    el.style.background =
      'radial-gradient(circle at ' + x + '% ' + y + '% , ' +
      'rgba(' + color + ',' + (0.5 * KM.clamp(level, 0, 1)).toFixed(3) + ') 0%, ' +
      'rgba(' + color + ',0) ' + r + 'px)';
  };

  /* ------------------------------------------------------------------ */
  /* kineticType — word-stagger entrances (type lands, never fades)     */
  /* ------------------------------------------------------------------ */

  /**
   * FX.kineticType(container, t, t0, words, o) → void
   * words: [string]. Each word gets wordRise at t0 + i*stagger.
   * o: { stagger, zeta, omega, dist, style } — style applied to words.
   * Builds the spans once (idempotent), updates every call — seek-pure.
   */
  FX.kineticType = function (container, t, t0, words, o) {
    o = o || {};
    if (!container._kmKT || container._kmKT.words !== words) {
      container.innerHTML = '';
      var spans = words.map(function (w) {
        var s = document.createElement('span');
        s.textContent = w;
        s.style.display = 'inline-block';
        s.style.margin = '0 14px';
        s.style.willChange = 'transform, opacity';
        if (o.style) for (var k in o.style) s.style[k] = o.style[k];
        container.appendChild(s);
        container.appendChild(document.createTextNode(' '));
        return s;
      });
      container._kmKT = { words: words, spans: spans };
    }
    var stagger = o.stagger == null ? 0.14 : o.stagger;
    var spans = container._kmKT.spans;
    for (var i = 0; i < spans.length; i++) {
      var wr = KM.wordRise(t, t0 + i * stagger, o);
      var sp = spans[i];
      sp.style.opacity = wr.op.toFixed(3);
      sp.style.transform = 'translateY(' + wr.y.toFixed(2) + 'px) scale(' + wr.s.toFixed(4) + ')';
    }
  };

  /* ------------------------------------------------------------------ */
  /* grain — fixed-pattern film grain (stills stay still)               */
  /* ------------------------------------------------------------------ */

  var _grainTile = null;

  /**
   * FX.grain(canvas, o) — one-time setup + static draw.
   * A fixed 160×160 noise tile (seeded), drawn tiled at low alpha.
   * The pattern NEVER animates: still frames stay still, no boil.
   * o: { seed, alpha, tile }
   */
  FX.grain = function (canvas, o) {
    o = o || {};
    var seed = o.seed == null ? 7 : o.seed;
    var alpha = o.alpha == null ? 0.05 : o.alpha;
    var tile = o.tile || 160;
    if (!_grainTile) {
      _grainTile = document.createElement('canvas');
      _grainTile.width = _grainTile.height = tile;
      var g = _grainTile.getContext('2d');
      var img = g.createImageData(tile, tile);
      var r = KM.rng(seed);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.floor(r() * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    var ctx = canvas.getContext('2d');
    // Caller sizes the canvas; we just stamp the tile.
    return function draw() {
      ctx.save();
      ctx.globalAlpha = alpha;
      var pat = ctx.createPattern(_grainTile, 'repeat');
      ctx.fillStyle = pat;
      // Overlay-ish: grain reads best as soft-light; canvas has no
      // blend per-fill pre-composite, so plain alpha white noise it is.
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
  };

  /* ------------------------------------------------------------------ */
  /* vignette — one-time CSS vignette                                   */
  /* ------------------------------------------------------------------ */

  FX.vignette = function (el, o) {
    o = o || {};
    var strength = o.strength == null ? 0.42 : o.strength;
    var color = o.color || '0,0,0';
    el.style.background =
      'radial-gradient(ellipse at 50% 46%, rgba(' + color + ',0) 52%, ' +
      'rgba(' + color + ',' + strength + ') 100%)';
    el.style.pointerEvents = 'none';
  };

  /* ------------------------------------------------------------------ */
  /* scanlines — retro terminal texture                                 */
  /* ------------------------------------------------------------------ */

  FX.scanlines = function (el, o) {
    o = o || {};
    var gap = o.gap || 4, alpha = o.alpha == null ? 0.10 : o.alpha;
    el.style.background =
      'repeating-linear-gradient(0deg, rgba(0,0,0,' + alpha + ') 0 1px, transparent 1px ' + gap + 'px)';
    el.style.pointerEvents = 'none';
  };

  FX.version = 1;
  window.FX = FX;
})();
