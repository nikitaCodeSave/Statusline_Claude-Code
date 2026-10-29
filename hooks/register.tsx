import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, ToolCallInput, ToolCallResult } from 'claude-code'

import {
  bandLines,
  callKey,
  configuredEffort,
  crossed,
  editedPath,
  fmtReset,
  isActiveAgent,
  limitLabel,
  parseShortstat,
  pinnedCacheTtl,
  projectKey,
  spinnerSuffix,
  toUsage,
} from './format'
import type { Seg } from './format'

const CONTEXT_MARKS = [70, 85]
const LIMIT_MARKS = [80, 95]
const POLL_MS = 5_000
const GIT_STALE_MS = 15_000
const GIT_MIN_GAP_MS = 3_000
// The transcript's row for each compaction of the main conversation; a subagent's go to its own file.
const COMPACT_ROW = '"subtype":"compact_boundary"'

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
const cacheTtlAtom = atom({ plugin: 'loopline', key: 'cacheTtl' } as const, null)
const compactionsAtom = atom({ plugin: 'loopline', key: 'compactions' } as const, 0)
const compactAtAtom = atom({ plugin: 'loopline', key: 'compactAt' } as const, null)

// Bookkeeping a reload starts over, which costs at most a repeated alert. Drawing reads only
// `subagents`, which the next poll or request fills again.
let turnFiles = new Set<string>()
const failStreaks = new Map<string, number>()
const warnedKeys = new Set<string>()
const limitSeen = new Map<string, number>()
let ctxSeen: number | undefined
let gitCheckedAt = 0
let modelSeen = ''
let sessionSeen = ''
let transcript: Transcript | null = null
const subagents = new Set<string>()

type Settings = { stuckThreshold: number }
type Transcript = { id: string; root: string; path: string | null; size: number; isScanned: boolean }

