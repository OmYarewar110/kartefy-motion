/* ============================================================================
 * kartefy-motion · km-styles
 * Extensible animation style system (in-page runtime).
 *
 * A STYLE is a named composition recipe: it bundles a token look with a
 * choreography — which entrance, which transition, which caption treatment,
 * which background, which camera grammar, which effects. Styles are DATA
 * (JSON descriptor) + a small JS module (primitive compositions), never
 * hardcoded in the core.
 *
 *   KM.defineStyle(name, def) — register a style module
 *   KM.getStyle(name)         — look up a registered style
 *   KM.applyLook(look)        — apply token look as CSS vars + KM_LOOK
 *   KM.listStyles()           — registered names
 *
 * A style module's shape:
 *   {
 *     describe:  () => ({...json descriptor...}),  // optional
 *     setup:     (stage, params) => state,         // once: build bg layers
 *     update:    (state, t) => void,               // every frame
 *     enter:     (container, t, t0, words, params) => void, // text entrance
 *     exit:      (container, t, t1, params) => void,        // text exit
 *     captionOpts: () => ({...}),                  // caption overrides
 *     transition:(from, to, t, t0, t1, params) => void     // beat transition
 *   }
 * All functions must be seek-pure (pure functions of t).
 *
 * Requires: km-core.js loaded first (window.KM). km-fx.js optional
 * (styles that use effects should check window.FX exists).
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var KM = window.KM;
  if (!KM) throw new Error('km-styles: km-core.js (window.KM) must load first.');

  var registry = {};

  /** Register a style module. */
  KM.defineStyle = function (name, def) {
    if (!name || !def) throw new Error('km-styles: defineStyle needs (name, def)');
    registry[name] = def;
  };

  /** Look up a style module; throws with a helpful message when missing. */
  KM.getStyle = function (name) {
    var s = registry[name];
    if (!s) {
      throw new Error('km-styles: unknown style "' + name + '". ' +
        'Registered: ' + Object.keys(registry).join(', '));
    }
    return s;
  };

  KM.listStyles = function () { return Object.keys(registry); };

  /**
   * Apply a token look: set --km-* CSS vars on :root and publish
   * window.KM_LOOK for JS (km-captions reads colors from it).
   * look: { colors: {bg, ink, ...}, type: {display, body, mono} }
   */
  KM.applyLook = function (look) {
    if (!look) return;
    var root = document.documentElement;
    var colors = look.colors || {};
    for (var k in colors) {
      if (Object.prototype.hasOwnProperty.call(colors, k)) {
        root.style.setProperty('--km-' + k, colors[k]);
      }
    }
    var type = look.type || {};
    if (type.display) root.style.setProperty('--km-font-display', type.display);
    if (type.body) root.style.setProperty('--km-font-body', type.body);
    if (type.mono) root.style.setProperty('--km-font-mono', type.mono);
    window.KM_LOOK = look;
  };

  /**
   * Convenience: run a style's full beat — setup once, then update.
   * Returns { update(t) }.
   */
  KM.runStyle = function (name, stage, params) {
    var style = KM.getStyle(name);
    var state = style.setup ? style.setup(stage, params || {}) : {};
    return {
      update: function (t) { if (style.update) style.update(state, t); },
      style: style,
      state: state
    };
  };

  KM.Styles = registry; // alias
})();
