---
status: accepted
---
# Claude commits, pushes and works with GitHub without asking

On 2026-10-29 the user asked Claude to push and work with GitHub without waiting for confirmations. Claude commits finished work on the current branch, pushes it, and uses `gh` for issues, pull requests, runs and releases; `.claude/settings.json` allows `git add`, `commit`, `push`, `pull`, `fetch` and those `gh` commands, so no permission prompt stops them. It also allows editing `CLAUDE.md`, `GLOSSARY.md`, `docs/` and `.claude/skills/`: auto mode's classifier gave no verdict on those edits, which stalled every change to the project's documents. What can lose work stays guarded: force-push (a `+` refspec included), `git reset --hard`, `gh repo delete`, `gh repo archive` and `gh release delete` are denied, and `git rebase` and `git commit --amend` still ask. A push that carries a bumped `version` ships to every user, so the report says so.
