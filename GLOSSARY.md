# loopline

A Claude Code mod that shows the current session's state above the prompt.

## Language

**Session state**:
What Claude Code and git know about the current session; the only thing loopline displays.

**Band**:
The lines loopline draws above the prompt (`AbovePrompt`); _полоса_ in `README.md`.
_Avoid_: statusline, status line (the command statusline this repository used to ship, and Claude Code's `statusLine` setting)

**Spinner suffix**:
The text loopline appends to Claude Code's spinner while a turn runs.

**Display item**:
One piece of session state shown in the band or the spinner suffix, such as ctx, cost or the cache clock.

**Working copy**:
This folder, loaded into every session of the maintainer through `CLAUDE_CODE_PLUGIN_DIRS` and listed as `loopline@inline`.

**Installed copy**:
loopline as users get it from the `nikitacodesave` marketplace, cached by `version`.

**Live session check**:
A real Claude Code session in tmux with the working copy loaded, its band read with `tmux capture-pane -p`; it stands in for `claude plugin test`, which cannot run here.

**Agent working files**:
`.scratch/`, `docs/agents/` and `docs/research/`: material for agents that is gitignored and stays on the maintainer's machine.
