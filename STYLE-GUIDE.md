# kartefy-motion — Style Guide
## How to create a NEW animation style

A **style** is a named animation recipe: it bundles a visual look (colors +
type) with a choreography (how things enter, transition, caption, and move).
Styles are **data + small modules, not core changes**. Adding a style never
touches `km-core.js`, `km-engine.js`, or the CLI.

---

## 1. The two files

Every style is two files in `styles/`:

```
styles/
  my-style.json    ← descriptor: tokens, choreography recipe, params
  my-style.js      ← in-page module: setup/update/enter/captionOpts/transition
```

### 1a. The JSON descriptor (`styles/my-style.json`)

```json
{
  "name": "my-style",
  "description": "One line: what it looks like + what topics it fits.",
  "look": "cyber",
  "choreography": {
    "entrance": "word-rise",
    "entranceParams": { "stagger": 0.11, "zeta": 0.58 },
    "transition": "zoom-through",
    "transitionParams": { "curve": "expoInOut" },
    "captionStyle": "karaoke-pill",
    "background": "particles",
    "camera": "push-in",
    "effects": ["glow", "grain"]
  },
  "params": {
    "seed": 21,
    "particleColors": ["#FF3B30", "#FFD60A"]
  }
}
```

| Field | Meaning |
|---|---|
| `name` | Must match the filenames. Lowercase, hyphens. |
| `description` | Human + agent readable: look + best topics. |
| `look` | Token look from `looks/` (colors + type). Omit to require `--look`. |
| `choreography` | The recipe — which primitives, in which roles. Free-form but SHOULD name real primitives (see §3). |
| `params` | Default parameters passed to your module's `setup()` / `enter()`. |

### 1b. The JS module (`styles/my-style.js`)

```js
(function () {
  'use strict';
  var KM = window.KM;   // motion primitives (always available)
  var FX = window.FX;   // effects (loaded automatically with --style)

  KM.defineStyle('my-style', {
    // Called ONCE. Build persistent background layers here.
    // stage: the #stage div. params: merged (json.params + scene overrides).
    // Must be seek-pure: same params → same DOM.
    setup: function (stage, params) {
      var bg = document.createElement('div');
      bg.style.cssText = 'position:absolute;inset:0;z-index:0;';
      stage.appendChild(bg);
      return { bg: bg };            // state passed to update()
    },

    // Called EVERY frame with absolute time t. Pure function of t.
    update: function (state, t) {
      state.bg.style.opacity = (0.5 + 0.2 * Math.sin(t)).toFixed(3);
    },

    // Entrance for ONE element. Scene authors loop with stagger.
    // Before t0: hide it (opacity 0 + visibility hidden). After: animate in.
    enter: function (el, t, t0, params) {
      if (t < t0) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      var wr = KM.wordRise(t, t0, { zeta: 0.6, omega: 13, dist: 80 });
      el.style.opacity = wr.op.toFixed(3);
      el.style.transform = 'translateY(' + wr.y.toFixed(2) + 'px)';
    },

    // Caption styling overrides (merged into KM.createCaptions opts).
    captionOpts: function () {
      return { dimOpacity: 0.4 };
    },

    // Beat transition. Signature depends on the choreography:
    // layer-based (iris/morphRect) OR camera-based (zoomThrough).
    transition: function (layer, t, t0, t1, params) {
      var iris = KM.iris(t, t0, t1, 540, 960, { width: 1080, height: 1920 });
      layer.style.display = t < t0 ? 'none' : 'block';
      var R = Math.ceil(iris.r);
      layer.style.webkitMaskImage =
        'radial-gradient(circle ' + R + 'px at 540px 960px, black ' + R + 'px, transparent ' + (R + 2) + 'px)';
    }
  });
})();
```

**Rules for the module:**
1. **Seek-pure.** Every function must return the same result for the same `t`. No `Date.now()`, no `Math.random()` — use `KM.rng(seed)` / `FX.rngFor(seed, i)`.
2. **No network.** All assets must exist before `ready()`.
3. **Restore after.** If `enter()` mutates an element (e.g. `FX.glitch`), it must restore the element exactly when outside its window.
4. **z-index discipline.** Background layers: z 0–2. Content: z 10+. Captions: z 30+. Grain/vignette: z 40+.

---

## 2. Using your style

```bash
# Render with the style (loads its look + module automatically)
./bin/kmotion render scene.html --style my-style --out reel.mp4

# With motion blur
./bin/kmotion render scene.html --style my-style --blur --out reel.mp4

# Override the look but keep the choreography
./bin/kmotion render scene.html --style my-style --look midnight --out reel.mp4
```

In the scene HTML, use the style explicitly:

```html
<script src="/__km/km-core.js"></script>
<script src="/__km/km-runtime.js"></script>
<script src="/__km/km-styles.js"></script>
<script src="/__km/km-fx.js"></script>
<script src="/__styles/my-style.js"></script>
<script>
  var ctl = KM.runStyle('my-style', document.getElementById('stage'), { seed: 5 });
  var style = KM.getStyle('my-style');
  KM.createScene({
    meta: { dur: 10 },
    render: function (t) {
      ctl.update(t);                       // background life
      style.enter(document.getElementById('title'), t, 0.5, {});
    }
  });
</script>
```

(`--style` injects the `<script>` tags automatically, so the explicit
`<script src>` lines are optional when rendering via CLI.)

---

## 3. The primitive palette (compose these)

**Entrances** (`KM.*`): `wordRise` (opacity leads spring), `typeOn` (terminal),
`FX.glitch` (tear-in). **Transitions:** `morphRect`, `iris`, `zoomThrough`,
`hop` + `impact`, `gather`. **Camera:** `KM.camera` (log-space zoom),
`KM.handFloat`, `KM.landingShake`, `KM.chaseAhead`. **Effects** (`FX.*`):
`glitch`, `createParticles` (boilSeed-isolated), `glow`, `kineticType`,
`grain` (fixed pattern), `vignette`, `scanlines`. **Easing** (`KM.ease.*`):
pick by measured `KM.t80`, not by name.

A novel style = a novel **combination** + tuned parameters. The three
bundled styles prove the range:

| Style | Entrance | Transition | Background | For |
|---|---|---|---|---|
| `glitch-cyber` | glitch-in | iris | particles + scanlines | hacking, infosec |
| `blueprint` | type-on | morphRect | blueprint grid | explainers, architecture |
| `kinetic-type` | word-rise | zoomThrough | breathing shapes | hooks, announcements |

---

## 4. Checklist before shipping a style

- [ ] `styles/<name>.json` + `styles/<name>.js` exist, names match.
- [ ] JSON has `name`, `description`, `look`, `choreography`, `params`.
- [ ] Module calls `KM.defineStyle('<name>', {...})` exactly once.
- [ ] All functions seek-pure (test: `seek(3)` → `seek(1)` → `seek(3)` identical).
- [ ] `enter()` hides before `t0` and restores after its window.
- [ ] No `Math.random()` / `Date.now()` anywhere in the module.
- [ ] `kmotion styles list` shows it with a description.
- [ ] Rendered a 5s test with `--style <name>` and eyeballed 3 frames.
