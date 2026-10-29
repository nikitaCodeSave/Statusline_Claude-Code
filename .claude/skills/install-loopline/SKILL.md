---
name: install-loopline
description: Установить loopline пользователю и перевести его со старого командного statusline, который раньше поставлял этот репозиторий. Использовать, когда просят установить loopline, настроить его или перейти на него.
---

# Установка loopline пользователю

1. `claude --version` сообщает релиз не ниже минимального, который указан в `README.md` (раздел «Установка»).
2. Выполните `claude plugin marketplace add nikitaCodeSave/Statusline_Claude-Code`, затем `claude plugin install loopline@nikitacodesave`.
3. Переведите пользователя со старого командного statusline, который раньше поставлял этот репозиторий. Если `statusLine` или `subagentStatusLine` в `~/.claude/settings.json` запускает `statusline.js` или `statusline-subagent.js`, удалите эти два ключа и сохраните все остальные (JSON с отступом в 2 пробела). Затем удалите `~/.claude/statusline.js` и `~/.claude/statusline-subagent.js`. `statusLine`, который запускает что-то другое, принадлежит пользователю: спросите, прежде чем его трогать.

Готово, когда `claude plugin list` показывает `loopline@nikitacodesave` включённым и ни один ключ настроек не запускает старые скрипты. Скажите пользователю выполнить `/reload-plugins` в уже открытых сессиях.
