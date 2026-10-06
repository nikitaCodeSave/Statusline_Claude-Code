// Renders the README's pictures from the mod's own drawing code (hooks/format.ts), so they show
// exactly what the band and the spinner draw. Needs Node 22.6+ and Google Chrome (or Chromium):
//
//   node --experimental-strip-types scripts/render-screens.ts
//
// Colors approximate Claude Code's dark theme; the terminal draws the theme keys itself.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { bandLines, spinnerSuffix } from '../hooks/format.ts'
import type { BandView, Seg } from '../hooks/format.ts'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const COLUMNS = 120
const FONT_PX = 15
const LINE_PX = 22
const CHAR_PX = 9
const PAD_PX = 22

const THEME: Readonly<Record<string, string>> = {
  text: '#e4e4e4',
  success: '#4eba65',
  error: '#ff6b80',
  warning: '#ffc107',
  suggestion: '#b1b9f9',
  merged: '#af87ff',
  claude: '#d77757',
  caption: '#8a8f98',
  border: '#888888',
}

const reset = (ms: number) => new Date(NOW + ms).toISOString()

const CALM: BandView = {
  usage: {
    startedAt: NOW - 6 * MIN,
    ctxTokens: 48_000,
    ctxWindow: 1_000_000,
    ctxPercent: 5,
    usd: 0.42,
    limits: [
      { kind: 'five_hour', percentUsed: 3, resetsAt: reset(4 * HOUR + 12 * MIN) },
      { kind: 'seven_day', percentUsed: 4, resetsAt: reset(2 * DAY + 4 * HOUR) },
    ],
  },
  identity: { model: 'claude-opus-5-5', effort: 'xhigh', branch: 'main', dirty: 0, added: 0, removed: 0 },
  turn: null,
  ctxDelta: 9_000,
  cacheAt: NOW - 2 * MIN,
  compactions: 0,
  compactAt: 967_000,
  agents: { active: 0, total: 0 },
  warning: null,
  now: NOW,
  width: COLUMNS,
}

const EDITING: BandView = {
  ...CALM,
  usage: {
    ...CALM.usage!,
    startedAt: NOW - 25 * MIN,
    ctxTokens: 258_000,
    ctxPercent: 26,
    usd: 6.46,
    limits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: reset(3 * HOUR + 11 * MIN) },
      { kind: 'seven_day', percentUsed: 4, resetsAt: reset(2 * DAY + 4 * HOUR) },
    ],
  },
  identity: { ...CALM.identity, branch: 'feat/session-cache', dirty: 6, added: 184, removed: 37 },
  ctxDelta: 12_000,
  cacheAt: NOW - 19 * MIN,
}

const TURN = { id: 't', startedAt: NOW - 134_000, tools: 23, edits: 5, files: 3 }
const WORKING: BandView = { ...EDITING, turn: TURN, agents: { active: 2, total: 2 } }

type Row = { segs: Seg[]; mark?: boolean } | { caption: string } | { blank: true }

function spinnerRow(view: BandView, word: string, engine: string): Row {
  return {
    segs: [
      { text: `✻ ${word}`, color: 'claude' },
      { text: `${spinnerSuffix(view.turn) ?? ''}…`, color: 'claude' },
      { text: ` ${engine}`, dim: true },
    ],
  }
}

function band(view: BandView): Row[] {
  return bandLines(view).map((segs, i) => ({ segs, mark: i === 0 }))
}

