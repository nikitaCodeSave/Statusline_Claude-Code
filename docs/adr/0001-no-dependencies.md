---
status: accepted
---
# The mod has no dependencies, and a live session verifies it

loopline is code Claude Code loads and runs as it is: no `package.json`, no build, no dependency. On 2026-10-29 the `tsc -p .` check left `CLAUDE.md` and `README.md`: TypeScript is not installed on the maintainer's machine, adding it through `npx` would make it the mod's first external dependency, and a separate Claude Code session shows whether a change works (the live session check). A dependency, a build step or a type-check gate now needs the user's approval first. `.claude-plugin/types/` and `tsconfig.json` stay, as the API reference and for the editor.
