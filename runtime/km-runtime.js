/* ============================================================================
 * kartefy-motion · km-runtime
 * The in-page seek contract: window.__km.
 *
 * A composition includes km-core.js, then km-runtime.js, then calls
 * KM.createScene({...}) with its meta + a render(t) function. The runtime
 * wires up the contract the engine (km-engine) drives:
 *
 *   window.__km = {
 *     version : 1,
 *     meta    : { dur, fps, width, height, cuts?, seed? },
 *     ready   : async () => void,   // fonts decoded, images ready, sims warm
 *     seek    : async (t) => void,  // set EVERY visual to its state at time t
 *     motion  : (t0, t1) => px,     // farthest on-screen travel (blur hint)
 *     track   : (t) => [...]        // element boxes for the carry oracle
 *   }
 *
 * CONTRACT LAWS (enforced by construction here):
 *  1. Seek purity — seek(6.4) → seek(2.0) → seek(6.4) gives identical pixels.
 *     render(t) must be a pure function of t. No Date.now(), no Math.random().
 *  2. No wall clock anywhere in animation code. Time arrives as `t`.
 *  3. ready() runs once, before frame 0. After it resolves, no network.
 *
 * Requires: km-core.js loaded first (window.KM).
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return; // Node has no business here.
  var KM = window.KM;
  if (!KM) throw new Error('km-runtime: km-core.js (window.KM) must load first.');

  /**
   * KM.createScene(opts) → window.__km
   *
   * opts = {
   *   meta   : { dur, fps?, width?, height?, cuts?, seed? },
   *   render : function (t) — draw/update EVERYTHING for time t (may be async),
   *   ready  : async function () — optional extra warmup (sims, measurements),
   *   motion : function (t0, t1) → px — optional travel estimate (default 0),
   *   track  : function (t) → [{id,x,y,w,h,opacity}] — optional oracle data
   * }
   */
  KM.createScene = function (opts) {
    opts = opts || {};
    var meta = {
      dur: opts.meta && opts.meta.dur != null ? opts.meta.dur : 5,
      fps: (opts.meta && opts.meta.fps) || 30,
      width: (opts.meta && opts.meta.width) || 1080,
      height: (opts.meta && opts.meta.height) || 1920,
      cuts: (opts.meta && opts.meta.cuts) || [],
      seed: (opts.meta && opts.meta.seed) || 1
    };
    if (typeof opts.render !== 'function') {
      throw new Error('km-runtime: createScene needs a render(t) function.');
    }

    var readyPromise = null;

    // Readiness gate: fonts + images + user warmup, exactly once.
    function ready() {
      if (!readyPromise) {
        readyPromise = (async function () {
          // 1. Web fonts settled.
          try {
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
          } catch (e) { /* non-fatal */ }
          // 2. Every <img> decoded.
          try {
            var imgs = Array.prototype.slice.call(document.images || []);
            await Promise.all(imgs.map(function (im) {
              return (im.decode ? im.decode() : Promise.resolve()).catch(function () {});
            }));
          } catch (e) { /* non-fatal */ }
          // 3. Scene-specific warmup (precompute sims, measure layout).
          if (typeof opts.ready === 'function') await opts.ready();
        })();
      }
      return readyPromise;
    }

    // The heart of the contract: set the whole frame to time t, then
    // yield one animation frame so the browser paints before capture.
    // Seeking is REPEATABLE because render(t) is pure in t.
    async function seek(t) {
      var tc = KM.clamp(t, 0, meta.dur);
      await opts.render(tc);
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { resolve(); });
      });
    }

    window.__km = {
      version: 1,
      meta: meta,
      ready: ready,
      seek: seek,
      motion: typeof opts.motion === 'function' ? opts.motion : function () { return 0; },
      track: typeof opts.track === 'function' ? opts.track : function () { return []; }
    };
    return window.__km;
  };

  /**
   * KM.onFrame(el, fn) — tiny helper: run fn(t) to update one element.
   * Sugar only; scenes may also write raw DOM code in render(t).
   */
  KM.onFrame = function (el, fn) {
    return function (t) { fn(el, t); };
  };
})();