const SCENARIOS: { caption: string; rows: Row[] }[] = [
  { caption: 'Спокойная сессия на подписке: чистое дерево, кэш тёплый ещё 58 минут', rows: band(CALM) },
  { caption: 'Незакоммиченные правки (+строки −строки, файлы) и прирост контекста за последний ход', rows: band(EDITING) },
  {
    caption: 'Claude работает: счётчики хода дописаны в спиннер, в работе два фоновых агента',
    rows: [spinnerRow(WORKING, 'Flambéing', '(2m 14s, 12.4k tokens)'), { blank: true }, ...band(WORKING)],
  },
  {
    caption: 'До автосжатия осталось 137k токенов, контекст уже сжимался один раз',
    rows: band({
      ...EDITING,
      usage: { ...EDITING.usage!, startedAt: NOW - 3 * HOUR - 40 * MIN, ctxTokens: 830_000, ctxPercent: 83, usd: 41.2 },
      ctxDelta: 41_000,
      compactions: 1,
    }),
  },
  {
    caption: 'Лимит 5h кончится через ~1h17m, раньше сброса: вместо времени сброса показан темп',
    rows: band({
      ...EDITING,
      usage: {
        ...EDITING.usage!,
        startedAt: NOW - 2 * HOUR - 50 * MIN,
        usd: 27.9,
        limits: [
          { kind: 'five_hour', percentUsed: 70, resetsAt: reset(2 * HOUR) },
          { kind: 'seven_day', percentUsed: 41, resetsAt: reset(3 * DAY + 2 * HOUR) },
        ],
      },
    }),
  },
  {
    caption: 'Перерыв больше часа: кэш остыл, следующий запрос заново запишет весь контекст',
    rows: band({ ...EDITING, usage: { ...EDITING.usage!, startedAt: NOW - 2 * HOUR - 10 * MIN }, cacheAt: NOW - 75 * MIN }),
  },
  {
    caption: 'Одна и та же команда падает третий раз подряд',
    rows: [
      spinnerRow({ ...EDITING, turn: { ...TURN, tools: 14, edits: 2, files: 1 } }, 'Simmering', '(48s, 6.1k tokens)'),
      { blank: true },
      ...band({ ...EDITING, turn: { ...TURN, tools: 14 }, warning: 'npm test failed 3× in a row' }),
    ],
  },
  {
    caption: 'API-ключ без подписки: лимитов нет, кэш живёт 5 минут',
    rows: band({
      ...CALM,
      usage: { ...CALM.usage!, startedAt: NOW - 14 * MIN, ctxTokens: 61_000, ctxWindow: 200_000, ctxPercent: 31, usd: 2.17, limits: [] },
      identity: { ...CALM.identity, model: 'claude-sonnet-5-5', effort: 'high' },
      cacheAt: NOW - 4.5 * MIN,
      compactAt: null,
    }),
  },
  {
    caption: 'Узкий терминал: первыми прячутся бар, токены, прирост и время сброса',
    rows: band({ ...EDITING, width: 46 }),
  },
]

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function span(seg: Seg): string {
  const style = [
    `color:${THEME[seg.color ?? 'text'] ?? seg.color}`,
    seg.dim === true ? 'opacity:.55' : '',
    seg.bold === true ? 'font-weight:700' : '',
  ].filter(Boolean).join(';')
  return `<span style="${style}">${escape(seg.text)}</span>`
}

function rowHtml(row: Row): string {
  if ('blank' in row) return '<div>&nbsp;</div>'
  if ('caption' in row) return `<div style="color:${THEME.caption}">${escape(row.caption)}</div>`
  const used = row.segs.reduce((n, s) => n + [...s.text].length, 0)
  const mark = row.mark === true ? `${' '.repeat(Math.max(1, COLUMNS - used))}<span style="opacity:.45">[-]</span>` : ''
  return `<div>${row.segs.map(span).join('')}${mark}</div>`
}

function promptBox(): Row[] {
  const inner = COLUMNS + 2
  return [
    { segs: [{ text: `╭${'─'.repeat(inner)}╮`, color: 'border' }] },
    { segs: [{ text: '│', color: 'border' }, { text: ' > ' }, { text: ' '.repeat(inner - 3) }, { text: '│', color: 'border' }] },
    { segs: [{ text: `╰${'─'.repeat(inner)}╯`, color: 'border' }] },
  ]
}

function render(name: string, rows: Row[]): void {
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#1b1d22}
    body{padding:${PAD_PX}px;font:${FONT_PX}px/${LINE_PX}px 'JetBrainsMono Nerd Font Mono','JetBrains Mono','DejaVu Sans Mono',monospace;white-space:pre;color:${THEME.text}}
  </style><body>${rows.map(rowHtml).join('')}</body>`
  const dir = mkdtempSync(join(tmpdir(), 'loopline-screens-'))
  const page = join(dir, 'page.html')
  writeFileSync(page, html)
  const width = (COLUMNS + 6) * CHAR_PX + 2 * PAD_PX
  const height = rows.length * LINE_PX + 2 * PAD_PX
  const out = resolve(import.meta.dirname, '..', 'img', name)
  execFileSync(process.env.CHROME ?? 'google-chrome', [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`,
  ], { stdio: 'ignore' })
  rmSync(dir, { recursive: true, force: true })
  console.log(`img/${name}: ${rows.length} rows`)
}

render('overview.png', [
  spinnerRow(WORKING, 'Flambéing', '(2m 14s, 12.4k tokens)'),
  { blank: true },
  ...band(WORKING),
  ...promptBox(),
])

render('states.png', SCENARIOS.flatMap(({ caption, rows }, i) => [
  ...(i > 0 ? [{ blank: true } as const] : []),
  { caption: `${i + 1}. ${caption}` },
  ...rows,
]))
