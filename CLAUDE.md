# Claude Code Statusline — Setup Guide for Agents

This file describes how to install and configure Claude Code Statusline for a user.

## What this project is

A two-line status bar for Claude Code that shows session state in real-time: context usage, model, git branch, cost, rate limits, and duration. An optional second renderer decorates the background-agent panel. Both are plain Node.js files configured in `settings.json`.

## Files

| File | Destination | Purpose |
|------|-------------|---------|
| `statusline.js` | `~/.claude/statusline.js` | Node.js renderer, outputs two colored lines to stdout |
| `statusline-subagent.js` | `~/.claude/statusline-subagent.js` | Optional. Decorates background-agent rows, outputs NDJSON `{id, content}` per task |
| `statusline-subagent.test.js` | — | Stays in the repo. `node --test statusline-subagent.test.js`, 15 scenarios |

## Installation steps

All commands below assume the current working directory is the root of this repository (where `statusline.js` is located).

### 0. Pre-flight checks

1. **Detect OS:** Run `uname -s` (Linux/Darwin) or check for Windows paths (`$env:OS`, `USERPROFILE`). Adapt commands accordingly.
2. **Check Node.js:** Run `node --version`. Must be >= 18. If missing — stop and tell the user to install Node.js.
3. **Check `~/.claude/` exists:** It should if Claude Code is installed. If not — `mkdir -p ~/.claude`.

### 1. Copy the renderer

Ask the user whether they also want the background-agent panel. If they don't, copy only `statusline.js` and skip the `subagentStatusLine` key — the main statusline works on its own.

```bash
cp statusline.js ~/.claude/statusline.js
cp statusline-subagent.js ~/.claude/statusline-subagent.js   # optional
```

On Windows (PowerShell):
```powershell
copy statusline.js $env:USERPROFILE\.claude\statusline.js
copy statusline-subagent.js $env:USERPROFILE\.claude\statusline-subagent.js
```

### 2. Configure settings.json

Read `~/.claude/settings.json`. It may not exist, may be empty, or may already contain settings.

**The following keys need to be set** (`subagentStatusLine` only if the second file was installed):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js"
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline-subagent.js"
  }
}
```

**Merge rules:**
- If the file doesn't exist — create it with the keys above.
- If the file exists — read it, parse as JSON, and set the keys (overwrite if already present — there can only be one statusline of each kind). Do NOT remove or overwrite other keys.
- Write the result back with proper JSON formatting (2-space indent).

### 3. Verify installation

Check that:
- `~/.claude/statusline.js` exists and is non-empty
- `~/.claude/settings.json` contains the `statusLine` key
- if the panel was installed — `~/.claude/statusline-subagent.js` exists and `subagentStatusLine` is set

Report to the user what was done and ask them to restart Claude Code.

## Requirements

- **Node.js >= 18**
- Terminal with true-color (RGB) support (most modern terminals, including Windows Terminal and VS Code Terminal)

Both renderers are fully cross-platform — they work anywhere Node.js runs. No bash, jq, or other dependencies.

## How it works

Claude Code calls `node ~/.claude/statusline.js` on every update, passing session JSON on stdin. The JSON contains:
- `model.display_name` — current model name
- `effort.level` — active reasoning effort for the current turn, after any silent downgrade (same value as `$CLAUDE_EFFORT`); absent on models without effort support
- `context_window` — `used_percentage`, `context_window_size`, `current_usage.*`
- `cost.total_cost_usd`, `cost.total_duration_ms`
- `rate_limits.five_hour`, `rate_limits.seven_day` — each with `used_percentage` and `resets_at`
- `agent.name`, `worktree.branch`, `workspace.current_dir`

`statusline-subagent.js` is called the same way, but with the background-task list: `{columns, tasks:[{id, name, status, model, effort, contextWindowSize, tokenCount, tokenSamples, startTime}]}`. It must answer with NDJSON — one `{"id","content"}` per task. Two contract details that shape the script:

- The decoration REPLACES the whole row after the status glyph, so each row has to carry its own name, tokens and elapsed — they are not appended to the default row.
- `content: ""` hides the row from the panel entirely, so an empty string must never be emitted.

## Troubleshooting

- **Statusline not showing:** Check that `statusLine` is in settings.json and Claude Code version >= 1.0.33. Verify `node` is in PATH.
- **Agent rows undecorated:** Only background (dispatched) agents get decorated — workflow rows and in-process teammates render the default way. The `subagentStatusLine` key was verified on Claude Code 2.1.220.
- **No colors:** Terminal must support true-color (most modern terminals do).
