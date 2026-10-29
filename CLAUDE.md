# loopline: agent guide

loopline is a Claude Code mod: an in-process plugin of function hooks. The repository root is both the plugin and its marketplace, `nikitacodesave`. `README.md` (Russian) describes it to users; this file covers changing it, and the `install-loopline` skill installs it for a user.

## Scope: session state, displayed

loopline displays **session state**: what Claude Code and git know about the current session. That means model and effort, context with its growth, compactions and auto-compact headroom, cost, rate limits with their pace, the prompt-cache clock, the uncommitted diff, the main loop's turn counters, background agents and a repeated-failure warning. Hooks on events observe and return what `next(e)` returns. Drawing happens in two places only: the band above the prompt (`AbovePrompt`) and the spinner's suffix.

A new item fits when it is session state read from Claude Code or git. Project concerns (running or judging tests, gates, command guards) belong to the project's rules, settings hooks, `/goal` or CI. They were removed from loopline on purpose, along with desktop notifications, buttons, panes and a per-turn ledger, all of which proved to be noise in heavy agentic use.

## Boundaries

- **Ask first:** a new display item (Scope above) · a dependency: the mod has none, and Claude Code runs it as it is.
- **Never:** force-push or a hard reset · edit `.claude-plugin/types/`, which Claude Code writes · change the managed `processWrapper` or managed settings. `.claude/settings.json` denies those a permission rule can express.

## Change the mod

- `hooks/format.ts` is pure: formatting, the band's lines, the spinner suffix. Most changes land here.
- `hooks/register.tsx` holds the hooks and every `$` call.
- `types/index.d.ts` is the `$.state` contract. It declares every key `register.tsx` reads or writes.

The maintainer loads this working copy in every session through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` of `~/.claude/settings.json` (`claude plugin list` shows `loopline@inline`). An edit therefore reaches the live session when the turn that made it ends.

Bring `main` up to date with `git pull --ff-only` before the first edit. Work on `main` by default; a skill or task that needs its own branch or worktree may make one. Commit finished work on the current branch and push it without asking.

Файлы проекта (`CLAUDE.md`, `docs/adr/`, `GLOSSARY.md`, `.claude/skills/`) и сообщения коммитов пишутся на русском; идентификаторы, команды, пути и имена из API остаются как есть (ADR 0006).

loopline follows the newest Claude Code release: use the API and the props as the current declarations spell them (`weight`, not the deprecated `bold`), and when a change needs a newer release, raise the minimum in `README.md`, the one place it is stated. Older releases go unsupported.

The API's authority is the declaration file Claude Code writes into `.claude-plugin/types/` (gitignored) when it loads the mod with `claude --plugin-dir .`. The API is early access and moves between releases, so grep that file for the event or method at hand.

Commands:

```bash
claude plugin validate .   # expected warnings: this file at the plugin root; ICON_MISSING among the plugin directory checks
claude plugin test         # tests/; fails under the maintainer's processWrapper, so the live session check runs instead (Gotchas)
node --experimental-strip-types scripts/render-screens.ts   # re-renders img/
```

Done = `claude plugin validate .` exits 0 and the live session check below shows the change; report each command with its output, and the band as `tmux capture-pane -p` printed it.

Always:

- A test records the changed behaviour: band text through `bandLines` in `tests/format.test.ts`, engine behaviour in `tests/loopline.test.ts`.
- When band or spinner output changed, re-render `img/`, look at the pictures, and make the README's element table and states match them.
- Bump `version` in `.claude-plugin/plugin.json` when the change ships. Users get an update only with a new version: installed copies are cached by it.

Live session check: the band as the user sees it, drawn by the real engine.

1. Make a throwaway git repo under `/tmp` with one commit and an uncommitted change, so the diff segment shows.
2. Start `claude` on the cheapest model there in a detached `tmux` session 180 columns wide; the working copy loads by itself. Answer the trust prompt with Down, Enter.
3. Drive it with `tmux send-keys`, sending Enter as its own call, and once more when the prompt stays in the input. Read the band with `tmux capture-pane -p`, 5 s after the action for anything the poll refreshes.
4. For compaction, use a model with a 200k context window and fill the context by having Claude read large files. Only a session with a compaction window compacts at the threshold: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=120000` (100000 at least) brings `compact in N` and a mid-turn auto-compaction.
5. Kill the tmux session, list the repo and its transcripts folder `~/.claude/projects/-tmp-<name>`, then delete both.

