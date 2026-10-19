/* Regression test for the 2026-10-18 blur EPIPE bug (v0.2.1).
 *
 * tmix is a SLIDING average: it emits one output frame per input frame, it
 * does NOT collapse groups of K into one. blurFilter() must therefore decimate
 * with select to get exactly N non-overlapping group averages out of N*K
 * sub-frames. The old filter (tmix alone) made ffmpeg exit after only N of
 * the N*K inputs, closing stdin and EPIPE-crashing every --blur render —
 * and even without the crash the video would have been the first 1/K of the
 * timeline.
 *
 * Usage: node test/blur-filter-test.js
 * Exits 0 on pass, 1 on failure. Needs ffmpeg on PATH (no browser).
 */
'use strict';
const { spawnSync, spawn } = require('child_process');
const { blurFilter } = require('../lib/km-blur');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok  ' + name); }
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// --- 1. filter string shape ---
for (const K of [2, 4, 8, 16]) {
  const f = blurFilter(K);
  check('blurFilter(' + K + ') is a string', typeof f === 'string');
  check('blurFilter(' + K + ') has tmix=frames=' + K, f && f.indexOf('tmix=frames=' + K) !== -1);
  check('blurFilter(' + K + ') decimates with select', f && f.indexOf('select=') !== -1, f);
  check('blurFilter(' + K + ') re-times for the K:1 decimation',
    f && f.indexOf('setpts=N*' + K + '/FRAME_RATE/TB') !== -1, f);
}
check('blurFilter(1) returns null (no blur needed)', blurFilter(1) === null);
check('blurFilter(0) returns null', blurFilter(0) === null);

// --- 2. end-to-end: N*K synthetic frames → exactly N group averages ---
async function e2e(K, N) {
  return new Promise((resolve) => {
    const W = 8, H = 8, FPS = 8; // output fps; input declared at FPS*K like the engine
    // Group g gets gray level (g+1)*40; K identical frames per group.
    const frames = [];
    for (let g = 0; g < N; g++) {
      const px = Buffer.alloc(W * H, (g + 1) * 40);
      for (let s = 0; s < K; s++) frames.push(px);
    }
    const input = Buffer.concat(frames);
    const filter = blurFilter(K);
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', W + 'x' + H,
      '-framerate', String(FPS * K), '-i', '-',
      '-vf', filter,
      '-frames:v', String(N),
      '-r', String(FPS), // like the engine: CFR at the target fps
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const outChunks = [], errChunks = [];
    ff.stdout.on('data', (d) => outChunks.push(d));
    ff.stderr.on('data', (d) => errChunks.push(d));
    ff.on('close', (code) => {
      const out = Buffer.concat(outChunks);
      const nOut = out.length / (W * H);
      resolve({ code, err: Buffer.concat(errChunks).toString(), nOut, out, K, N, W, H });
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(input);
  });
}

(async () => {
  for (const [K, N] of [[4, 4], [8, 3], [2, 5]]) {
    const r = await e2e(K, N);
    check('K=' + K + ' N=' + N + ': ffmpeg exits 0', r.code === 0, 'code=' + r.code + ' ' + r.err.slice(0, 200));
    check('K=' + K + ' N=' + N + ': exactly N=' + N + ' frames out', r.nOut === N, 'got ' + r.nOut);
    if (r.nOut === N) {
      let contentOk = true;
      for (let g = 0; g < N; g++) {
        const px = r.out.slice(g * r.W * r.H, (g + 1) * r.W * r.H);
        const mean = px.reduce((a, b) => a + b, 0) / px.length;
        const want = (g + 1) * 40;
        if (Math.abs(mean - want) > 2) {
          contentOk = false;
          console.log('      frame ' + g + ': mean=' + mean.toFixed(1) + ' want=' + want);
        }
      }
      check('K=' + K + ' N=' + N + ': group averages correct', contentOk);
    }
  }
  console.log(failures === 0 ? '\nPASS' : '\n' + failures + ' FAILURE(S)');
  if (failures !== 0) process.exit(1);

  // --- 3. timing: mp4 encode with -r like the real engine → duration must be N/fps ---
  const { execFileSync } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const K = 4, N = 10, W = 64, H = 64, FPS = 10;
  const frames = [];
  for (let g = 0; g < N; g++) {
    const px = Buffer.alloc(W * H * 3, (g + 1) * 20);
    for (let s = 0; s < K; s++) frames.push(px);
  }
  const outMp4 = path.join(os.tmpdir(), 'km-blur-timing-' + process.pid + '.mp4');
  const ff2 = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', W + 'x' + H,
    '-framerate', String(FPS * K), '-i', '-',
    '-vf', blurFilter(K),
    '-an', '-frames:v', String(N),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-r', String(FPS), outMp4
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err2 = '';
  ff2.stderr.on('data', (d) => { err2 += d; });
  ff2.stdin.on('error', () => {});
  await new Promise((res) => { ff2.on('close', res); ff2.stdin.end(Buffer.concat(frames)); });
  try {
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,duration',
      '-of', 'csv=p=0', outMp4
    ]).toString().trim().split(',');
    // NOTE: ffprobe csv orders columns alphabetically: duration, nb_read_frames
    const dur = parseFloat(probe[0]), nF = parseInt(probe[1], 10);
    check('timing: ' + N + ' frames out of mp4 encode', nF === N, 'got ' + nF + ' ' + err2.slice(0, 200));
    check('timing: duration ≈ ' + (N / FPS) + 's', Math.abs(dur - N / FPS) < 0.15, 'got ' + dur);
  } catch (e) {
    check('timing: ffprobe ran', false, String(e).slice(0, 200));
  } finally {
    try { fs.unlinkSync(outMp4); } catch (e) {}
  }

  console.log(failures === 0 ? '\nPASS (with timing)' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
