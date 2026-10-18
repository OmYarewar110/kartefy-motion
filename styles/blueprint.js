/* ============================================================================
 * kartefy-motion · style: blueprint
 * Technical diagram / cyanotype aesthetic. Composes primitives:
 * KM.typeOn entrances, KM.morphRect transitions, blueprint grid background.
 *
 * Original code — composes km-core primitives in a new recipe.
 * ========================================================================== */
(function () {
  'use strict';
  var KM = window.KM;

  KM.defineStyle('blueprint', {
    /**
     * setup(stage, params) — blueprint grid background (CSS, static).
     * params: { gridColor, gridGap }
     */
    setup: function (stage, params) {
      params = params || {};
      var grid = document.createElement('div');
      var gap = params.gridGap || 72;
      var color = params.gridColor || 'rgba(255,255,255,0.09)';
      grid.style.cssText =
        'position:absolute;inset:0;z-index:0;pointer-events:none;' +
        'background-image:' +
        'linear-gradient(' + color + ' 1px, transparent 1px),' +
        'linear-gradient(90deg,' + color + ' 1px, transparent 1px);' +
        'background-size:' + gap + 'px ' + gap + 'px;';
      stage.appendChild(grid);

      // Corner registration marks — the drafting-table touch.
      var marks = document.createElement('div');
      marks.style.cssText =
        'position:absolute;inset:28px;z-index:0;pointer-events:none;border:2px solid ' + color + ';';
      stage.appendChild(marks);

      return {};
    },

    update: function (state, t) { /* static background: nothing per-frame */ },

    /**
     * enter(el, t, t0, params) — type-on entrance.
     * el must have data-text attribute (or textContent) to type.
     * params: { cps }
     */
    enter: function (el, t, t0, params) {
      params = params || {};
      var text = el.getAttribute('data-text') || el.textContent;
      if (!el._kmTyped || el._kmTyped !== text) {
        el.setAttribute('data-text', text);
        el._kmTyped = text;
      }
      var ty = KM.typeOn(t, t0, text, { cps: params.cps || 34 });
      // Preserve a trailing caret span if present.
      var caret = el.querySelector('.km-caret');
      el.textContent = ty.str;
      if (caret) { el.appendChild(caret); }
      else {
        var c = document.createElement('span');
        c.className = 'km-caret';
        c.textContent = '▊';
        c.style.opacity = '0.85';
        el.appendChild(c);
        caret = c;
      }
      caret.style.visibility = ty.caret ? 'visible' : 'hidden';
      el.style.visibility = t < t0 ? 'hidden' : 'visible';
    },

    /** captionOpts() — technical mono captions. */
    captionOpts: function () {
      return { dimOpacity: 0.5 };
    },

    /**
     * transition(el, t, t0, t1, params) — morphRect panel transition.
     * el: the panel element. params: { from: {x,y,w,h,r}, to: {...} }.
     * The panel visibly morphs into its next shape — the carry survivor.
     */
    transition: function (el, t, t0, t1, params) {
      params = params || {};
      if (!params.from || !params.to) return;
      var m = KM.morphRect(t, t0, t1, params.from, params.to, { curve: 'expoInOut' });
      el.style.left = m.x.toFixed(1) + 'px';
      el.style.top = m.y.toFixed(1) + 'px';
      el.style.width = m.w.toFixed(1) + 'px';
      el.style.height = m.h.toFixed(1) + 'px';
      el.style.borderRadius = m.r.toFixed(1) + 'px';
    }
  });
})();
