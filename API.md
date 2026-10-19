# kartefy-motion — API Reference

All public functions with input/output contracts. Pure functions are marked
**(pure)** — same inputs → same outputs, no I/O, safe to unit-test.

Conventions: times are **seconds** (float), word timings are **milliseconds**.
Angles in radians unless noted. All `KM.*` functions live in
`runtime/km-core.js` (works in Node via `require()` and in-page via `window.KM`).

---

## km-core — motion math

### Basics
| Function | Contract |
|---|---|
| `KM.clamp(v, lo, hi)` **(pure)** | Clamp `v` into `[lo, hi]`. |
| `KM.lerp(a, b, k)` **(pure)** | Linear interpolation. |
| `KM.seg(t, t0, t1)` **(pure)** | Progress of `t` in `[t0, t1]`, clamped 0→1. Returns 0/1 outside. |
| `KM.sstep(k)` / `KM.smoother(k)` **(pure)** | Smoothstep / smootherstep. |
| `KM.rng(seed)` | Returns a seeded PRNG function `() → [0,1)`. Same seed → same sequence. **Use instead of `Math.random()`.** |

### Easing
`KM.ease = { linear, sineIn, sineOut, sineInOut, cubicIn, cubicOut, cubicInOut, expoIn, expoOut, expoInOut, back, elastic, bounce, smoothstep, smootherstep }` — each `f(k)→[0,1]` **(pure)**.
`KM.resolveEase(e)` — string name or function → function (defaults `linear`).
`KM.t80(curveFn)` **(pure)** — fraction of duration before 80% distance covered. Use to *measure* curves instead of guessing by name.

### Interpolation
`KM.interp(t, inRange, outRange, {ease, extrapolate})` **(pure)** — piecewise easing across keyframes. `extrapolate`: `'clamp'` (default) \| `'extend'` \| `'identity'`.
`KM.interpColor(t, stops)` **(pure)** — `stops: [{t, color:'#rrggbb'}]` → `'rgb(r,g,b)'`.

### Spring (analytic, closed-form)
`KM.spring(tau, {zeta, omega, from, to})` **(pure)** — exact damped-oscillator solution, `tau` seconds since start. `zeta<1` bouncy, `=1` critical, `>1` sluggish. Unconditionally stable.
`KM.measureSpring({zeta, omega, from, to}, threshold=0.001)` **(pure)** — seconds until settled (for auto-timing).

### Spline & camera
`KM.spline(knots, t)` **(pure)** — Hermite through `{t,x,y}` knots → `[x, y]`.
`KM.camera(t, keys)` **(pure)** — `keys: [{t,x,y,zoom,rot,curve}]` → `{x,y,zoom,rot}`. Zoom interpolates in **log space**.
`KM.view(cam, {width, height, depth})` **(pure)** — canvas affine `[a,b,c,d,e,f]` for a depth layer (parallax).
`KM.chaseAhead(keys, lead=0.1)` **(pure)** — shift keys earlier for operator feel.
`KM.handFloat(t, amp=6)` **(pure)** — two-sine handheld drift `{x, y}`.
`KM.landingShake(t, tHit, {amp, decay, freq, seed})` **(pure)** — seeded decaying shake, exactly zero before `tHit`.

### Carry moves (transitions where the next beat grows out of this one)
| Function | Returns |
|---|---|
| `KM.morphRect(t, t0, t1, A, B, {curve})` | `{x,y,w,h,r}` — rect A→B interpolation |
| `KM.iris(t, t0, t1, cx, cy, {curve, maxR, width, height})` | `{r, covered, x, y}` — circle opens from subject |
| `KM.zoomThrough(t, t0, t1, target, {curve, width, height})` | `{s, tx, ty, matrix}` — log-space push; `matrix` is canvas/DOM-ready |
| `KM.hop(t, t0, t1, from, to, {height, curve})` | `{x, y, landed}` — arc; land with `KM.impact` |
| `KM.gather(t, t0, t1, items, to, {arc, spin, stagger, curve})` | `[{x,y,rot}]` — fanned arcs into a cluster |
| `KM.wordRise(t, t0, {zeta, omega, dist})` | `{op, y, s}` — opacity **leads** the spring |
| `KM.typeOn(t, t0, text, {cps, blinkHz})` | `{n, str, done, caret}` — terminal typing |
| `KM.impact(t, tHit, {decay, omega, squash})` | `{sx, sy, ring}` — squash + ring-out on landing |

All **(pure)**.

---

## km-runtime — `window.__km` contract

`KM.createScene({meta, render, ready, motion, track})` → `window.__km`
- `meta: {dur, fps?, width?, height?, cuts?, seed?}` — `dur` required, seconds.
- `render(t)` — **must be pure in `t`**; set EVERY animated property every call.
- `ready()` — optional async warmup (runs once before frame 0).
- `motion(t0, t1)` — optional px-travel estimate for the blur planner (default `0`).
- `track(t)` — optional `[{id,x,y,w,h,opacity}]` for the carry oracle.

