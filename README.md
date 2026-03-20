# Claude Code Statusline

Двухстрочная информационная панель для [Claude Code](https://docs.anthropic.com/en/docs/claude-code), отображающая в реальном времени состояние сессии прямо в терминале.

![Statusline examples](img/example.png)

## Зачем это нужно

Claude Code не показывает ключевую информацию о текущей сессии. Без этого вы работаете вслепую:

- **Контекст заканчивается незаметно** — auto-compact срабатывает на ~80%, и вы не знаете, насколько близко к этому порогу. Statusline показывает процент использования с цветовыми порогами.
- **Rate limits непрозрачны** — на подписках Pro/Max есть лимиты на 5 часов и 7 дней. Statusline показывает текущий % использования и обратный отсчёт до сброса.
- **Стоимость сессии скрыта** — для API-ключей важно видеть расходы в реальном времени.

## Что отображается

```
Строка 1:  [agent] · [branch] · [model]  │  [used/limit (pct%)]
Строка 2:  [$cost]  │  [5h pct% @reset · 7d pct% @reset]  │  [⏱ duration]
```

Все элементы адаптивны — если данных нет, элемент скрывается автоматически.

### Цветовые пороги

Применяются к контексту и rate limits:

| Диапазон | Цвет      | Значение                            |
|----------|-----------|-------------------------------------|
| < 70%    | зелёный   | Комфортная зона                     |
| 70–79%   | жёлтый    | Приближение к auto-compact (~80%)   |
| 80–89%   | оранжевый | Зона auto-compact                   |
| >= 90%   | красный   | Критично, контекст почти исчерпан   |

## Требования

- **Claude Code** >= 1.0.33 (поддержка `statusLine` в settings.json)
- **Node.js** >= 18
- Терминал с поддержкой true-color (RGB)

## Установка

### Автоматическая (рекомендуется)

Вставьте этот промпт в Claude Code:

```
Склонируй репозиторий https://github.com/nikitaCodeSave/Statusline_Claude-Code.git во временную директорию,
прочитай CLAUDE.md и выполни установку statusline.
После установки удали склонированный репозиторий и перечисли что было сделано.
```

### Ручная установка

<details>
<summary>Linux / macOS</summary>

```bash
git clone https://github.com/nikicat/claude-code-statusline.git
cd claude-code-statusline
cp statusline.js ~/.claude/statusline.js
```

Добавьте в `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js"
  }
}
```

Если файл уже содержит другие настройки, добавьте ключ `statusLine` к существующим. Перезапустите Claude Code.

</details>

<details>
<summary>Windows</summary>

```powershell
git clone https://github.com/nikicat/claude-code-statusline.git
cd claude-code-statusline
copy statusline.js %USERPROFILE%\.claude\statusline.js
```

Добавьте в `%USERPROFILE%\.claude\settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js"
  }
}
```

Если файл уже содержит другие настройки, добавьте ключ `statusLine` к существующим. Перезапустите Claude Code.

</details>

## Архитектура

```
settings.json
  └── statusLine.command → node ~/.claude/statusline.js (рендерер)
```

Claude Code передаёт JSON с данными сессии на stdin statusline.js при каждом обновлении. Скрипт рендерит две строки на stdout. Один файл, никаких хуков.

## Лицензия

MIT
