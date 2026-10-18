/* ============================================================================
 * kartefy-motion · km-blur
 * Sub-frame motion blur by reseeking (Node side, pure planning + filters).
 *
 * Technique (from the design doc §3.1 #6): for each output frame, the engine
 * re-seeks the composition at K sub-times spread across the shutter window
 * (180° shutter = half a frame interval), then averages the K captures with
 * FFmpeg's tmix. A true temporal integral, not a blur filter.
 * (Linear-light averaging via zscale was tried but zscale's transfer path
 * is missing from this FFmpeg build, so we average in gamma space —
 * perceptually fine for motion blur.)
 *
 * Cut-side detection: if a declared cut (from __km.meta.cuts) falls inside
 * the shutter window, only the sub-captures on the frame-time's side of the
 * cut are averaged — never integrate across a hard cut (that would smear
 * two unrelated scenes together).
 *
 * All functions here are pure (no I/O) so they can be unit-tested.
 * ========================================================================== */
'use strict';

var SHUTTER_ANGLE = 180;      // degrees; 180° = expose for half the frame interval
var MAX_SAMPLES = 16;        // hard cap on sub-captures per frame
var PX_PER_SAMPLE = 4;       // aim: neighboring copies ≤ 4px apart
var MOTION_FLOOR_PX = 2;     // below this, skip blur entirely (K = 1)

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * planBlur({ t, fps, motionPx, cuts, maxSamples, dur }) → plan
 *
 * t          — nominal frame time (seconds)
 * fps        — frames per second
 * motionPx   — __km.motion(t - w/2, t + w/2): farthest on-screen travel (px)
 * cuts       — sorted array of declared cut times (seconds) from meta.cuts
 * maxSamples — cap on K (default 8; hard cap 16)
 * dur        — composition duration (clamp sub-times into [0, dur])
 *
 * Returns { subTimes: [t0..tK-1], samples: K, blurred: bool, reason }.
 * blurred=false means "single capture is fine" (subTimes = [t]).
 */
function planBlur(o) {
  o = o || {};
  // ---- validation (clear errors, not cryptic crashes) ----
  if (typeof o.t !== 'number' || isNaN(o.t) || o.t < 0) {
    throw new Error(`km-blur.planBlur: 't' must be a non-negative number (seconds), got ${JSON.stringify(o.t)}`);
  }
  if (o.fps != null && (!(o.fps > 0) || o.fps > 240)) {
    throw new Error(`km-blur.planBlur: 'fps' must be 1-240, got ${JSON.stringify(o.fps)}`);
  }
  if (o.motionPx != null && (typeof o.motionPx !== 'number' || o.motionPx < 0)) {
    throw new Error(`km-blur.planBlur: 'motionPx' must be a non-negative number, got ${JSON.stringify(o.motionPx)}`);
  }
  if (o.cuts != null && !Array.isArray(o.cuts)) {
    throw new Error(`km-blur.planBlur: 'cuts' must be an array of seconds, got ${typeof o.cuts}`);
  }
  var t = o.t, fps = o.fps || 30;
  var motionPx = o.motionPx || 0;
  var cuts = (o.cuts || []).slice().sort(function (a, b) { return a - b; });
  var maxSamples = clamp(o.maxSamples || 8, 1, MAX_SAMPLES);
  var dur = o.dur != null ? o.dur : Infinity;

  var frameInt = 1 / fps;
  var window = frameInt * (SHUTTER_ANGLE / 360); // 180° → frameInt / 2
  var w0 = t - window / 2, w1 = t + window / 2;

  // Find cuts inside the shutter window.
  var cutInWindow = null;
  for (var i = 0; i < cuts.length; i++) {
    if (cuts[i] > w0 && cuts[i] < w1) { cutInWindow = cuts[i]; break; }
  }

  // How many samples? Enough that copies are ≤ PX_PER_SAMPLE apart.
  var K = 1;
  if (motionPx >= MOTION_FLOOR_PX) {
    K = clamp(Math.ceil(motionPx / PX_PER_SAMPLE) + 1, 2, maxSamples);
  }

  if (K <= 1 && cutInWindow == null) {
    return { subTimes: [clamp(t, 0, dur)], samples: 1, blurred: false, reason: 'still' };
  }

  // Evenly spaced sub-times across the window.
  function linspace(a, b, n) {
    var out = [];
    if (n === 1) return [clamp(t, 0, dur)];
    for (var j = 0; j < n; j++) out.push(clamp(a + (b - a) * (j / (n - 1)), 0, dur));
    return out;
  }

  var subTimes;
  if (cutInWindow != null) {
    // One-sided: keep only the sub-times on t's side of the cut.
    var all = linspace(w0, w1, K);
    var keepPast = t >= cutInWindow;
    subTimes = all.filter(function (st) {
      return keepPast ? st >= cutInWindow : st < cutInWindow;
    });
    // Guard: never end up empty (t exactly on the cut → take the new side).
    if (!subTimes.length) subTimes = [clamp(cutInWindow, 0, dur)];
    return {
      subTimes: subTimes, samples: subTimes.length,
      blurred: subTimes.length > 1, reason: 'cut-side',
      cut: cutInWindow
    };
  }

  subTimes = linspace(w0, w1, K);
  return { subTimes: subTimes, samples: K, blurred: K > 1, reason: K > 1 ? 'motion' : 'still' };
}

/**
 * blurFilter(K, { linear }) → FFmpeg -vf string.
 *
 * Averages K consecutive frames via tmix. o.linear=true requests linear-
 * light averaging (zscale transfer), but zscale's transfer path is missing
 * from many FFmpeg builds ("no path between colorspaces"), so the default
 * is gamma-space tmix — perceptually fine for motion blur, works everywhere.
 *
 * The engine pipes N*K sub-frames; this filter collapses each group of K
 * into one output frame → N frames out.
 */
function blurFilter(K, o) {
  o = o || {};
  if (!K || K <= 1) return null;
  return 'tmix=frames=' + K + ',format=yuv420p';
}

/**
 * expandCaptures(buffers, plan) → buffers
 *
 * The engine captures one JPEG per sub-time. When a plan has fewer real
 * sub-times than the stream's fixed K (e.g. cut-side kept 3 of 8), the
 * remaining slots are filled by repeating the nearest real capture so the
 * tmix group always has exactly K frames. Pure array op.
 */
function expandCaptures(buffers, K) {
  if (buffers.length >= K) return buffers.slice(0, K);
  var out = buffers.slice();
  var last = buffers[buffers.length - 1];
  while (out.length < K) out.push(last);
  return out;
}

module.exports = {
  planBlur: planBlur,
  blurFilter: blurFilter,
  expandCaptures: expandCaptures,
  SHUTTER_ANGLE: SHUTTER_ANGLE,
  MAX_SAMPLES: MAX_SAMPLES
};
