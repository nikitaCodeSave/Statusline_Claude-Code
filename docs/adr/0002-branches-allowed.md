---
status: accepted
---
# Branches and worktrees are allowed; `main` stays the default

Since 3785c5c work happened on `main` only, with no other branch. mattpocock-skills' `/implement-spec`, `/prototype` and `/wayfinder` make a branch or a worktree as one of their steps and would stall on that rule, so on 2026-10-29 the user allowed them. Work starts on `main`, brought up to date with `git pull --ff-only`; a skill or task that needs its own branch or worktree may make one. `.claude/settings.json` therefore denies no branch command; force-push and `git reset --hard` stay denied.
