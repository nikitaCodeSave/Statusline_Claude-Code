---
name: install-loopline
description: Install loopline for a user and migrate them off the old command statusline this repository used to ship. Use when asked to install, set up or migrate to loopline.
---

# Install loopline for a user

1. `claude --version` reports at least the minimum release `README.md` states (section «Установка»).
2. Run `claude plugin marketplace add nikitaCodeSave/Statusline_Claude-Code`, then `claude plugin install loopline@nikitacodesave`.
3. Migrate from the old command statusline this repository used to ship. If `statusLine` or `subagentStatusLine` in `~/.claude/settings.json` runs `statusline.js` or `statusline-subagent.js`, remove those two keys and keep every other key (2-space JSON). Then delete `~/.claude/statusline.js` and `~/.claude/statusline-subagent.js`. A `statusLine` that runs anything else is the user's own: ask before touching it.

Done when `claude plugin list` shows `loopline@nikitacodesave` enabled and no settings key runs the old scripts. Tell the user to run `/reload-plugins` in sessions already open.
