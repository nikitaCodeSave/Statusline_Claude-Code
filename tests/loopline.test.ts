import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, ProcessRunResult, SessionMeasureInput, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'loopline',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

function ran(stdout: string, exitCode = 0): ProcessRunResult {
  return { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

/** Answers every host call the mod makes; `npm test` fails as a tool call. */
function host(on: On, agents: AgentInfo[] = []) {
  const usage: { value: SessionUsage } = {
    value: {
      startedAt: NOW - 10 * 60_000,
      context: { window: 200_000, tokens: 50_000, percent: 25 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-06T15:00:00Z' }],
      cost: { usd: 0.25 },
    },
  }
  const seen = { toasts: [] as string[], commands: [] as string[] }
  on('process.run', ($, e) => {
    const [cmd, sub] = e.argv
    if (cmd === 'git' && sub === 'branch') return { value: ran('feature/loop\n') }
    if (cmd === 'git' && sub === 'status') return { value: ran(' M hooks/a.ts\n?? notes.md\n') }
    if (cmd === 'git' && sub === 'diff') return { value: ran(' 1 file changed, 12 insertions(+), 3 deletions(-)\n') }
    seen.commands.push(e.argv.join(' '))
    return { value: ran('', 1) }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  const compactAt: { value: number | null } = { value: null }
  // The breakdown is the engine's long /context shape; the mod reads its two auto-compact fields.
  on('session.usage', ($, e) => ({
    value: e.breakdown === undefined || compactAt.value === null
      ? usage.value
      : { ...usage.value, context: { ...usage.value.context, breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: compactAt.value } as never } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('agent.list', () => ({ value: agents }))
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'npm test'
    ? { isError: true, result: 'exit 1', text: 'Exit code 1' }
    : { result: 'ok' as never }))
  // Beneath the mod, the engine's spinner: it draws the word and the suffix it is handed.
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.word + e.props.suffix] })
  })
  return { usage, seen, compactAt }
}

const SPINNER = { plugin: 'loopline', component: 'Spinner', props: { word: 'Thinking', message: null, suffix: '…', mode: 'tool-use' } } as const

async function start($: Engine) {
  await $.session.start({ cwd: '/home/u/shop', surface: 'terminal', isInteractive: true })
}

async function edit($: Engine, file: string) {
  await $.tool.call({ tool: 'Edit', file_path: `/home/u/shop/${file}`, old_string: 'a', new_string: 'b', replace_all: false })
}

describe('a turn in the agent loop', () => {
  test('counts the turn live, then leaves the growth and the cache clock behind', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { usage, seen } = host(on)
    await start($)

    await $.turn.start({ text: 'make the tests pass', turnId: 't1' })
    await edit($, 'a.ts')
    await edit($, 'a.ts')
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await clock.advance(75_000)

    expect(seen.toasts).toContain('loopline: npm test failed 3× in a row. Is the agent stuck?')
    for (const surface of SURFACES) {
      const spinner = await $.ui.mount({ ...SPINNER, surface, requestId: 'main' })
      expect(await spinner.find({ text: 'Thinking · 5 tools · 2 edits/1 file…' })).toBeDefined()
      await spinner.unmount()
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await band.find({ text: /⟳/ })).toBeUndefined()
      expect(await band.find({ text: /⚠ npm test failed 3× in a row/ })).toBeDefined()
      expect(await band.find({ text: /feature\/loop \+12 −3 \(2\) · Opus5\.5 xhigh/ })).toBeDefined()
      expect(await band.find({ text: /cache/ })).toBeUndefined()
      await band.unmount()
    }

    usage.value = { ...usage.value, context: { window: 200_000, tokens: 62_000, percent: 31 } }
    await $.turn.complete({ answer: 'done', durationMs: 80_000, isAborted: false, turnId: 't1', reason: 'answer' })

    const idle = await $.ui.mount({ ...SPINNER, surface: 'terminal', requestId: 'main' })
    expect(await idle.find({ text: 'Thinking…' })).toBeDefined()
    await idle.unmount()
    let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /ctx .*31% \+12k/ })).toBeDefined()
    expect(await band.find({ text: /cache 60m/ })).toBeDefined()
    await band.unmount()

    await clock.advance(61 * 60_000)
    band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /cache cold/ })).toBeDefined()
    expect(await band.find({ text: /⏱ 1h12m/ })).toBeDefined()
    expect(seen.commands).toEqual([])
  })

  test('the stuck warning fires once per call and clears with the next turn', async ($, on) => {
    mock.clock(on, { now: NOW })
    const { seen } = host(on)
    await start($)
    await $.turn.start({ text: 'long one', turnId: 't1' })
    for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(seen.toasts.filter(t => t.includes('npm test failed'))).toHaveLength(1)
    await $.turn.complete({ answer: 'done', durationMs: 600_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.start({ text: 'next', turnId: 't2' })
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /⚠ npm test failed/ })).toBeUndefined()
  })

  test('the model and effort a request actually used replace the configured ones', async ($, on) => {
    mock.clock(on, { now: NOW })
    host(on)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await start($)
    const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })
    for await (const _chunk of step) { /* drain */ }
    await step.result
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /Sonnet5\.5 high/ })).toBeDefined()
    expect(await band.find({ text: /cache 60m/ })).toBeDefined()
  })
})

