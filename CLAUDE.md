# loopline: agent guide

loopline is a Claude Code mod: an in-process plugin of function hooks (Claude Code 2.1.287+). The repository root is both the plugin and its marketplace, `nikitacodesave`. `README.md` (Russian) describes it to users; this file covers installing it for a user and changing it.

## Scope: session state, displayed

loopline displays **session state**: what Claude Code and git know about the current session. That means model and effort, context with its growth, compactions and auto-compact headroom, cost, rate limits with their pace, the prompt-cache clock, the uncommitted diff, the main loop's turn counters, background agents and a repeated-failure warning. Hooks on events observe and return what `next(e)` returns. Drawing happens in two places only: the band above the prompt (`AbovePrompt`) and the spinner's suffix.

A new item fits when it is session state read from Claude Code or git. Project concerns (running or judging tests, gates, command guards) belong to the project's rules, settings hooks, `/goal` or CI. They were removed from loopline on purpose, along with desktop notifications, buttons, panes and a per-turn ledger, all of which proved to be noise in heavy agentic use. Propose a new display item to the user before building it.

## Install for a user

1. `claude --version` reports 2.1.287 or later.
2. Run `claude plugin marketplace add nikitaCodeSave/Statusline_Claude-Code`, then `claude plugin install loopline@nikitacodesave`.
3. Migrate from the old command statusline this repository used to ship. If `statusLine` or `subagentStatusLine` in `~/.claude/settings.json` runs `statusline.js` or `statusline-subagent.js`, remove those two keys and keep every other key (2-space JSON). Then delete `~/.claude/statusline.js` and `~/.claude/statusline-subagent.js`. A `statusLine` that runs anything else is the user's own: ask before touching it.

Done when `claude plugin list` shows `loopline@nikitacodesave` enabled and no settings key runs the old scripts. Tell the user to run `/reload-plugins` in sessions already open.

## Change the mod

- `hooks/format.ts` is pure: formatting, the band's lines, the spinner suffix. Most changes land here.
- `hooks/register.tsx` holds the hooks and every `$` call.
- `types/index.d.ts` is the `$.state` contract. It declares every key `register.tsx` reads or writes.

The maintainer loads this working copy in every session through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` of `~/.claude/settings.json` (`claude plugin list` shows `loopline@inline`). An edit therefore reaches the live session when the turn that made it ends.

The API's authority is the declaration file Claude Code writes into `.claude-plugin/types/` (gitignored) when it loads the mod with `claude --plugin-dir .`. The API is early access and moves between releases, so grep that file for the event or method at hand.

Done when every check holds:

- `claude plugin validate .` passes. Its one expected warning is about this file sitting at the plugin root.
- `tsc -p .` is clean (the mod must have loaded once with `--plugin-dir .`).
- `claude plugin test` passes, with a test for the changed behaviour: band text through `bandLines` in `tests/format.test.ts`, engine behaviour in `tests/loopline.test.ts`.
- When band or spinner output changed: `node --experimental-strip-types scripts/render-screens.ts` re-rendered `img/`, you looked at the pictures, and the README's element table and states match them.
- `version` in `.claude-plugin/plugin.json` is bumped when the change ships. Users get an update only with a new version: installed copies are cached by it.

Gotchas:

- Removing a `$.state` key makes a hot-reloading session log one `ui.render hook skipped … $.state.get refused` line: the old module instance draws once against the new contract. The next reload clears it.
- `claude plugin test` runs each file in a nested `claude` process. Under a managed `processWrapper` that refuses socket stdio, every file fails with "the file did not load". Report it to the user, and leave the wrapper and managed settings as they are.
