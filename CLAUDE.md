# Claude Code Statusline — Setup Guide for Agents

This file describes how to install and configure Claude Code Statusline for a user.

## What this project is

A two-line status bar for Claude Code that shows session state in real-time: context usage, model, git branch, cost, rate limits, and duration. It consists of 1 file (`statusline.js`) configured in `settings.json`.

## Files

| File | Destination | Purpose |
|------|-------------|---------|
| `statusline.js` | `~/.claude/statusline.js` | Node.js renderer, outputs two colored lines to stdout |

## Installation steps

All commands below assume the current working directory is the root of this repository (where `statusline.js` is located).

### 0. Pre-flight checks

1. **Detect OS:** Run `uname -s` (Linux/Darwin) or check for Windows paths (`$env:OS`, `USERPROFILE`). Adapt commands accordingly.
2. **Check Node.js:** Run `node --version`. Must be >= 18. If missing — stop and tell the user to install Node.js.
3. **Check `~/.claude/` exists:** It should if Claude Code is installed. If not — `mkdir -p ~/.claude`.

### 1. Copy the renderer

```bash
cp statusline.js ~/.claude/statusline.js
```

On Windows (PowerShell):
```powershell
copy statusline.js $env:USERPROFILE\.claude\statusline.js
```

### 2. Configure settings.json

Read `~/.claude/settings.json`. It may not exist, may be empty, or may already contain settings.

**The following key needs to be set:**

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js"
  }
}
```

**Merge rules:**
- If the file doesn't exist — create it with the key above.
- If the file exists — read it, parse as JSON, and set the `statusLine` key (overwrite if already present — there can only be one statusline). Do NOT remove or overwrite other keys.
- Write the result back with proper JSON formatting (2-space indent).

### 3. Verify installation

Check that:
- `~/.claude/statusline.js` exists and is non-empty
- `~/.claude/settings.json` contains the `statusLine` key

Report to the user what was done and ask them to restart Claude Code.

## Requirements

- **Node.js >= 18**
- Terminal with true-color (RGB) support (most modern terminals, including Windows Terminal and VS Code Terminal)

`statusline.js` is fully cross-platform — works anywhere Node.js runs. No bash, jq, or other dependencies.

## How it works

Claude Code calls `node ~/.claude/statusline.js` on every update, passing session JSON on stdin. The JSON contains:
- `model.display_name` — current model name
- `context_window` — `used_percentage`, `context_window_size`, `current_usage.*`
- `cost.total_cost_usd`, `cost.total_duration_ms`
- `rate_limits.five_hour`, `rate_limits.seven_day` — each with `used_percentage` and `resets_at`
- `agent.name`, `worktree.branch`, `workspace.current_dir`

## Troubleshooting

- **Statusline not showing:** Check that `statusLine` is in settings.json and Claude Code version >= 1.0.33. Verify `node` is in PATH.
- **No colors:** Terminal must support true-color (most modern terminals do).
