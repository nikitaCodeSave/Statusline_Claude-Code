#!/usr/bin/env node
/**
 * Claude Code Statusline
 *
 * Design: box-drawing separators │ between groups, middle dots · within groups,
 * dim structural chars, RGB color-coded thresholds.
 */

const fs = require('fs');
const path = require('path');

const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  green:   '\x1b[38;2;0;180;0m',
  yellow:  '\x1b[38;2;230;200;0m',
  orange:  '\x1b[38;2;255;176;85m',
  red:     '\x1b[38;2;255;85;85m',
  cyan:    '\x1b[38;2;86;182;194m',
  magenta: '\x1b[38;2;180;120;220m',
  white:   '\x1b[38;2;200;200;200m',
  gray:    '\x1b[38;2;100;100;100m',
};

const SEP = `  ${C.gray}\u2502${C.reset}  `;
const DOT = ` ${C.gray}\u00b7${C.reset} `;

function getGitBranch(cwd) {
  try {
    let dir = cwd;
    let parent = path.dirname(dir);
    while (dir !== parent) {
      const h = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(h)) {
        const c = fs.readFileSync(h, 'utf8').trim();
        return c.startsWith('ref: refs/heads/') ? c.slice(16) : c.slice(0, 7);
      }
      dir = parent;
      parent = path.dirname(dir);
    }
  } catch {}
  return null;
}

function usageColor(pct) {
  if (pct < 70) return C.green;
  if (pct < 80) return C.yellow;
  if (pct < 90) return C.orange;
  return C.red;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'm';
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
}

function fmtDuration(ms) {
  if (!ms) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function fmtResetTime(val) {
  if (!val) return '';
  const ms = typeof val === 'number' ? val * 1000 : new Date(val).getTime();
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d${h}h`;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function fmtRateWindow(label, w) {
  if (!w || w.used_percentage == null) return null;
  const pct = w.used_percentage;
  const color = usageColor(pct);
  const reset = w.resets_at ? ` ${C.dim}@${fmtResetTime(w.resets_at)}${C.reset}` : '';
  return `${C.white}${label}${C.reset} ${color}${pct.toFixed(0)}%${C.reset}${reset}`;
}

async function main() {
  let data = '';
  const timeout = setTimeout(() => process.exit(1), 500);
  for await (const chunk of process.stdin) data += chunk;
  clearTimeout(timeout);
  if (!data.trim()) return;

  let input;
  try { input = JSON.parse(data); } catch { return; }

  const ctx = input.context_window || {};
  const pct = ctx.used_percentage || 0;
  const limit = ctx.context_window_size || 200000;
  const cu = ctx.current_usage || {};
  const used = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);

  const model = input.model?.display_name || 'Claude';
  const cost = input.cost?.total_cost_usd || 0;
  const duration = input.cost?.total_duration_ms || 0;
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd();

  const branch = input.worktree?.branch || getGitBranch(cwd);
  const agentName = input.agent?.name;
  // Active level for this turn, after any silent downgrade — not the configured one.
  // Absent on models without reasoning effort. Same value as $CLAUDE_EFFORT.
  const effort = input.effort?.level;
  const ctxColor = usageColor(pct);

  // Rate limits — joined with dot as a single group
  const rl = input.rate_limits || {};
  const rateItems = [fmtRateWindow('5h', rl.five_hour), fmtRateWindow('7d', rl.seven_day)].filter(Boolean);
  const rateGroup = rateItems.length ? rateItems.join(DOT) : null;

  // Left: identity (agent · branch · model)
  const identity = [
    agentName ? `${C.orange}${agentName}${C.reset}` : null,
    branch ? `${C.magenta}${branch}${C.reset}` : null,
    `${C.cyan}${C.bold}${model}${C.reset}${effort ? ` ${C.dim}${effort}${C.reset}` : ''}`,
  ].filter(Boolean).join(DOT);

  const costStr = `${cost > 0 ? C.yellow : C.dim}$${cost.toFixed(2)}${C.reset}`;
  const ctxStr = `${ctxColor}${fmtTokens(used)}${C.dim}/${C.reset}${ctxColor}${fmtTokens(limit)} ${C.dim}(${C.reset}${ctxColor}${pct.toFixed(0)}%${C.reset}${C.dim})${C.reset}`;

  // Line 1: identity │ context
  const line1 = [identity, ctxStr].join(SEP);

  // Line 2: cost · rate limits · duration
  const line2parts = [costStr, rateGroup, duration > 0 ? `${C.white}\u23f1 ${fmtDuration(duration)}${C.reset}` : null].filter(Boolean);
  const line2 = line2parts.join(SEP);

  console.log(line1);
  console.log(line2);
}

main().catch(() => process.exit(1));
