# kartefy-motion

**Autonomous 9:16 short-form motion-graphics engine.** Script in,
broadcast-quality captioned reel out. Original code, deterministic rendering,
extensible animation styles.

```
1080×1920 · 30fps · seek-pure · motion blur · TikTok captions · carry moves
```

## 30-second quick-start (for agents)

```bash
cd ~/workspace/kartefy-motion

# 1. See what's available
./bin/kmotion looks list
./bin/kmotion styles list

# 2. Render the bundled demo (no arguments needed beyond the scene)
./bin/kmotion render demo/phase2-demo.html --out /tmp/my-reel.mp4 --style glitch-cyber

# 3. Burn karaoke captions into any video
./bin/kmotion caption /tmp/my-reel.mp4 \
  --words demo/captions-example.json \
  --out /tmp/my-reel-captioned.mp4 --look cyber

# 4. Machine-readable output for pipelines
./bin/kmotion render demo/phase2-demo.html --out /tmp/r.mp4 --json
# → {"ok":true,"command":"render","out":"/tmp/r.mp4","frames":300,...}
```

Exit codes: `0` = success, `1` = error (message says what + how to fix),
`2` = quality-gate fail (reserved for `verify`).

## Making your own reel (5 minutes)

**1. Copy the minimal scene template** (`examples/minimal-scene.html`):

```html
<div id="stage">
  <div id="title">Hello world</div>
</div>
<script src="/__km/km-core.js"></script>
<script src="/__km/km-runtime.js"></script>
<script>
  var title = document.getElementById('title');
  KM.createScene({
    meta: { dur: 5, fps: 30 },           // duration seconds
    render: function (t) {               // PURE function of t — no Date.now(), no Math.random()
      var k = KM.ease.expoOut(KM.seg(t, 0.3, 1.2));
      title.style.transform = 'translateY(' + (KM.lerp(120, 0, k)) + 'px)';
      title.style.opacity = KM.seg(t, 0.3, 0.8);
    },
    motion: function (t0, t1) { return 400; }  // px traveled (blur hint; 0 if static)
  });
</script>
```

**2. Render it:**

```bash
./bin/kmotion render my-scene.html --out reel.mp4 --style kinetic-type --blur
```

**3. Add captions** — create `words.json`:
```json
{"words": [
  {"text": "Hello", "startMs": 300, "endMs": 700},
  {"text": "world!", "startMs": 700, "endMs": 1200}
]}
```
```bash
./bin/kmotion caption reel.mp4 --words words.json --out reel-captioned.mp4
```

**4. Add audio** (Node API):
```js
const { mixAudio, mux } = require('./lib/km-audio');
await mixAudio({
  vo: 'vo.mp3',                                   // voiceover (or null)
  music: { file: 'bed.mp3', gainDb: -20 },        // bed, auto-ducked under VO
  sfx: [{ file: 'pop.mp3', at: 1.2, gainDb: -6 }],// hit points in seconds
  out: 'audio.m4a', dur: 5, lufs: -16
});
await mux({ video: 'reel.mp4', audio: 'audio.m4a', out: 'final.mp4' });
```

## Architecture (one line per module)

| Module | Job | Runs in |
|---|---|---|
| `runtime/km-core.js` | Pure motion math: interp, spring, camera, **carry moves** | page |
| `runtime/km-runtime.js` | `window.__km` seek contract (seek/ready/motion/track) | page |
| `runtime/km-captions.js` | TikTok karaoke caption renderer | page |
| `runtime/km-fx.js` | Effects: glitch, particles, glow, grain, vignette | page |
| `runtime/km-styles.js` | Style plugin registry (`defineStyle`/`getStyle`) | page |
| `lib/km-engine.js` | Headless-Chrome capture → FFmpeg (blur, dedup, looks) | node |
| `lib/km-blur.js` | Sub-frame motion-blur planner (pure functions) | node |
| `lib/km-caption-plan.js` | Word tokens → TikTok pages (pure functions) | node |
| `lib/km-audio.js` | FFmpeg audio mixer: VO + ducked music + SFX → -16 LUFS | node |
| `styles/` | Animation style plugins (JSON + JS, see STYLE-GUIDE.md) | both |
| `looks/` | Token looks: 8 colors + 3 typefaces (JSON) | both |

**The one rule:** `render(t)` must be a pure function of `t`. Same `t` →
same pixels, always. Everything (blur, dedup, determinism) depends on it.

## CLI reference

```
kmotion render <scene.html> [--fps 30] [--out reel.mp4]
        [--width 1080] [--height 1920] [--crf 18]
        [--blur] [--blur-samples 8] [--look NAME] [--style NAME] [--json]

kmotion caption <video.mp4> --words words.json [--out out.mp4]
        [--font font.ttf] [--look NAME] [--json]

kmotion looks list [--json]
kmotion styles list [--json]
```

Full API docs: [API.md](API.md). Style authoring: [STYLE-GUIDE.md](STYLE-GUIDE.md).
Design rationale: [../video-engine-research/ENGINE-DESIGN.md](../video-engine-research/ENGINE-DESIGN.md).

## Requirements

- Node.js ≥ 18, `ffmpeg` ≥ 6 (with libx264, zscale, tmix, loudnorm, drawtext),
  headless Chromium (`/opt/meta-chromium/chrome` or `KMOTION_CHROME` env).
- `npm install` in this directory (only dependency: `puppeteer-core`).
