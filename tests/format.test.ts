import { describe, expect, test } from 'claude-code/testing'

import {
  bandLines,
  bar,
  callKey,
  compactLeft,
  configuredEffort,
  crossed,
  editedPath,
  exhaustIn,
  fit,
  fmtDelta,
  fmtDuration,
  fmtReset,
  fmtTokens,
  parseShortstat,
  shortModel,
  spinnerSuffix,
} from '../hooks/format'
import type { BandView, Seg } from '../hooks/format'

const NOW = Date.parse('2026-10-06T12:00:00Z')

const VIEW: BandView = {
  usage: {
    startedAt: NOW - 72 * 60_000,
    ctxTokens: 45_000,
    ctxWindow: 200_000,
    ctxPercent: 23,
    usd: 1.234,
    limits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-06T14:10:00Z' },
      { kind: 'seven_day', percentUsed: 12 },
    ],
  },
  identity: { model: 'claude-opus-5-5', effort: 'xhigh', branch: 'main', dirty: 6, added: 184, removed: 37 },
  turn: null,
  ctxDelta: 12_000,
  cacheAt: NOW - 19 * 60_000,
  compactions: 0,
  compactAt: null,
  agents: { active: 0, total: 0 },
  warning: null,
  now: NOW,
  width: 200,
}

const text = (line: readonly Seg[] | undefined) => (line ?? []).map(s => s.text).join('')

