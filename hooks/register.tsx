import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, ToolCallInput, ToolCallResult } from 'claude-code'

import {
  bandLines,
  callKey,
  crossed,
  editedPath,
  fmtReset,
  isActiveAgent,
  limitLabel,
  parseShortstat,
  spinnerSuffix,
  toUsage,
} from './format'
import type { Seg } from './format'

const CONTEXT_MARKS = [70, 85]
const LIMIT_MARKS = [80, 95]
const POLL_MS = 5_000
const GIT_STALE_MS = 15_000
const GIT_MIN_GAP_MS = 3_000

const usageAtom = atom({ plugin: 'loopline', key: 'usage' } as const, null)
const identityAtom = atom({ plugin: 'loopline', key: 'identity' } as const, {
  model: null,
  effort: null,
  branch: null,
  dirty: 0,
  added: 0,
  removed: 0,
})
const turnAtom = atom({ plugin: 'loopline', key: 'turn' } as const, null)
const agentsAtom = atom({ plugin: 'loopline', key: 'agents' } as const, { active: 0, total: 0 })
const warningAtom = atom({ plugin: 'loopline', key: 'warning' } as const, null)
const ctxDeltaAtom = atom({ plugin: 'loopline', key: 'ctxDelta' } as const, null)
const cacheAtom = atom({ plugin: 'loopline', key: 'cacheAt' } as const, null)
const compactionsAtom = atom({ plugin: 'loopline', key: 'compactions' } as const, 0)
const compactAtAtom = atom({ plugin: 'loopline', key: 'compactAt' } as const, null)

// Bookkeeping no drawing reads: a reload starts it over, which costs at most a repeated alert.
let turnFiles = new Set<string>()
const failStreaks = new Map<string, number>()
const warnedKeys = new Set<string>()
const limitSeen = new Map<string, number>()
let ctxSeen: number | undefined
let gitCheckedAt = 0
let modelSeen = ''

type Settings = { stuckThreshold: number }

export const register: Register = (on, options) => {
  const settings: Settings = {
    stuckThreshold: Math.max(2, Number(options.stuckThreshold ?? 3)),
  }

  on('session.start', async ($, e, next) => {
    await refreshAll($)
    $.clock.every(POLL_MS, () => void poll($))
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a new session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    resetBookkeeping()
    await refreshAll($)
    if (typeof e.seconds_since_last_response === 'number') {
      const at = (await $.clock.now()) - e.seconds_since_last_response * 1000
      await update($, cacheAtom, () => at)
    }
    return next(e)
  })

  on('classic.PostCompact', async ($, e, next) => {
    await update($, compactionsAtom, n => n + 1)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const { context } = await $.session.usage()
    turnFiles = new Set()
    failStreaks.clear()
    warnedKeys.clear()
    await update($, turnAtom, () => ({
      id: e.turnId,
      startedAt: now,
      tools: 0,
      edits: 0,
      files: 0,
      ...(context.tokens !== undefined ? { ctxAtStart: context.tokens } : {}),
    }))
    await update($, warningAtom, () => null)
    return next(e)
  })

  // Each model request carries the model and the effort actually used, after any downgrade;
  // its response restarts the prompt cache's clock.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort === undefined ? null : String(e.effort)
    const seen = `${e.model}|${effort}`
    if (e.agentId === undefined && seen !== modelSeen) {
      modelSeen = seen
      await update($, identityAtom, id => ({ ...id, model: e.model, effort }))
    }
    const result = yield* next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, cacheAtom, () => now)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await recordCall($, e, ran, settings)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await finishTurn($)
    return done
  })

  on('session.measure', async ($, e, next) => {
    const prev = await read($, usageAtom)
    const startedAt = prev?.startedAt ?? (await $.session.usage()).startedAt
    await update($, usageAtom, () => toUsage(startedAt, e.context, e.rateLimits, e.cost))
    await alertThresholds($, e.context.percent, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const lines = bandLines({
      usage: await read($, usageAtom),
      identity: await read($, identityAtom),
      turn: await read($, turnAtom),
      ctxDelta: await read($, ctxDeltaAtom),
      cacheAt: await read($, cacheAtom),
      compactions: await read($, compactionsAtom),
      compactAt: await read($, compactAtAtom),
      agents: await read($, agentsAtom),
      warning: await read($, warningAtom),
      now: await $.clock.now(),
      width: e.props.bodyColumns,
    })
    const theirs = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {theirs}
        {lines.map(line => (
          <Text wrap="truncate-end">
            {line.map(seg => <Text {...segProps(seg)}>{seg.text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })

  // The spinner already shows the turn's time and tokens; it gains what the turn did.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const suffix = spinnerSuffix(await read($, turnAtom))
    if (suffix === null) return next(e)
    const agents = await $.agent.list()
    if (agents.some(a => a.id === e.requestId)) return next(e)
    return next({ ...e, props: { ...e.props, suffix: suffix + e.props.suffix } })
  })
}

function segProps(seg: Seg): { color?: string; dimColor?: true; bold?: true } {
  return {
    ...(seg.color !== undefined ? { color: seg.color } : {}),
    ...(seg.dim === true ? { dimColor: true as const } : {}),
    ...(seg.bold === true ? { bold: true as const } : {}),
  }
}

function resetBookkeeping(): void {
  turnFiles = new Set()
  failStreaks.clear()
  warnedKeys.clear()
  limitSeen.clear()
  ctxSeen = undefined
  modelSeen = ''
}

async function refreshAll($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  await update($, usageAtom, () => toUsage(usage.startedAt, usage.context, usage.rateLimits, usage.cost))
  const model = await $.session.model()
  const configured = await $.settings.read()
  const effort = typeof configured.effortLevel === 'string' ? configured.effortLevel : null
  await update($, identityAtom, id => ({ ...id, model: id.model ?? model, effort: id.effort ?? effort }))
  await refreshCompactAt($)
  await refreshGit($, await $.clock.now())
  await refreshAgents($)
}

/** Where auto-compaction runs: from the local /context estimate, which sends no request. */
async function refreshCompactAt($: EngineInterface): Promise<void> {
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const at = breakdown?.isAutoCompactEnabled === true ? breakdown.autoCompactThreshold ?? null : null
  await update($, compactAtAtom, () => at)
}

async function poll($: EngineInterface): Promise<void> {
  await refreshAgents($)
  const now = await $.clock.now()
  if (now - gitCheckedAt >= GIT_STALE_MS) await refreshGit($, now)
  // Nothing else redraws on time alone: keep the cache countdown and the session clock current.
  $.ui.invalidate('ui.render')
}

async function refreshGit($: EngineInterface, now: number): Promise<void> {
  gitCheckedAt = now
  const current = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5_000 }).catch(() => null)
  if (current === null || current.exitCode !== 0) {
    await update($, identityAtom, id => ({ ...id, branch: null, dirty: 0, added: 0, removed: 0 }))
    return
  }
  let branch = current.stdout.trim()
  if (branch === '') {
    const head = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 5_000 }).catch(() => null)
    branch = head?.stdout.trim() || 'HEAD'
  }
  const status = await $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 5_000 }).catch(() => null)
  const dirty = status === null ? 0 : status.stdout.split('\n').filter(Boolean).length
  const stat = dirty === 0
    ? null
    : await $.process.run(['git', 'diff', 'HEAD', '--shortstat'], { timeoutMs: 5_000 }).catch(() => null)
  const { added, removed } = parseShortstat(stat !== null && stat.exitCode === 0 ? stat.stdout : '')
  await update($, identityAtom, id => ({ ...id, branch, dirty, added, removed }))
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const list = await $.agent.list()
  const active = list.filter(a => isActiveAgent(a.status)).length
  const prev = await read($, agentsAtom)
  if (prev.active !== active || prev.total !== list.length) {
    await update($, agentsAtom, () => ({ active, total: list.length }))
  }
}

