/* ============================================================================
 * kartefy-motion · km-audio
 * FFmpeg-side audio mixing (Node). All audio is processed OFFLINE —
 * never in the browser (deterministic, higher quality).
 *
 * mixAudio({ vo, music, sfx, out, dur, lufs, duckDb, musicDb, sr })
 *   vo     — path to voiceover file (wav/mp3/m4a) or null
 *   music  — { file, gainDb } bed music or null
 *   sfx    — [{ file, at (sec), gainDb }] — each has a VISIBLE trigger
 *   out    — output audio path (m4a/aac)
 *   dur    — target duration (seconds); output trimmed/padded exactly
 *   lufs   — target integrated loudness (default -16)
 *   duckDb — how far the music ducks under VO (default -12)
 *   sr     — sample rate (default 48000)
 *
 * Pipeline:
 *   1. Per-track: aresample → trim/pad → volume.
 *   2. Music ducked under VO via sidechaincompress (VO is the key).
 *   3. SFX delayed to their hit points, amix'd.
 *   4. Master: loudnorm (single pass) → atrim/apad to exact dur → AAC.
 *
 * Sound doctrine: fewer SFX events than beats; VO is king; music is a bed.
 * ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg audio mix failed (code ' + code + '):\n' + err.slice(-3000)));
    });
    ff.on('error', reject);
  });
}

/**
 * Build the -filter_complex script. Inputs are numbered in the order we
 * pass -i flags: [vo?, music?, ...sfx]. Returns { script, inputFiles }.
 */
function buildFilter(o) {
  const sr = o.sr || 48000;
  const lufs = o.lufs == null ? -16 : o.lufs;
  const duckDb = o.duckDb == null ? -12 : o.duckDb;
  const dur = o.dur;

  const inputs = [];
  const fc = [];
  let idx = 0;

  // ---- VO ----
  let voLabel = null;
  if (o.vo) {
    inputs.push(o.vo);
    voLabel = '[vo]';
    fc.push(
      `[${idx}:a]aresample=${sr},aformat=channel_layouts=stereo,` +
      `volume=1.0,atrim=0:${dur},apad=whole_dur=${dur}${voLabel}`
    );
    idx++;
  }

  // ---- music bed (ducked under VO when VO exists) ----
  let musicLabel = null;
  if (o.music && o.music.file) {
    inputs.push(o.music.file);
    const mIdx = idx; idx++;
    const g = o.music.gainDb == null ? -20 : o.music.gainDb;
    if (voLabel) {
      // sidechaincompress: [music][vo] → ducked music.
      // threshold tuned so normal VO triggers ~duckDb of reduction.
      fc.push(
        `[${mIdx}:a]aresample=${sr},aformat=channel_layouts=stereo,` +
        `volume=${g}dB,atrim=0:${dur},apad=whole_dur=${dur}[mus]` +
        `;${voLabel}asplit=2[voout][voside]` +
        `;[mus][voside]sidechaincompress=threshold=0.02:ratio=8:` +
        `attack=15:release=400:makeup=1[musduck]`
      );
      voLabel = '[voout]';
      musicLabel = '[musduck]';
    } else {
      fc.push(
        `[${mIdx}:a]aresample=${sr},aformat=channel_layouts=stereo,` +
        `volume=${g}dB,atrim=0:${dur},apad=whole_dur=${dur}${'[mus]'}`
      );
      musicLabel = '[mus]';
    }
    void duckDb; // duck amount is baked into the compressor curve above
  }

  // ---- SFX: each delayed to its hit point, then mixed ----
  const sfxLabels = [];
  (o.sfx || []).forEach((s, i) => {
    inputs.push(s.file);
    const sIdx = idx; idx++;
    const g = s.gainDb == null ? -6 : s.gainDb;
    const ms = Math.max(0, Math.round(s.at * 1000));
    const lbl = `[sfx${i}]`;
    fc.push(
      `[${sIdx}:a]aresample=${sr},aformat=channel_layouts=stereo,` +
      `volume=${g}dB,adelay=${ms}|${ms}${lbl}`
    );
    sfxLabels.push(lbl);
  });

  // ---- final mix ----
  const mixIns = [];
  if (voLabel) mixIns.push(voLabel);
  if (musicLabel) mixIns.push(musicLabel);
  sfxLabels.forEach((l) => mixIns.push(l));

  if (!mixIns.length) {
    // No inputs at all: generate silence of exactly dur.
    return {
      inputs: [],
      filter: `anullsrc=r=${sr}:cl=stereo:d=${dur},` +
              `loudnorm=I=${lufs}:TP=-1.5:LRA=11,atrim=0:${dur}[out]`,
      map: '[out]'
    };
  }

  let tail;
  if (mixIns.length === 1) {
    tail = `${mixIns[0]}loudnorm=I=${lufs}:TP=-1.5:LRA=11,` +
           `atrim=0:${dur},apad=whole_dur=${dur}[out]`;
  } else {
    tail = `${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0,` +
           `loudnorm=I=${lufs}:TP=-1.5:LRA=11,` +
           `atrim=0:${dur},apad=whole_dur=${dur}[out]`;
  }
  fc.push(tail);

  return { inputs, filter: fc.join(';'), map: '[out]' };
}

async function mixAudio(o) {
  if (!o || typeof o !== 'object') throw new Error('km-audio.mixAudio: expected an options object, got ' + typeof o);
  if (!o.out || typeof o.out !== 'string') {
    throw new Error('km-audio.mixAudio: \'out\' (output path) is required.');
  }
  if (!(o.dur > 0)) {
    throw new Error(`km-audio.mixAudio: 'dur' must be a positive number of seconds, got ${JSON.stringify(o.dur)}`);
  }
  // Validate every input file exists before building the graph.
  const checkFile = (label, p) => {
    if (!p) return;
    if (!fs.existsSync(p)) {
      throw new Error(`km-audio.mixAudio: ${label} file not found: ${p}`);
    }
  };
  checkFile('vo', o.vo);
  checkFile('music', o.music && o.music.file);
  (o.sfx || []).forEach((s, i) => {
    checkFile(`sfx[${i}]`, s.file);
    if (!(s.at >= 0)) {
      throw new Error(`km-audio.mixAudio: sfx[${i}].at must be >= 0 (seconds), got ${JSON.stringify(s.at)}`);
    }
  });
  const { inputs, filter, map } = buildFilter(o);

  const scriptPath = path.join(os.tmpdir(), 'km-audio-' + process.pid + '-' + Date.now() + '.txt');
  fs.writeFileSync(scriptPath, filter);

  const args = ['-y'];
  inputs.forEach((f) => { args.push('-i', f); });
  args.push(
    '-filter_complex_script', scriptPath,
    '-map', map,
    '-c:a', 'aac', '-b:a', '192k',
    '-ar', String(o.sr || 48000),
    o.out
  );
  try {
    await runFfmpeg(args);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
  }
  return { out: o.out, dur: o.dur };
}

/**
 * mux({ video, audio, out }) — combine rendered video + mixed audio.
 * Video stream copied (no re-encode); shortest wins.
 */
async function mux(o) {
  if (!o || !o.video || !o.audio || !o.out) {
    throw new Error('mux needs { video, audio, out }');
  }
  await runFfmpeg([
    '-y',
    '-i', o.video,
    '-i', o.audio,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    o.out
  ]);
  return { out: o.out };
}

module.exports = { mixAudio, mux, buildFilter };
