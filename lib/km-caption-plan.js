/* ============================================================================
 * kartefy-motion · km-caption-plan
 * Word tokens → TikTok-style pages (Node side, pure functions).
 *
 * Input : { words: [{ text, startMs, endMs, pageBreakAfter? }] }
 * Output: { words, pages: [{ startMs, endMs, tokens: [{text, fromMs, toMs}] }] }
 *
 * Grouping algorithm (design doc §2.4):
 *  - Accumulate tokens while the page stays under combineMs (default 2400).
 *  - Break the page when a token ends a clause (,.!?;: or —) AND
 *    (the page is over budget OR the following silence ≥ silenceBreakMs).
 *  - Honor an explicit pageBreakAfter flag as an authoring escape hatch.
 *  - A page never exceeds maxWords (default 6) — readability first.
 * ========================================================================== */
'use strict';

var CLAUSE_END = /[,.!?;:…—–-]$/;

function groupPages(words, o) {
  o = o || {};
  if (!Array.isArray(words)) {
    throw new Error(`km-caption-plan.groupPages: 'words' must be an array, got ${typeof words}`);
  }
  words.forEach((w, i) => {
    if (!w || typeof w.text !== 'string') {
      throw new Error(`km-caption-plan.groupPages: words[${i}].text must be a string — ` +
        `expected {text, startMs, endMs}, got ${JSON.stringify(w)}`);
    }
    if (typeof w.startMs !== 'number' || typeof w.endMs !== 'number' || w.endMs < w.startMs) {
      throw new Error(`km-caption-plan.groupPages: words[${i}] needs numeric startMs <= endMs (ms), ` +
        `got ${JSON.stringify({ startMs: w.startMs, endMs: w.endMs })}`);
    }
  });
  var combineMs = o.combineMs == null ? 2400 : o.combineMs;
  var silenceBreakMs = o.silenceBreakMs == null ? 700 : o.silenceBreakMs;
  var maxWords = o.maxWords == null ? 6 : o.maxWords;
  var minWords = o.minWords == null ? 2 : o.minWords;

  words = (words || []).slice().sort(function (a, b) { return a.startMs - b.startMs; });
  var pages = [];
  var cur = [];

  function flush() {
    if (!cur.length) return;
    pages.push({
      startMs: cur[0].startMs,
      endMs: cur[cur.length - 1].endMs,
      tokens: cur.map(function (w) {
        return { text: w.text, fromMs: w.startMs, toMs: w.endMs };
      })
    });
    cur = [];
  }

  function pageDur() {
    if (!cur.length) return 0;
    return cur[cur.length - 1].endMs - cur[0].startMs;
  }

  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    cur.push(w);

    var isLast = i === words.length - 1;
    var explicitBreak = !!w.pageBreakAfter;
    var overWords = cur.length >= maxWords;
    var overBudget = pageDur() >= combineMs && cur.length >= minWords;

    var next = words[i + 1];
    var silence = next ? next.startMs - w.endMs : Infinity;
    var clauseEnd = CLAUSE_END.test(w.text);

    if (isLast || explicitBreak || overWords ||
        (clauseEnd && (overBudget || silence >= silenceBreakMs))) {
      flush();
    }
  }
  flush(); // safety

  // Merge a trailing single-word page back into the previous page when the
  // previous page has room — avoids lonely orphan words.
  for (var p = pages.length - 1; p > 0; p--) {
    if (pages[p].tokens.length === 1 &&
        pages[p - 1].tokens.length + 1 <= maxWords &&
        (pages[p].endMs - pages[p - 1].startMs) <= combineMs * 1.5) {
      var orphan = pages[p];
      var prev = pages[p - 1];
      prev.tokens = prev.tokens.concat(orphan.tokens);
      prev.endMs = orphan.endMs;
      pages.splice(p, 1);
    }
  }

  return { words: words, pages: pages };
}

/**
 * Normalize the several input shapes we accept into { words }.
 * Accepts: {words:[...]}, {pages:...} passthrough, or a bare array.
 */
function normalizeInput(data) {
  if (Array.isArray(data)) return { words: data };
  if (data && Array.isArray(data.words)) return { words: data.words };
  if (data && Array.isArray(data.pages)) return { words: [], pages: data.pages };
  throw new Error('km-caption-plan: expected {words:[...]} or an array of word tokens');
}

module.exports = { groupPages: groupPages, normalizeInput: normalizeInput };