async function recordCall($: EngineInterface, e: ToolCallInput, ran: ToolCallResult, settings: Settings): Promise<void> {
  if (ran.deny !== undefined) return
  const input = e as unknown as Readonly<Record<string, unknown>>
  const isFailed = ran.isError === true
  const path = isFailed ? null : editedPath(e.tool, input)

  // Any loop's edit or shell command may move the working tree.
  if (path !== null || e.tool === 'Bash') {
    const now = await $.clock.now()
    if (now - gitCheckedAt >= GIT_MIN_GAP_MS) await refreshGit($, now)
  }
  if (e.agentId !== undefined) return

  if ((await read($, turnAtom)) !== null) {
    if (path !== null) turnFiles.add(path)
    const files = turnFiles.size
    await update($, turnAtom, t => (t === null ? t : {
      ...t,
      tools: t.tools + 1,
      edits: t.edits + (path !== null ? 1 : 0),
      files,
    }))
  }

  const { key, label } = callKey(e.tool, input)
  if (!isFailed) {
    failStreaks.delete(key)
  } else {
    const streak = (failStreaks.get(key) ?? 0) + 1
    failStreaks.set(key, streak)
    if (streak >= settings.stuckThreshold && !warnedKeys.has(key)) {
      warnedKeys.add(key)
      const text = `${label} failed ${streak}× in a row`
      await update($, warningAtom, () => text)
      $.ui.toast(`loopline: ${text}. Is the agent stuck?`, { timeoutMs: 8_000 })
    }
  }
  if (e.tool === 'Agent' || String(e.tool) === 'Task') await refreshAgents($)
}

async function finishTurn($: EngineInterface): Promise<void> {
  const turn = await read($, turnAtom)
  const usage = await $.session.usage()
  const tokens = usage.context.tokens
  const start = turn?.ctxAtStart
  await update($, ctxDeltaAtom, () => (start !== undefined && tokens !== undefined ? tokens - start : null))
  await update($, turnAtom, () => null)
  await update($, usageAtom, () => toUsage(usage.startedAt, usage.context, usage.rateLimits, usage.cost))
  const now = await $.clock.now()
  await update($, cacheAtom, () => now)
  await refreshCompactAt($)
  await refreshGit($, now)
  await refreshAgents($)
}

async function alertThresholds(
  $: EngineInterface,
  ctxPercent: number | undefined,
  limits: readonly SessionRateLimit[],
): Promise<void> {
  if (ctxPercent !== undefined) {
    const mark = crossed(ctxSeen ?? 0, ctxPercent, CONTEXT_MARKS)
    ctxSeen = ctxPercent
    if (mark !== null) $.ui.toast(`loopline: context is ${Math.round(ctxPercent)}% full. Consider /compact.`, { timeoutMs: 8_000 })
  }
  for (const limit of limits) {
    const mark = crossed(limitSeen.get(limit.kind) ?? 0, limit.percentUsed, LIMIT_MARKS)
    limitSeen.set(limit.kind, limit.percentUsed)
    if (mark === null) continue
    const reset = fmtReset(limit.resetsAt, await $.clock.now())
    const text = `${limitLabel(limit.kind)} limit at ${Math.round(limit.percentUsed)}%${reset === null ? '' : `, resets in ${reset}`}`
    $.ui.toast(`loopline: ${text}`, { timeoutMs: 8_000 })
  }
}