describe('the spinner', () => {
  test("a subagent's spinner keeps its own suffix", async ($, on) => {
    mock.clock(on, { now: NOW })
    host(on, [{ id: 'a1', description: 'explore', type: 'Explore', status: 'running' }])
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await edit($, 'a.ts')
    const sub = await $.ui.mount({ ...SPINNER, surface: 'terminal', requestId: 'a1' })
    expect(await sub.find({ text: 'Thinking…' })).toBeDefined()
    await sub.unmount()
    const main = await $.ui.mount({ ...SPINNER, surface: 'terminal', requestId: 'main' })
    expect(await main.find({ text: 'Thinking · 1 tool · 1 edit/1 file…' })).toBeDefined()
  })
})

describe('compaction', () => {
  test('the headroom to auto-compaction shows once it is close', async ($, on) => {
    mock.clock(on, { now: NOW })
    const { usage, compactAt } = host(on)
    compactAt.value = 60_000
    usage.value = { ...usage.value, context: { window: 200_000, tokens: 52_000, percent: 26 } }
    await start($)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /26% · compact in 8k/ })).toBeDefined()
  })

  test('each compaction is counted in the band', async ($, on) => {
    mock.clock(on, { now: NOW })
    host(on)
    await start($)
    let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /compacted/ })).toBeUndefined()
    await band.unmount()
    await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
    await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
    band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /compacted ×2/ })).toBeDefined()
  })
})

describe('measurements', () => {
  test('alerts once past a mark, and the band shows the pace that runs a window out', async ($, on) => {
    mock.clock(on, { now: NOW })
    const { seen } = host(on)
    await start($)
    const measure: SessionMeasureInput = {
      context: { window: 200_000, tokens: 172_000, percent: 86 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 96, resetsAt: '2026-10-06T14:00:00Z' }],
      cost: { usd: 2 },
      changed: ['context', 'rateLimits', 'cost'],
    }
    await $.session.measure(measure)
    await $.session.measure({ ...measure, changed: ['cost'] })

    expect(seen.toasts.filter(t => t.includes('context is 86% full'))).toHaveLength(1)
    expect(seen.toasts.filter(t => t.includes('5h limit at 96%, resets in 2h0m'))).toHaveLength(1)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ text: /ctx ▰▰▰▰▰▰▰▰▰▱ 172k\/200k 86%/ })).toBeDefined()
    expect(await band.find({ text: /\$2\.00  │  5h 96% ⇡ out ~7m  │  ⏱ 10m/ })).toBeDefined()
  })
})