Gotchas:

- `compacted ×N` counts the `"subtype":"compact_boundary"` rows of the session's transcript (`hooks/register.tsx`, `refreshCompactions`). No event can tell it: where managed settings exist or the login is Team or Enterprise, the built-in guard `cc-plugin-sec-default` passes `session.compact` and `classic.*` over every installed mod. The transcript's entry format is internal to Claude Code, so when the count stops showing after an update, check that row first.
- Removing a `$.state` key makes a hot-reloading session log one `ui.render hook skipped … $.state.get refused` line: the old module instance draws once against the new contract. The next reload clears it.
- `claude plugin test` runs each file in a nested `claude` process. Under the maintainer's managed `processWrapper`, which refuses socket stdio, every file fails with "the file did not load". The live session check is the run here, chosen by the maintainer over CI.

## How we work

- A non-trivial change starts with an interview: ask until you could write the spec, then write it where the Agent skills block says: what and why, acceptance criteria as checks, non-goals, and any interface the user fixed, copied verbatim. Then build it in the same session.
- Work that won't fit one session: say so and propose a split; the user runs `/to-tickets`. Each ticket is built in a fresh session from tests written beforehand, in a separate session, from its criteria. The implementer does not edit those tests; when one looks wrong, it says so. Large and still unclear: propose `/wayfinder` first.
- One implementer at a time: no parallel fan-out on a bounded change.
- A test must be able to fail. A bug is reproduced in the live session check before the fix, then recorded in a test.
- Review: `/code-review` on a substantive diff. A change that adds a `$` call, an environment read or a process (the README's security section lists them all), or that touches the `$.state` contract or the transcript reading, gets a fresh session reviewing it against the spec: correctness only, file:line, at most three rounds, then rethink the approach.
- Stuck twice on the same thing: stop and say what is needed: a decision, a credential, a service.

## Project knowledge

Each file is created when first needed, never empty. Files describe the present; history is git and its commit bodies, so no archive folders. `.scratch/`, `docs/agents/` and `docs/research/` are gitignored: they stay on this machine and keep no history. Nothing here is removed or closed without the user's confirmation: `/harness:wrap` proposes it, acts only after they confirm, and commits the work first.

| Where | Holds | When it goes |
|---|---|---|
| `GLOSSARY.md` | domain terms, added the first time one is used or settled; a name replaced by a better one stays under `_Avoid_` | a term only dropped work used |
| `docs/adr/NNNN-<slug>.md` | decisions that are hard to reverse or that later work must follow, including ones the user mentions "for later", written in the session where they were made, each with a status: `accepted`, `deprecated` or `superseded by NNNN`; what it rests on from a spec or research note is written into the ADR itself, since those files keep no history | never: a changed decision is a new ADR, and setting the old one's status is the only edit an accepted ADR takes |
| `.scratch/<feature>/` | open work only: its spec and tickets | finished and reviewed: once every line of the spec lives in a test, an ADR, the glossary or the commit message, the folder goes. Dropped: only when the user says so; what later work must follow goes to an ADR first, its tickets close `wontfix` with the reason, and code and tests built only for it are removed |
| `docs/research/<slug>.md` | research for a decision still open | once its decision is recorded |
| `.out-of-scope/<concept>.md` | a request the user rejected that later work must not re-propose, and why | when the user reverses the rejection |

Before changing an area, read the glossary entries and the ADRs that touch it, skipping those marked deprecated or superseded.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
