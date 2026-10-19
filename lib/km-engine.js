/* ============================================================================
 * kartefy-motion · km-engine
 * Node-side renderer: serve → seek → capture → encode.
 *
 * Pipeline (mirrors the design doc §2.6):
 *   1. Serve the composition over a local HTTP server (no file:// quirks).
 *      Requests to /__km/* are served from the bundled runtime directory,
 *      so scenes just do <script src="/__km/km-core.js">.
 *   2. Launch headless Chromium via puppeteer-core (one page, reused —
 *      seek-pure compositions make per-frame pages unnecessary).
 *   3. Readiness gate: wait for window.__km, then await __km.ready().
 *      No frame 0 before ready — kills the blank-first-frames bug class.
 *   4. Seek loop with INTEGER frame math: t = n / fps. For each frame,
 *      evaluate __km.seek(t), then Page.captureScreenshot.
 *   5. Pipe JPEG buffers straight into FFmpeg (image2pipe) → libx264 MP4.
 *      No intermediate files on disk: capture → encode streams.
 *
 * Determinism: same scene + same seed ⇒ identical frames (verify by
 * rendering twice and diffing). No wall clock enters the render path.
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { planBlur, blurFilter, expandCaptures } = require('./km-blur');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const LOOKS_DIR = path.join(__dirname, '..', 'looks');
const STYLES_DIR = path.join(__dirname, '..', 'styles');
const CHROME_PATH = process.env.KMOTION_CHROME || '/opt/meta-chromium/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/** Start the local file server. Returns {server, port}.
 *  htmlTransform(path, htmlString) — optional transform applied when serving
 *  the scene file itself (used for --look token injection). */