describe('formatting', () => {
  test('tokens, deltas, durations and resets', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(45_000)).toBe('45k')
    expect(fmtTokens(1_000_000)).toBe('1m')
    expect(fmtTokens(1_200_000)).toBe('1.2m')
    expect(fmtDelta(12_400)).toBe('+12k')
    expect(fmtDelta(-150_000)).toBe('−150k')
    expect(fmtDelta(400)).toBeNull()
    expect(fmtDuration(40_000)).toBe('<1m')
    expect(fmtDuration(125_000)).toBe('2m')
    expect(fmtDuration(62 * 60_000)).toBe('1h02m')
    expect(fmtReset('2026-10-06T14:10:00Z', NOW)).toBe('2h10m')
    expect(fmtReset('2026-10-09T16:00:00Z', NOW)).toBe('3d4h')
  })

  test('model ids shorten, display names pass through', () => {
    expect(shortModel('claude-opus-5-5')).toBe('Opus5.5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('Haiku4.5')
    expect(shortModel('claude-sonnet-5-5[1m]')).toBe('Sonnet5.5(1m)')
    expect(shortModel('Opus 5.5')).toBe('Opus 5.5')
  })

  test('effort comes from the settings for the model first, then the global one', () => {
    const perModel = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, effortLevel: 'medium' }
    expect(configuredEffort(perModel, 'claude-opus-5-5')).toBe('xhigh')
    expect(configuredEffort(perModel, 'claude-opus-5-5[1m]')).toBe('xhigh')
    expect(configuredEffort(perModel, 'claude-opus-5-5-20261001')).toBe('xhigh')
    expect(configuredEffort(perModel, 'claude-sonnet-5-5')).toBe('medium')
    expect(configuredEffort({ modelSettings: { 'claude-opus-5-5': {} } }, 'claude-opus-5-5')).toBeNull()
    expect(configuredEffort({}, 'claude-opus-5-5')).toBeNull()
  })

  test('bar, crossed and shortstat', () => {
    expect(bar(23)).toBe('▰▰▱▱▱▱▱▱▱▱')
    expect(crossed(60, 90, [70, 85])).toBe(85)
    expect(crossed(72, 80, [70, 85])).toBeNull()
    expect(parseShortstat(' 6 files changed, 184 insertions(+), 37 deletions(-)\n')).toEqual({ added: 184, removed: 37 })
    expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ added: 1, removed: 0 })
  })

  test('calls are keyed for the stuck detector; edits name their file', () => {
    expect(callKey('Bash', { command: '  npm   test ' })).toEqual({ key: 'Bash npm test', label: 'npm test' })
    expect(callKey('mcp__x__y', { q: 1, tool_use_id: 'abc' }).key).toBe('mcp__x__y {"q":1}')
    expect(editedPath('NotebookEdit', { notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
    expect(editedPath('Read', { file_path: '/a.ts' })).toBeNull()
  })
})

describe('pace', () => {
  test('warns only when the window runs out before it resets', () => {
    const out = exhaustIn({ kind: 'five_hour', percentUsed: 70, resetsAt: '2026-10-06T14:00:00Z' }, NOW) ?? 0
    expect(out).toBeGreaterThan(77 * 60_000)
    expect(out).toBeLessThan(78 * 60_000)
    expect(exhaustIn({ kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-06T14:10:00Z' }, NOW)).toBeNull()
  })

  test('stays quiet early in a window, under 10% and for unknown windows', () => {
    expect(exhaustIn({ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-10-06T16:50:00Z' }, NOW)).toBeNull()
    expect(exhaustIn({ kind: 'five_hour', percentUsed: 8, resetsAt: '2026-10-06T12:30:00Z' }, NOW)).toBeNull()
    expect(exhaustIn({ kind: 'spend_limit', percentUsed: 90, resetsAt: '2026-10-06T12:30:00Z' }, NOW)).toBeNull()
  })
})

describe('band', () => {
  test('idle: two lines, nothing about the loop', () => {
    const lines = bandLines(VIEW)
    expect(text(lines[0])).toBe('main +184 −37 (6) · Opus5.5 xhigh  │  ctx ▰▰▱▱▱▱▱▱▱▱ 45k/200k 23% +12k')
    expect(text(lines[1])).toBe('$1.23  │  5h 34% @2h10m · 7d 12%  │  cache 41m  │  ⏱ 1h12m')
    expect(lines).toHaveLength(2)
  })

  test('a compacted context says so and keeps it when the line is narrow', () => {
    expect(text(bandLines({ ...VIEW, compactions: 2 })[0])).toBe('main +184 −37 (6) · Opus5.5 xhigh  │  ctx ▰▰▱▱▱▱▱▱▱▱ 45k/200k 23% +12k · compacted ×2')
    expect(text(bandLines({ ...VIEW, compactions: 1, width: 50 })[0])).toBe('main +184 −37 (6) · Opus5.5 xhigh  │  ctx 23% · compacted ×1')
  })

  test('a window running out early replaces its reset with the pace', () => {
    const usage = { ...VIEW.usage!, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: '2026-10-06T14:00:00Z' }] }
    expect(text(bandLines({ ...VIEW, usage })[1])).toBe('$1.23  │  5h 70% ⇡ out ~1h17m  │  cache 41m  │  ⏱ 1h12m')
  })

  test('the cache goes cold, runs on a five-minute clock off a subscription, and hides while working', () => {
    expect(text(bandLines({ ...VIEW, cacheAt: NOW - 61 * 60_000 })[1])).toContain('cache cold')
    const api = { ...VIEW.usage!, limits: [] }
    expect(text(bandLines({ ...VIEW, usage: api, cacheAt: NOW - 270_000 })[1])).toBe('$1.23  │  cache 1m  │  ⏱ 1h12m')
    const working = bandLines({ ...VIEW, turn: { id: 't', startedAt: NOW, tools: 0, edits: 0, files: 0 } })
    expect(text(working[1])).not.toContain('cache')
  })

  test('working: the band keeps agents and a stuck call; the turn itself goes to the spinner', () => {
    const turn = { id: 't', startedAt: NOW - 134_000, tools: 23, edits: 5, files: 3 }
    const lines = bandLines({ ...VIEW, turn, agents: { active: 2, total: 3 }, warning: 'npm test failed 3× in a row' })
    expect(text(lines[2])).toBe('⧉ 2 agents  │  ⚠ npm test failed 3× in a row')
    expect(bandLines({ ...VIEW, turn })).toHaveLength(2)
    expect(spinnerSuffix(turn)).toBe(' · 23 tools · 5 edits/3 files')
    expect(spinnerSuffix({ ...turn, edits: 0, files: 0, tools: 1 })).toBe(' · 1 tool')
    expect(spinnerSuffix({ ...turn, tools: 0 })).toBeNull()
    expect(spinnerSuffix(null)).toBeNull()
  })

  test('auto-compaction shows up only in its last fifth', () => {
    expect(compactLeft(VIEW.usage, null)).toBeNull()
    expect(compactLeft(VIEW.usage, 200_000)).toBeNull()
    expect(text(bandLines({ ...VIEW, compactAt: 50_000 })[0])).toBe('main +184 −37 (6) · Opus5.5 xhigh  │  ctx ▰▰▱▱▱▱▱▱▱▱ 45k/200k 23% +12k · compact in 5k')
    expect(text(bandLines({ ...VIEW, compactAt: 40_000, compactions: 1 })[0])).toContain('23% +12k · compact due · compacted ×1')
  })

  test('idle with background agents still running', () => {
    expect(text(bandLines({ ...VIEW, agents: { active: 1, total: 1 } })[2])).toBe('⧉ 1 agent')
  })

  test('narrow: optional runs go first, with their separators', () => {
    const [first, second] = bandLines({ ...VIEW, width: 40 })
    expect(text(first)).toBe('main +184 −37 (6) · Opus5.5 xhigh  │  ctx 23%')
    expect(text(second)).toBe('$1.23  │  5h 34% · 7d 12%  │  cache 41m')
    expect(fit([{ text: 'abc' }, { text: 'def', optional: true }], 3)).toEqual([{ text: 'abc' }])
  })
})