`KM.onFrame(el, fn)` — helper: returns `t => fn(el, t)`.

---

## km-captions — TikTok karaoke (in-page)

`KM.createCaptions(container, data, opts)` → `{update(t), pages, elements}`
- `data: {pages: [{startMs, endMs, tokens: [{text, fromMs, toMs}]}]}`
- `opts: {look?, zone?, maxLines?, dimOpacity?}` — `zone` defaults to 9:16 lower third `{x:90, y:1190, w:900}`.
- `update(t)` is seek-pure: shows the live page, highlights the active word (scale pop + accent + pill), dims the rest.

## km-fx — effects (in-page)

`FX.rngFor(seed, idx)` **(pure)** — per-element RNG stream (boilSeed isolation).
`FX.glitch(el, t, t0, t1, intensity=0.7, seed=11)` — RGB-split + slice displacement; restores `el` exactly outside `[t0,t1)`.
`FX.createParticles(canvas, opts)` → `update(t)` — seeded canvas particles; `opts: {n, seed, area, size, colors, vy, vx, life, alpha}`.
`FX.glow(el, t, {level, color, x, y, r})` — radial light-leak punctuation.
`FX.kineticType(container, t, t0, words, {stagger, zeta, omega, dist, style})` — word-stagger entrances.
`FX.grain(canvas, {seed, alpha, tile})` → `draw()` — **fixed** noise pattern (stills stay still).
`FX.vignette(el, {strength, color})`, `FX.scanlines(el, {gap, alpha})` — one-time setups.

## km-styles — style plugins (in-page)

`KM.defineStyle(name, def)`, `KM.getStyle(name)`, `KM.listStyles()`, `KM.Styles` (registry alias).
`KM.applyLook(look)` — set `--km-*` CSS vars + `window.KM_LOOK`.
`KM.runStyle(name, stage, params)` → `{update(t), style, state}`.
Style module shape: `{setup(stage,params)→state, update(state,t), enter(el,t,t0,params), captionOpts()→opts, transition(...)}` — all seek-pure. See STYLE-GUIDE.md.

---

## lib/km-engine.js (Node)

`renderScene(opts)` → `Promise<{frames, fps, dur, width, height, out, blur, dedupHits}>`
- Required: `scenePath`, `out`. Validated with helpful errors.
- Options: `fps` (30), `width`/`height` (1080/1920), `crf` (18), `jpegQuality` (92),
  `blur` (false), `blurSamples` (8), `look` (name|path), `style` (name|path),
  `onProgress(n,total)`.
- `style` implies its `look`; explicit `look` overrides.
- Throws with `fix:` hints on bad input.

`resolveLook(nameOrPath)`, `resolveStyle(nameOrPath)`, `inlineLook(html, look)` — exported for tooling.

## lib/km-blur.js (Node, pure)

`planBlur({t, fps, motionPx, cuts, maxSamples, dur})` → `{subTimes, samples, blurred, reason}` — validated inputs; `reason`: `'still'` | `'motion'` | `'cut-side'`.
`blurFilter(K)` → FFmpeg `-vf` string: `tmix` sliding-average of K sub-frames + `select` decimation to N non-overlapping group averages + `setpts` re-time (v0.2.1: tmix alone does NOT collapse groups — select is required, else EPIPE).
`expandCaptures(buffers, K)` → pads a short group to exactly K by repeating the last.

## lib/km-caption-plan.js (Node, pure)

`groupPages(words, {combineMs=2400, silenceBreakMs=700, maxWords=6, minWords=2})` → `{words, pages}` — validated word tokens.
`normalizeInput(data)` — accepts `{words:[...]}`, `{pages:[...]}`, or a bare array.

## lib/km-audio.js (Node)

`mixAudio({vo, music:{file,gainDb}, sfx:[{file,at,gainDb}], out, dur, lufs=-16, duckDb=-12, sr=48000})` → `Promise<{out, dur}>` — validates all files exist; VO-ducked music via sidechain; `-16 LUFS` master; exact duration.
`mux({video, audio, out})` → `Promise<{out}>` — stream-copy video + AAC audio.
`buildFilter(o)` → `{inputs, filter, map}` — the filter graph (for inspection).

## CLI — `bin/kmotion`

```
kmotion render <scene.html> [--fps 30] [--out reel.mp4] [--width 1080]
        [--height 1920] [--crf 18] [--blur] [--blur-samples 8]
        [--look NAME] [--style NAME] [--json]
kmotion caption <video.mp4> --words words.json [--out out.mp4]
        [--font font.ttf] [--look NAME] [--json]
kmotion looks list [--json]
kmotion styles list [--json]
```
`--json` prints one JSON object to stdout (logs → stderr). Exit codes: `0` ok, `1` error, `2` quality-gate fail.