function startServer(sceneDir, htmlTransform, sceneFile) {
  const root = path.resolve(sceneDir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath;
      if (urlPath.startsWith('/__km/')) {
        // Bundled runtime files: km-core.js, km-runtime.js, km-captions.js,
        // km-fx.js, km-styles.js.
        filePath = path.join(RUNTIME_DIR, urlPath.slice('/__km/'.length));
      } else if (urlPath.startsWith('/__styles/')) {
        // Style plugin modules: styles/<name>.js
        filePath = path.join(STYLES_DIR, path.basename(urlPath.slice('/__styles/'.length)));
      } else {
        const rel = urlPath.replace(/^\/+/, '') || 'index.html';
        filePath = path.join(root, rel);
        // Jail: never serve outside the scene directory.
        if (!path.resolve(filePath).startsWith(root)) {
          res.writeHead(403); res.end('forbidden'); return;
        }
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        if (htmlTransform && path.basename(filePath) === sceneFile &&
            /\.html?$/i.test(filePath)) {
          try { data = Buffer.from(htmlTransform(filePath, data.toString('utf8'))); } catch (e) { /* fall through raw */ }
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    } catch (e) {
      res.writeHead(500); res.end('server error');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Resolve a --look value (name or path) to a look object.
 * Returns null when look is falsy.
 */
function resolveLook(look) {
  if (!look) return null;
  let p = look;
  if (!fs.existsSync(p)) {
    p = path.join(LOOKS_DIR, look.replace(/\.json$/, '') + '.json');
  }
  if (!fs.existsSync(p)) throw new Error('look not found: ' + look);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Resolve a --style value (name or path) to { json, jsPath, look }.
 * Returns null when style is falsy.
 */
function resolveStyle(style) {
  if (!style) return null;
  let p = style;
  if (!fs.existsSync(p)) {
    p = path.join(STYLES_DIR, style.replace(/\.json$/, '') + '.json');
  }
  if (!fs.existsSync(p)) throw new Error('style not found: ' + style);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  const base = path.basename(p, '.json');
  const jsPath = path.join(STYLES_DIR, base + '.js');
  if (!fs.existsSync(jsPath)) throw new Error('style module missing: ' + jsPath);
  const look = resolveLook(json.look);
  return { json, jsPath, look, name: base };
}

/**
 * Inject style runtime scripts into scene HTML:
 *   <script src="/__km/km-styles.js"> + <script src="/__km/km-fx.js">
 *   + <script src="/__styles/<name>.js"> + window.KM_STYLE meta.
 * Placed before </head> so scene scripts (usually at body end) see them.
 */
function inlineStyleScripts(html, styleName) {
  const tags =
    '<script src="/__km/km-styles.js"></script>' +
    '<script src="/__km/km-fx.js"></script>' +
    '<script src="/__styles/' + styleName + '.js"></script>' +
    '<script>window.KM_STYLE=' + JSON.stringify(styleName) + ';</script>';
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags + '</head>');
  return tags + html;
}
function inlineLook(html, look) {
  if (!look) return html;
  const vars = [];
  const colors = look.colors || {};
  for (const k of Object.keys(colors)) {
    vars.push(`--km-${k}: ${colors[k]};`);
  }
  const type = look.type || {};
  if (type.display) vars.push(`--km-font-display: ${type.display};`);
  if (type.body) vars.push(`--km-font-body: ${type.body};`);
  if (type.mono) vars.push(`--km-font-mono: ${type.mono};`);
  const styleTag = `<style>:root{${vars.join('')}}</style>`;
  const lookJson = JSON.stringify(look).replace(/<\/script/gi, '<\\/script');
  const scriptTag = `<script>window.KM_LOOK=${lookJson};</script>`;
  // Inject style at end of <head>, look global right after <body> opens
  // (so scene scripts that run later can read window.KM_LOOK).
  let out = html.replace(/<\/head>/i, styleTag + '</head>');
  if (out === html) out = styleTag + html;
  out = out.replace(/<body[^>]*>/i, (m) => m + scriptTag);
  return out;
}

/**
 * Inline bundled /__km/* and /__styles/* scripts into the scene HTML so it
 * can load over file:// without a server. Returns the transformed HTML.
 */
function inlineRuntime(html) {
  return html
    .replace(
      /<script\s+src=["']\/__km\/([^"']+)["'][^>]*>\s*<\/script>/g,
      (m, name) => {
        const p = path.join(RUNTIME_DIR, path.basename(name));
        try {
          const code = fs.readFileSync(p, 'utf8');
          return '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
        } catch (e) {
          throw new Error('cannot inline /__km/' + name + ': ' + e.message);
        }
      }
    )
    .replace(
      /<script\s+src=["']\/__styles\/([^"']+)["'][^>]*>\s*<\/script>/g,
      (m, name) => {
        const p = path.join(STYLES_DIR, path.basename(name));
        try {
          const code = fs.readFileSync(p, 'utf8');
          return '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
        } catch (e) {
          throw new Error('cannot inline /__styles/' + name + ': ' + e.message);
        }
      }
    );
}

/**
 * Load the scene into the page.
 * Primary: local HTTP server (clean asset semantics). Fallback: file://
 * with bundled runtime inlined — needed where Chromium's Local Network
 * Access checks block http://127.0.0.1 navigation.
 */
async function loadScene(page, sceneAbs, server, port) {
  const sceneFile = path.basename(sceneAbs);
  const httpUrl = `http://127.0.0.1:${port}/${encodeURIComponent(sceneFile)}`;
  try {
    await page.goto(httpUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    return;
  } catch (e) {
    if (!/LOCAL_NETWORK_ACCESS/i.test(e.message)) throw e;
    // Fall through to file:// below.
  }
  const html = inlineRuntime(fs.readFileSync(sceneAbs, 'utf8'));
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kmotion-'));
  const tmpHtml = path.join(tmpDir, sceneFile);
  fs.writeFileSync(tmpHtml, html);
  // file:// base lets other relative assets resolve next to the scene.
  await page.goto('file://' + tmpHtml, { waitUntil: 'networkidle0', timeout: 60000 });
}

/**
 * Render one scene HTML file to MP4.
 *
 * opts: {
 *   scenePath,            // path to scene.html (required)
 *   fps = 30,
 *   out,                  // output mp4 path (required)
 *   width = 1080, height = 1920,
 *   crf = 18,             // x264 quality
 *   jpegQuality = 92,     // capture quality (deterministic per build)
 *   blur = false,         // sub-frame motion blur (Phase 2)
 *   blurSamples = 8,      // fixed K sub-captures per frame when blurring
 *   look = null,          // look name (looks/<name>.json) or path
 *   style = null,         // style plugin (styles/<name>) — implies its look
 *   onProgress(n, total)  // optional progress callback
 * }
 */
async function renderScene(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('km-engine.renderScene: expected an options object.');
  }
  if (!opts.scenePath || typeof opts.scenePath !== 'string') {
    throw new Error('km-engine.renderScene: \'scenePath\' (HTML file) is required.');
  }
  if (!fs.existsSync(opts.scenePath)) {
    throw new Error(`km-engine.renderScene: scene file not found: ${opts.scenePath}\n` +
      'fix: pass the path to a scene HTML that calls KM.createScene().');
  }
  if (!opts.out || typeof opts.out !== 'string') {
    throw new Error('km-engine.renderScene: \'out\' (output MP4 path) is required.');
  }
  const fps = opts.fps || 30;
  const width = opts.width || 1080;
  const height = opts.height || 1920;
  const crf = opts.crf == null ? 18 : opts.crf;
  const jpegQuality = opts.jpegQuality == null ? 92 : opts.jpegQuality;
  const useBlur = !!opts.blur;
  const K = useBlur ? Math.max(2, Math.min(16, opts.blurSamples || 8)) : 1;
  const style = resolveStyle(opts.style);
  // --style implies its look; an explicit --look overrides the style's.
  const look = resolveLook(opts.look) || (style && style.look);

  const sceneAbs = path.resolve(opts.scenePath);
  const sceneDir = path.dirname(sceneAbs);
  const sceneFile = path.basename(sceneAbs);

  // 1. Serve (with look token injection + style script injection).
  const htmlTransform = (look || style) ? ((p, html) => {
    let out = look ? inlineLook(html, look) : html;
    if (style) out = inlineStyleScripts(out, style.name);
    return out;
  }) : null;
  const { server, port } = await startServer(sceneDir, htmlTransform, sceneFile);

  let browser = null;
  try {
    // 2. Launch Chromium. user-data-dir lives in the project (not /tmp)
    // because /tmp is a small tmpfs shared with other workers.
    const profileDir = path.join(__dirname, '..', '.chrome-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      userDataDir: profileDir,
      protocolTimeout: 600000, // blur renders do many seeks; be patient
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        // Allow the render page to reach our local file server: newer
        // Chromium blocks "local network access" checks by default.
        '--disable-features=BlockInsecurePrivateNetworkRequests'
      ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    await loadScene(page, sceneAbs, server, port);

    // 3. Readiness gate.
    await page.waitForFunction('window.__km && window.__km.version === 1', { timeout: 30000 });
    await page.evaluate(() => window.__km.ready());

    const meta = await page.evaluate(() => window.__km.meta);
    const dur = meta.dur;
    if (!dur || dur <= 0) throw new Error('__km.meta.dur must be > 0');
    const nFrames = Math.round(dur * fps);
    const cuts = (meta.cuts || []).slice().sort((a, b) => a - b);
    // Does the composition provide a motion estimate? (for adaptive blur)
    const hasMotion = await page.evaluate(() => {
      try {
        const m = window.__km.motion(0, 0.1);
        return typeof m === 'number';
      } catch (e) { return false; }
    });

    // 4. FFmpeg: JPEG stream in, H.264 MP4 out.
    //    With blur: pipe N*K sub-frames; blurFilter (tmix + select decimation)
    //    collapses each group of K into one output frame → exactly N frames.
    //    NOTE: tmix alone is a sliding average (1 out per input), NOT a
    //    collapse — the select in blurFilter() is what makes the counts work.
    //    Without it ffmpeg exits after N of N*K inputs and Node EPIPE-crashes
    //    on the remaining writes (the 2026-10-18 SQLMap production bug).
    const ffArgs = [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(fps * (useBlur ? K : 1)),
      '-i', '-',
    ];
    const vf = useBlur ? blurFilter(K) : null;
    if (vf) ffArgs.push('-vf', vf);
    ffArgs.push(
      '-an',
      '-frames:v', String(nFrames), // safety: expect exactly N frames after the select decimation
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', String(crf),
      '-preset', 'medium',
      '-r', String(fps),
      '-movflags', '+faststart',
      opts.out
    );
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d.toString(); });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code + '\n' + ffErr.slice(-2000)))));
      ff.on('error', reject);
    });
    // If ffmpeg dies early, stop feeding it.
    ff.on('close', (code) => { if (code !== 0) page.close().catch(() => {}); });
    // Swallow late stdin errors (EPIPE): ffmpeg's exit is surfaced via ffDone
    // with its stderr tail, which is far more useful than a raw EPIPE throw.
    ff.stdin.on('error', () => {});
    // Guarded write: fail fast with ffmpeg's stderr if it died mid-render,
    // instead of crashing later on a broken pipe.
    async function writeJpeg(buf) {
      if (ff.exitCode !== null) {
        throw new Error('ffmpeg exited ' + ff.exitCode + ' mid-render\n' + ffErr.slice(-2000));
      }
      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }
    }

    // 5. Seek loop — integer frame math, t = n / fps.
    //    With blur: for each frame, plan sub-times across the shutter window,
    //    capture each, pad to exactly K buffers, and pipe all K (the
    //    tmix+select filter in FFmpeg collapses each group back to one frame).
    //
    //    Static-run dedup (non-blur path only): when the last 2 captures were
    //    byte-identical AND the motion hint is 0, reuse the last buffer
    //    without seeking/screenshotting. Every 30th frame re-captures to
    //    verify (protects against scenes whose motion() under-reports).
    //    This makes holds/talking-heads nearly free.
    const crypto = require('crypto');
    const hashBuf = (b) => crypto.createHash('md5').update(b).digest('hex');
    const shutterWin = (1 / fps) / 2; // 180° shutter
    let lastHash = null, lastBuffer = null, staticRun = 0;

    async function motionAt(t) {
      if (!hasMotion) return Infinity; // unknown → never skip
      try {
        const m = await page.evaluate(
          (tt, w) => window.__km.motion(tt - w / 2, tt + w / 2), t, shutterWin);
        return typeof m === 'number' ? m : Infinity;
      } catch (e) { return Infinity; }
    }

    let dedupHits = 0;
    for (let n = 0; n < nFrames; n++) {
      const t = n / fps;

      // --- static-run fast path (no blur only) ---
      if (!useBlur && staticRun >= 2 && (n % 30 !== 0)) {
        const mp = await motionAt(t);
        if (mp === 0 && lastBuffer) {
          await writeJpeg(lastBuffer);
          staticRun++;
          dedupHits++;
          if (opts.onProgress && n % 10 === 0) opts.onProgress(n, nFrames);
          continue;
        }
      }

      let subTimes = [t];
      if (useBlur) {
        const motionPx = await motionAt(t);
        const plan = planBlur({
          t, fps,
          motionPx: motionPx === Infinity ? 0 : motionPx,
          cuts, maxSamples: K, dur
        });
        subTimes = plan.subTimes;
      }
      const bufs = [];
      for (let s = 0; s < subTimes.length; s++) {
        await page.evaluate((tt) => window.__km.seek(tt), subTimes[s]);
        bufs.push(await page.screenshot({ type: 'jpeg', quality: jpegQuality }));
      }
      const out_bufs = useBlur ? expandCaptures(bufs, K) : bufs;

      // Track stillness for the dedup fast path (first buffer of the group).
      if (!useBlur) {
        const h = hashBuf(out_bufs[0]);
        if (h === lastHash) staticRun++;
        else { staticRun = 0; lastHash = h; }
        lastBuffer = out_bufs[0];
      }

      for (let s = 0; s < out_bufs.length; s++) {
        await writeJpeg(out_bufs[s]);
      }
      if (opts.onProgress && n % 10 === 0) opts.onProgress(n, nFrames);
    }
    ff.stdin.end();
    await ffDone;

    if (opts.onProgress) opts.onProgress(nFrames, nFrames);
    return { frames: nFrames, fps, dur, width, height, out: opts.out,
             blur: useBlur, dedupHits };
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

module.exports = { renderScene, resolveLook, inlineLook, RUNTIME_DIR, LOOKS_DIR, CHROME_PATH };