export const register: Register = (on, options) => {
  const settings: Settings = {
    stuckThreshold: Math.max(2, Number(options.stuckThreshold ?? 3)),
  }

  on('session.start', async ($, e, next) => {
    sessionSeen = await $.session.id()
    await refreshAll($)
    $.clock.every(POLL_MS, () => void poll($))
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
  // a response that reports cache tokens restarts the prompt cache's clock, and one without
  // (caching off, or cut by a gateway) stops it.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      subagents.add(e.agentId)
      return yield* next(e)
    }
    const effort = e.effort === undefined ? null : String(e.effort)
    const seen = `${e.model}|${effort}`
    if (seen !== modelSeen) {
      modelSeen = seen
      await update($, identityAtom, id => ({ ...id, model: e.model, effort }))
    }
    const result = yield* next(e)
    if (result.usage !== null) {
      const isCached = result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens > 0
      const now = await $.clock.now()
      await update($, cacheAtom, () => (isCached ? now : null))
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
      cacheTtl: await read($, cacheTtlAtom),
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
    if (suffix === null || subagents.has(e.requestId)) return next(e)
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
  transcript = null
  subagents.clear()
}

async function refreshAll($: EngineInterface): Promise<void> {
  await refreshUsage($)
  const model = await $.session.model()
  const configured = await $.settings.read()
  const effort = configuredEffort(configured, model)
  await update($, identityAtom, id => ({ ...id, model: id.model ?? model, effort: id.effort ?? effort }))
  const env = {
    force5m: await $.env.get('FORCE_PROMPT_CACHING_5M'),
    ttl: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
    enable1h: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
  }
  const ttl = pinnedCacheTtl(env, configured.promptCacheTtl)
  await update($, cacheTtlAtom, () => ttl)
  await refreshCompactAt($)
  await refreshCompactions($)
  await refreshGit($, await $.clock.now())
  await refreshAgents($)
}

/**
 * The status line's figures, read afresh (the call is free). session.measure brings them only after a
 * turn, so this keeps the band right after a /compact between turns and live through a long turn.
 */
async function refreshUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  await update($, usageAtom, () => toUsage(usage.startedAt, usage.context, usage.rateLimits, usage.cost))
  await alertThresholds($, usage.context.percent, usage.rateLimits)
}

/** Where auto-compaction runs: from the local /context estimate, which sends no request. */
async function refreshCompactAt($: EngineInterface): Promise<void> {
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const at = breakdown?.isAutoCompactEnabled === true ? breakdown.autoCompactThreshold ?? null : null
  await update($, compactAtAtom, () => at)
}

/**
 * Compactions of the main conversation, counted in the session's transcript: one boundary row each,
 * none for a vetoed one, a precompute or a subagent's. No event tells it: where managed settings exist
 * or the login is a Team or Enterprise one, the built-in guard passes session.compact, and the rows it
 * appends, over every mod a person installs. The rows' format is internal to Claude Code and may change
 * in any release, and then the count stays at zero and the band shows none.
 */
async function refreshCompactions($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  // /cd moves the transcript to the new directory's folder.
  const root = await $.session.root()
  if (transcript?.id !== id || transcript.root !== root) transcript = { id, root, path: null, size: -1, isScanned: false }
  const t = transcript
  t.path ??= await findTranscript($, t)
  if (t.path === null) return
  const stat = await $.fs.stat(t.path).catch(() => null)
  if (stat === null) {
    t.path = null
    return
  }
  if (stat.size === t.size) return
  t.size = stat.size
  const grep = await $.process.run(['grep', '-c', '-F', COMPACT_ROW, '--', t.path], { timeoutMs: 5_000 }).catch(() => null)
  // grep exits 1 when nothing matches, and still prints the 0.
  const count = grep !== null && grep.exitCode <= 1 ? Number.parseInt(grep.stdout, 10) : NaN
  const prev = await read($, compactionsAtom)
  if (!Number.isInteger(count) || count === prev) return
  await update($, compactionsAtom, () => count)
  // The last turn's growth no longer describes a context a compaction rewrote.
  if (count > prev) await update($, ctxDeltaAtom, () => null)
}

/**
 * The session's transcript, `projects/<folder>/<id>.jsonl` under the config folder, where the folder is
 * the one CLAUDE_CODE_PROJECT_DIR_NAME pins or else the session directory's key. One resumed from
 * another directory, or under a path too long for a plain key, is searched for once the session has a
 * prompt, so a transcript not yet written costs no search.
 */
async function findTranscript($: EngineInterface, t: Transcript): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const config = configDir ?? (home === undefined ? undefined : `${home}/.claude`)
  if (config === undefined) return null
  const projects = `${config}/projects`
  const file = `${t.id}.jsonl`
  // A pinned folder name counts only beside CLAUDE_CONFIG_DIR.
  const pinned = configDir === undefined ? undefined : await $.env.get('CLAUDE_CODE_PROJECT_DIR_NAME')
  for (const folder of [pinned, projectKey(t.root)]) {
    const path = `${projects}/${folder}/${file}`
    if (folder !== undefined && (await $.fs.exists(path))) return path
  }
  if (t.isScanned || (await $.session.turns()) === 0) return null
  t.isScanned = true
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${file}`
    if (entry.kind === 'dir' && (await $.fs.exists(path))) return path
  }
  return null
}

async function poll($: EngineInterface): Promise<void> {
  // /clear, /resume and /branch put another session in place with no session.start, and $.state
  // starts over. No hook says so: session.end skips /branch, and where managed settings exist the
  // built-in guard passes classic SessionStart over every installed mod.
  const id = await $.session.id()
  if (id !== sessionSeen) {
    sessionSeen = id
    resetBookkeeping()
    await refreshAll($)
  }
  await refreshAgents($)
  await refreshCompactions($)
  await refreshUsage($)
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
  for (const agent of list) subagents.add(agent.id)
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
  if (e.tool === 'Agent') await refreshAgents($)
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
