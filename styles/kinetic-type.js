/* ============================================================================
 * kartefy-motion · style: kinetic-type
 * Bold kinetic typography. Composes primitives: KM.wordRise entrances
 * (opacity leads the spring), KM.zoomThrough transitions, FX glow accents.
 *
 * Original code — composes km-core / km-fx primitives in a new recipe.
 * ========================================================================== */
(function () {
  'use strict';
  var KM = window.KM;
  var FX = window.FX;

  KM.defineStyle('kinetic-type', {
    /**
     * setup(stage, params) — bold geometric accent shapes + glow.
     * params: { seed, shapeColors, glowColor }
     */
    setup: function (stage, params) {
      params = params || {};
      var seed = params.seed == null ? 21 : params.seed;
      var rng = KM.rng(seed);
      var colors = params.shapeColors || ['#FF3B30', '#FFD60A', '#FFFFFF'];

      // A few oversized soft shapes drifting behind the type.
      var shapes = [];
      for (var i = 0; i < 3; i++) {
        var d = document.createElement('div');
        var sz = 380 + rng() * 320;
        d.style.cssText =
          'position:absolute;z-index:0;pointer-events:none;' +
          'width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;' +
          'left:' + (rng() * 700 - 100) + 'px;top:' + (rng() * 1400 + 100) + 'px;' +
          'background:radial-gradient(circle,' + colors[i % colors.length] + '22 0%,transparent 65%);';
        stage.appendChild(d);
        shapes.push({ el: d, ph: rng() * 6.283, sp: 0.1 + rng() * 0.15 });
      }

      var glowEl = document.createElement('div');
      glowEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;';
      stage.appendChild(glowEl);

      return { shapes: shapes, glowEl: glowEl,
               glowColor: params.glowColor || '255,59,48' };
    },

    /** update(state, t) — shapes breathe, glow pulses. */
    update: function (state, t) {
      for (var i = 0; i < state.shapes.length; i++) {
        var s = state.shapes[i];
        var k = 1 + 0.08 * Math.sin(2 * Math.PI * s.sp * t + s.ph);
        s.el.style.transform = 'scale(' + k.toFixed(4) + ')';
      }
      FX.glow(state.glowEl, t, {
        level: 0.35 + 0.15 * Math.sin(2 * Math.PI * 0.2 * t + 1),
        color: state.glowColor, r: 800, x: 50, y: 30
      });
    },

    /**
     * enter(el, t, t0, params) — wordRise slam for one element.
     * Opacity LEADS the spring so it lands, never fades.
     * params: { zeta, omega, dist }
     */
    enter: function (el, t, t0, params) {
      params = params || {};
      if (t < t0) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      var wr = KM.wordRise(t, t0, {
        zeta: params.zeta == null ? 0.58 : params.zeta,
        omega: params.omega == null ? 13 : params.omega,
        dist: params.dist == null ? 90 : params.dist
      });
      el.style.opacity = wr.op.toFixed(3);
      el.style.transform =
        'translateY(' + wr.y.toFixed(2) + 'px) scale(' + wr.s.toFixed(4) + ')';
    },

    /** captionOpts() — big aggressive words. */
    captionOpts: function () {
      return { dimOpacity: 0.35 };
    },

    /**
     * transition(cam, t, t0, t1, params) — zoomThrough camera punch.
     * Unlike the other styles, this transition drives the CAMERA, not a
     * layer: params: { target: {x,y,w,h}, apply(matrix) }.
     * The scene passes an apply() that writes the matrix to its world div.
     */
    transition: function (cam, t, t0, t1, params) {
      params = params || {};
      if (!params.target || !params.apply) return;
      var z = KM.zoomThrough(t, t0, t1, params.target,
                             { width: 1080, height: 1920, curve: 'expoInOut' });
      params.apply(z.matrix);
    }
  });
})();
