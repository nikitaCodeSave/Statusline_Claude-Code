---
status: accepted
---
# Agent working files stay off GitHub

The repository root is the plugin, so every committed file ships inside users' installed copies, and users install with `claude plugin` and need only the mod and `README.md`. `.scratch/` (specs and tickets), `docs/agents/` (the mattpocock-skills setup, rebuilt by `/setup-matt-pocock-skills`) and `docs/research/` are gitignored and live on the maintainer's machine only. The guide and the decisions for changing the mod (`CLAUDE.md`, `.claude/`, `docs/adr/`, `GLOSSARY.md`) stay in git for their history and backup; ignoring the whole agent layer was considered on 2026-10-29 and rejected for that reason. Since a spec or research note leaves no history, an ADR writes in what it rests on from one instead of citing its path.
