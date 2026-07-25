#!/usr/bin/env node
/**
 * Claude Code subagent statusline — one decorated row per background agent.
 *
 * stdin:  {columns, tasks:[{id, name, label, description, status, model, effort,
 *                          contextWindowSize, tokenCount, tokenSamples, startTime}]}
 * stdout: NDJSON, one {"id","content"} per task.
 *
 * The decoration REPLACES everything after the status glyph, so each row has to
 * carry its own name/tokens/elapsed — plus the model and effort the default row
 * never shows. Empty content hides the row entirely, so never emit "".
 */

const BARS = '▁▂▃▄▅▆▇█';

const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f1e6, 0x1f1ff], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Width of one grapheme cluster. A composite emoji — skin-tone modifier, ZWJ
 * sequence, regional-indicator flag — draws as a SINGLE glyph, so the cluster is
 * measured by its base code point instead of summing its parts.
 */
function clusterWidth(cluster) {
  let seen = false, wide = false;
  for (const ch of cluster) {
    const c = ch.codePointAt(0);
    if (c === 0xfe0f) { seen = true; wide = true; continue; }
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200d) || c === 0x20e3) continue;
    if (seen) continue;
    seen = true;
    wide = WIDE.some(([a, b]) => c >= a && c <= b);
  }
  return seen ? (wide ? 2 : 1) : 0;
}

/** Display width in terminal columns (CJK/emoji are 2, combining marks are 0). */
function dw(s) {
  let w = 0;
  for (const { segment } of GRAPHEMES.segment(String(s))) w += clusterWidth(segment);
  return w;
}

function trunc(s, max) {
  if (dw(s) <= max) return s;
  let out = '', w = 0;
  for (const ch of s) {
    const cw = dw(ch);
    if (w + cw > max - 1) break;
    out += ch; w += cw;
  }
  return out + '…';
}

function pad(s, width) {
  return s + ' '.repeat(Math.max(0, width - dw(s)));
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'm';
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
}

function fmtElapsed(v, now) {
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(t) || t <= 0) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** claude-opus-5[1m] -> Opus5(1m); claude-haiku-4-5-20251001 -> Haiku4.5 */
function shortModel(id) {
  if (!id) return null;
  const wide = /\[1m\]/.test(id);
  const s = String(id).replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const p = s.split('-').filter(Boolean);
  if (!p.length) return null;
  const fam = p[0].charAt(0).toUpperCase() + p[0].slice(1);
  return fam + p.slice(1).join('.') + (wide ? '(1m)' : '');
}

function shortEffort(e) {
  if (e == null) return null;
  if (typeof e === 'number') return 'e' + e;
  return e === 'medium' ? 'med' : String(e);
}

/** Sparkline over per-tick token deltas: flat bars mean the agent is stalled. */
function spark(samples) {
  if (!Array.isArray(samples) || samples.length < 3) return null;
  const d = [];
  for (let i = 1; i < samples.length; i++) d.push(Math.max(0, (samples[i] || 0) - (samples[i - 1] || 0)));
  const max = Math.max(...d);
  return d.map((v) => BARS[max > 0 ? Math.min(7, Math.floor((v / max) * 7.999)) : 0]).join('');
}

function render(input, now = Date.now()) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!tasks.length) return [];
  const cols = Number(input?.columns) > 0 ? Number(input.columns) : 110;

  const rows = tasks.map((t) => {
    const raw = String(t.name || t.label || t.description || t.id || '?').replace(/\s+/g, ' ').trim();
    const right = [
      [shortModel(t.model), shortEffort(t.effort)].filter(Boolean).join(' ') || null,
      t.tokenCount ? fmtTokens(t.tokenCount) + (t.contextWindowSize ? '/' + fmtTokens(t.contextWindowSize) : '') : null,
      spark(t.tokenSamples),
      fmtElapsed(t.startTime, now),
      t.status && t.status !== 'running' ? t.status : null,
    ].filter(Boolean).join(' · ');
    return { id: t.id, name: raw || '?', right };
  });

  const widest = Math.max(...rows.map((r) => dw(r.right)));
  const nameW = Math.max(8, Math.min(28, cols - widest - 3));

  return rows.map((r) => {
    const line = (pad(trunc(r.name, nameW), nameW) + '  ' + r.right).trimEnd();
    return JSON.stringify({ id: r.id, content: trunc(line, Math.max(1, cols - 1)) || '·' });
  });
}

async function main() {
  let data = '';
  const timeout = setTimeout(() => process.exit(0), 4000);
  for await (const chunk of process.stdin) data += chunk;
  clearTimeout(timeout);
  if (!data.trim()) return;

  let input;
  try { input = JSON.parse(data); } catch { return; }

  const lines = render(input);
  if (lines.length) process.stdout.write(lines.join('\n') + '\n');
}

if (require.main === module) main().catch(() => process.exit(0));

module.exports = { render, dw, trunc, pad, spark, shortModel, shortEffort, fmtTokens, fmtElapsed };
