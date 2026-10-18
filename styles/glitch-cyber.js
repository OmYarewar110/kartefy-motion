/* ============================================================================
 * kartefy-motion · style: glitch-cyber
 * Neon glitch aesthetic. Composes primitives: FX.glitch entrances,
 * KM.iris transitions, FX particles + scanlines + glow background.
 *
 * Original code — composes km-core / km-fx primitives in a new recipe.
 * ========================================================================== */
(function () {
  'use strict';
  var KM = window.KM;
  var FX = window.FX;

  KM.defineStyle('glitch-cyber', {
    /**
     * setup(stage, params) — build persistent background layers once.
     * params: { seed, particleColors, scanlineAlpha, glowColor }
     */
    setup: function (stage, params) {
      params = params || {};
      var seed = params.seed == null ? 7 : params.seed;

      var glowEl = document.createElement('div');
      glowEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;';
      stage.appendChild(glowEl);

      var pCanvas = document.createElement('canvas');
      pCanvas.width = 1080; pCanvas.height = 1920;
      pCanvas.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
      stage.appendChild(pCanvas);
      var updateParticles = FX.createParticles(pCanvas, {
        n: 60, seed: seed,
        colors: params.particleColors || ['#00F0FF', '#B537F2', '#E8F1FF'],
        vy: [-90, -25], size: [2, 6], alpha: [0.25, 0.7]
      });

      var scanEl = document.createElement('div');
      scanEl.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none;';
      stage.appendChild(scanEl);
      FX.scanlines(scanEl, { alpha: params.scanlineAlpha == null ? 0.10 : params.scanlineAlpha });

      return { glowEl: glowEl, updateParticles: updateParticles, seed: seed,
               glowColor: params.glowColor || '0,240,255' };
    },

    /** update(state, t) — per-frame background life. */
    update: function (state, t) {
      FX.glow(state.glowEl, t, {
        level: 0.5 + 0.22 * Math.sin(2 * Math.PI * 0.13 * t),
        color: state.glowColor, r: 1000, x: 50, y: 38
      });
      state.updateParticles(t);
    },

    /**
     * enter(el, t, t0, params) — glitch-in entrance for one element.
     * The element tears in over ~0.32s, then sits clean. Seek-pure:
     * before t0 it's hidden; after the glitch window FX.glitch restores it.
     */
    enter: function (el, t, t0, params) {
      params = params || {};
      var settle = (params.settleMs || 320) / 1000;
      if (t < t0) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      FX.glitch(el, t, t0, t0 + settle,
                params.intensity == null ? 0.85 : params.intensity,
                params.seed == null ? 7 : params.seed);
    },

    /** captionOpts() — karaoke pill styling for this aesthetic. */
    captionOpts: function () {
      return { dimOpacity: 0.38 };
    },

    /**
     * transition(layer, t, t0, t1, params) — iris wipe.
     * layer: full-screen incoming scene div. params: {cx, cy}.
     */
    transition: function (layer, t, t0, t1, params) {
      params = params || {};
      var iris = KM.iris(t, t0, t1, params.cx == null ? 540 : params.cx,
                         params.cy == null ? 960 : params.cy,
                         { width: 1080, height: 1920, curve: 'expoInOut' });
      if (t < t0) { layer.style.display = 'none'; return; }
      layer.style.display = 'block';
      var R = Math.ceil(iris.r);
      var mask = 'radial-gradient(circle ' + R + 'px at ' +
                 (params.cx == null ? 540 : params.cx) + 'px ' +
                 (params.cy == null ? 960 : params.cy) + 'px, black ' + R + 'px, transparent ' + (R + 2) + 'px)';
      layer.style.webkitMaskImage = mask;
      layer.style.maskImage = mask;
    }
  });
})();
