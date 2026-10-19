/* ============================================================================
 * kartefy-motion · km-captions
 * TikTok-style word-highlight captions — first-class, not bolted on.
 *
 *   KM.createCaptions(container, data, opts) → { update(t), pages }
 *
 * data : { pages: [{ startMs, endMs, tokens: [{text, fromMs, toMs}] }] }
 * opts : {
 *   look      — token object { colors: {ink, accent, ...}, type: {...} }
 *               (falls back to window.KM_LOOK, then built-in defaults),
 *   zone      — { x, y, w } caption zone in px (default: 9:16 lower third),
 *   maxLines  — default 3,
 *   dimOpacity— inactive word opacity (default 0.42),
 *   strokePx  — outline width in px for readability (default 3, 0 = off)
 * }
 *
 * update(t) is SEEK-PURE: given the same t it always shows the same page
 * with the same active word. The active word gets the karaoke treatment
 * (scale pop + accent color + pill background); inactive words dim.
 *
 * Requires: km-core.js loaded first (window.KM).
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var KM = window.KM;
  if (!KM) throw new Error('km-captions: km-core.js (window.KM) must load first.');

  var DEFAULTS = {
    colors: {
      ink: '#F2F5FA',        // base caption text
      accent: '#FFD60A',     // active word
      pill: 'rgba(0,0,0,0.55)',
      stroke: '#000000',     // outline color (readability over any bg)
      dim: null              // computed from ink at dimOpacity
    },
    type: { display: 'Inter, system-ui, sans-serif' },
    strokePx: 3              // outline width in px
  };

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  KM.createCaptions = function (container, data, opts) {
    opts = opts || {};
    var look = opts.look || window.KM_LOOK || {};
    var colors = {};
    var dc = DEFAULTS.colors, lc = look.colors || {};
    for (var k in dc) colors[k] = lc[k] != null ? lc[k] : dc[k];
    var dimOpacity = opts.dimOpacity == null ? 0.42 : opts.dimOpacity;
    var inkRgb = hexToRgb(colors.ink);
    colors.dim = 'rgba(' + inkRgb[0] + ',' + inkRgb[1] + ',' + inkRgb[2] + ',' + dimOpacity + ')';

    // 9:16 lower-third zone: y ∈ [1190, 1690] on a 1080×1920 canvas.
    var zone = opts.zone || { x: 90, y: 1190, w: 900 };
    var pages = (data && data.pages) || [];

    container.style.position = 'absolute';
    container.style.left = zone.x + 'px';
    container.style.top = zone.y + 'px';
    container.style.width = zone.w + 'px';
    container.style.textAlign = 'center';
    container.style.pointerEvents = 'none';
    container.style.zIndex = 50;

    var fontFamily = (look.type && look.type.display) || DEFAULTS.type.display;

    // Readability outline: 8-direction stroke via stacked text-shadows
    // (robust in Chromium; -webkit-text-stroke eats into glyphs).
    // Plus a soft drop shadow for separation from busy backgrounds.
    var strokePx = opts.strokePx != null ? opts.strokePx : DEFAULTS.strokePx;
    var strokeColor = colors.stroke || DEFAULTS.colors.stroke;
    var outlineShadows = [];
    if (strokePx > 0) {
      for (var a = 0; a < 8; a++) {
        var ang = a * Math.PI / 4;
        outlineShadows.push(
          Math.round(Math.cos(ang) * strokePx) + 'px ' +
          Math.round(Math.sin(ang) * strokePx) + 'px 0 ' + strokeColor);
      }
    }
    outlineShadows.push('0 6px 18px rgba(0,0,0,0.45)');
    var outline = outlineShadows.join(', ');

    // Build one absolutely-stacked page div per page; only the live one
    // is visible. Tokens are inline-block spans so the active word can
    // scale without reflowing its neighbors.
    var pageEls = pages.map(function (pg) {
      var pd = document.createElement('div');
      pd.className = 'km-cap-page';
      pd.style.display = 'none';
      pd.style.fontFamily = fontFamily;
      pd.style.fontWeight = '800';
      pd.style.lineHeight = '1.28';
      pd.style.letterSpacing = '-1px';
      // Fit: measured once at build (deterministic — same DOM, same measure).
      // Binary-search on the LONGEST page only (one probe, ~7 reflows),
      // then apply the winning size to every page.
      pd.style.fontSize = '64px';
      var spans = pg.tokens.map(function (tk) {
        var s = document.createElement('span');
        s.className = 'km-cap-word';
        s.textContent = tk.text;
        s.style.display = 'inline-block';
        s.style.margin = '0 10px';
        s.style.padding = '2px 6px';
        s.style.borderRadius = '12px';
        s.style.color = colors.dim;
        s.style.textShadow = outline;
        s.style.willChange = 'transform, color, background';
        pd.appendChild(s);
        pd.appendChild(document.createTextNode(' '));
        return s;
      });
      container.appendChild(pd);

      pd.style.display = 'none';
      pd.style.visibility = 'visible';
      return { el: pd, spans: spans, pg: pg, fontPx: 64 };
    });

    // Auto-fit: binary-search the largest font size that fits the LONGEST
    // page, then apply to all. One probe = ~7 reflows total (not per page).
    // Runs once at build; deterministic (same DOM → same measure).
    if (pageEls.length) {
      // Page text for "longest" comparison (pg.text if provided, else join tokens).
      var pageText = function (pg) {
        if (pg.text) return pg.text;
        return (pg.tokens || []).map(function (tk) { return tk.text || ''; }).join(' ');
      };
      var longest = pageEls.reduce(function (a, b) {
        return (pageText(b.pg).length > pageText(a.pg).length) ? b : a;
      }, pageEls[0]);
      var probe = longest.el;
      probe.style.display = 'block';
      probe.style.visibility = 'hidden';
      var lo = 30, hi = 96, guard = 0;
      while (lo < hi && guard++ < 32) {
        var mid = Math.ceil((lo + hi) / 2);
        probe.style.fontSize = mid + 'px';
        if (probe.scrollWidth <= zone.w && probe.scrollHeight <= 3 * mid * 1.28) lo = mid;
        else hi = mid - 1;
      }
      probe.style.display = 'none';
      probe.style.visibility = 'visible';
      for (var fi = 0; fi < pageEls.length; fi++) {
        pageEls[fi].el.style.fontSize = lo + 'px';
        pageEls[fi].fontPx = lo;
      }
    }

    var livePage = -1;

    function setActive(pageIdx, tokenIdx) {
      for (var p = 0; p < pageEls.length; p++) {
        var pe = pageEls[p];
        var on = (p === pageIdx);
        pe.el.style.display = on ? 'block' : 'none';
        if (!on) continue;
        for (var s = 0; s < pe.spans.length; s++) {
          var sp = pe.spans[s];
          if (s === tokenIdx) {
            sp.style.color = colors.accent;
            sp.style.background = colors.pill;
            sp.style.transform = 'scale(1.18)';
          } else {
            sp.style.color = colors.dim;
            sp.style.background = 'transparent';
            sp.style.transform = 'scale(1)';
          }
        }
      }
    }

    function update(t) {
      var ms = t * 1000;
      var pi = -1, ti = -1;
      for (var p = 0; p < pages.length; p++) {
        var pg = pages[p];
        if (ms >= pg.startMs && ms < pg.endMs) {
          pi = p;
          for (var s = 0; s < pg.tokens.length; s++) {
            var tk = pg.tokens[s];
            if (ms >= tk.fromMs && ms < tk.toMs) { ti = s; break; }
          }
          if (ti < 0) ti = pg.tokens.length - 1; // between words: hold last
          break;
        }
      }
      if (pi !== livePage || true) setActive(pi, ti);
      livePage = pi;
    }

    // Initial state: nothing visible (t < first page).
    update(-1);

    return { update: update, pages: pages, elements: pageEls };
  };
})();
