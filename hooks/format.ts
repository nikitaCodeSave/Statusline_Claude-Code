// Pure helpers: no `$` here, so tests reach them directly.

import type { SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type {
  LooplineAgents,
  LooplineIdentity,
  LooplineLimit,
  LooplineTurn,
  LooplineUsage,
} from '../types'

/** One styled run of text; `optional` runs are dropped first when a line is too wide. */
export type Seg = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  optional?: boolean
}

export type BandView = {
  usage: LooplineUsage | null
  identity: LooplineIdentity
  turn: LooplineTurn | null
  ctxDelta: number | null
  cacheAt: number | null
  compactions: number
  compactAt: number | null
  agents: LooplineAgents
  warning: string | null
  now: number
  width: number
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const ACTIVE_AGENT = new Set(['pending', 'running', 'waiting'])
const WINDOW_MS: Readonly<Record<string, number>> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
const HOUR = 3_600_000
const SEP: Seg = { text: '  │  ', dim: true }
const DOT: Seg = { text: ' · ', dim: true }

export function tone(pct: number): 'success' | 'warning' | 'error' {
  if (pct < 70) return 'success'
  return pct < 85 ? 'warning' : 'error'
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm'
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

/** +12k, −80k; null under a thousand either way. */
export function fmtDelta(n: number | null): string | null {
  if (n === null || Math.abs(n) < 1000) return null
  return (n > 0 ? '+' : '−') + fmtTokens(Math.abs(n))
}

/** <1m, 12m, 1h02m: a session's length at the grain the band redraws in. */
export function fmtDuration(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function fmtReset(iso: string | undefined, now: number): string | null {
  if (iso === undefined) return null
  const diff = Date.parse(iso) - now
  if (!Number.isFinite(diff)) return null
  return diff <= 0 ? 'now' : fmtSpan(diff)
}

function fmtSpan(ms: number): string {
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / HOUR)
  const m = Math.floor((ms % HOUR) / 60_000)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

export function fmtUsd(usd: number): string {
  return '$' + usd.toFixed(2)
}

export function bar(pct: number, cells = 10): string {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

/** claude-opus-5-5[1m] -> Opus5.5(1m); claude-haiku-4-5-20251001 -> Haiku4.5; display names pass through. */
export function shortModel(id: string | null): string {
  if (id === null || id === '') return 'Claude'
  if (!id.startsWith('claude-')) return id
  const isWide = /\[1m\]/.test(id)
  const parts = id.replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-').filter(Boolean)
  const [family = 'Claude', ...version] = parts
  return family.charAt(0).toUpperCase() + family.slice(1) + version.join('.') + (isWide ? '(1m)' : '')
}

/**
 * The effort the settings pin for this model: its `modelSettings` entry (keyed by the canonical
 * name, which also stands for the dated and `[1m]` spellings), else the top-level `effortLevel`.
 */
export function configuredEffort(settings: Readonly<Record<string, unknown>>, model: string): string | null {
  const perModel = asRecord(settings.modelSettings)
  const canonical = model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '')
  const level = asRecord(perModel?.[canonical] ?? perModel?.[model])?.effortLevel
  if (typeof level === 'string') return level
  return typeof settings.effortLevel === 'string' ? settings.effortLevel : null
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'spend'
  return kind
}

/**
 * How long until the window runs out at the pace it has been used so far, or null when
 * it lasts to its reset. Quiet early in a window and under 10% used, where one burst
 * would extrapolate wildly.
 */
export function exhaustIn(limit: LooplineLimit, now: number): number | null {
  const span = WINDOW_MS[limit.kind]
  if (span === undefined || limit.resetsAt === undefined) return null
  const resetAt = Date.parse(limit.resetsAt)
  const elapsed = span - (resetAt - now)
  if (!Number.isFinite(resetAt) || elapsed < span * 0.05 || limit.percentUsed < 10 || limit.percentUsed >= 100) return null
  const left = ((100 - limit.percentUsed) * elapsed) / limit.percentUsed
  return now + left < resetAt - 60_000 ? left : null
}

/** The prompt cache lives an hour on a subscription (which reports plan limits) and five minutes on the API. */
export function cacheTtlMs(limits: readonly LooplineLimit[]): number {
  return limits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day') ? HOUR : 5 * 60_000
}

export function isActiveAgent(status: string): boolean {
  return ACTIVE_AGENT.has(status)
}

/** The highest mark the value climbed past since the previous reading, or null. */
export function crossed(prev: number, next: number, marks: readonly number[]): number | null {
  let hit: number | null = null
  for (const mark of marks) if (prev < mark && next >= mark) hit = mark
  return hit
}

/** `git diff --shortstat` -> lines added and removed. */
export function parseShortstat(text: string): { added: number; removed: number } {
  const added = /(\d+) insertions?\(\+\)/.exec(text)?.[1]
  const removed = /(\d+) deletions?\(-\)/.exec(text)?.[1]
  return { added: Number(added ?? 0), removed: Number(removed ?? 0) }
}

export function toUsage(
  startedAt: number,
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
): LooplineUsage {
  const usage: LooplineUsage = {
    startedAt,
    ctxWindow: context.window,
    limits: rateLimits.map(l => (l.resetsAt === undefined
      ? { kind: l.kind, percentUsed: l.percentUsed }
      : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
  if (context.tokens !== undefined) usage.ctxTokens = context.tokens
  if (context.percent !== undefined) usage.ctxPercent = context.percent
  if (cost !== undefined) usage.usd = cost.usd
  return usage
}

/** The file a successful edit touched, or null for any other tool. */
export function editedPath(tool: string, input: Readonly<Record<string, unknown>>): string | null {
  if (!EDIT_TOOLS.has(tool)) return null
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : null
}

/** Identity of a call for the stuck detector, and a short label to show for it. */
export function callKey(tool: string, input: Readonly<Record<string, unknown>>): { key: string; label: string } {
  if (typeof input.command === 'string') {
    const command = input.command.trim().replace(/\s+/g, ' ')
    return { key: `${tool} ${command}`, label: clip(command, 48) }
  }
  const target = input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.pattern
  if (typeof target === 'string') return { key: `${tool} ${target}`, label: clip(`${tool} ${target}`, 48) }
  const { tool_use_id: _id, agentId: _agent, tool: _tool, ...rest } = input
  return { key: `${tool} ${clip(JSON.stringify(rest), 400)}`, label: tool }
}

export function clip(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…'
}

function width(segs: readonly Seg[]): number {
  return segs.reduce((sum, s) => sum + [...s.text].length, 0)
}

/** Drops optional runs from the end until the line fits; the surface truncates whatever is still too wide. */
export function fit(segs: readonly Seg[], columns: number): Seg[] {
  const out = [...segs]
  for (let i = out.length - 1; i >= 0 && width(out) > columns; i--) {
    if (out[i]?.optional === true) out.splice(i, 1)
  }
  return out
}

/** Joins the non-empty groups; a wholly optional group takes its separator with it when dropped. */
function joinGroups(groups: readonly (readonly Seg[])[], sep: Seg): Seg[] {
  const out: Seg[] = []
  for (const group of groups) {
    if (group.length === 0) continue
    if (out.length > 0) out.push(group.every(s => s.optional === true) ? { ...sep, optional: true } : sep)
    out.push(...group)
  }
  return out
}

function identityLine(v: BandView): Seg[] {
  const { identity, usage } = v
  const who: Seg[][] = []
  if (identity.branch !== null) {
    const diff: Seg[] = []
    if (identity.dirty > 0) {
      if (identity.added > 0) diff.push({ text: ` +${identity.added}`, color: 'success' })
      if (identity.removed > 0) diff.push({ text: ` −${identity.removed}`, color: 'error' })
      diff.push({ text: ` (${identity.dirty})`, dim: true })
    }
    who.push([{ text: identity.branch, color: 'merged' }, ...diff])
  }
  who.push([
    { text: shortModel(identity.model), color: 'suggestion', bold: true },
    ...(identity.effort !== null ? [{ text: ` ${identity.effort}`, dim: true }] : []),
  ])

  const ctx: Seg[] = [{ text: 'ctx ', dim: true }]
  if (usage === null) {
    ctx.push({ text: '—', dim: true })
  } else {
    const pct = usage.ctxPercent ?? 0
    const color = tone(pct)
    const delta = fmtDelta(v.ctxDelta)
    ctx.push(
      { text: bar(pct) + ' ', color, optional: true },
      { text: `${usage.ctxTokens === undefined ? '—' : fmtTokens(usage.ctxTokens)}/${fmtTokens(usage.ctxWindow)} `, color, optional: true },
      { text: `${usage.ctxPercent === undefined ? '—' : Math.round(pct)}%`, color, bold: true },
      ...(delta !== null ? [{ text: ` ${delta}`, dim: true, optional: true }] : []),
    )
  }
  const left = compactLeft(usage, v.compactAt)
  if (left !== null) {
    ctx.push({ text: left > 0 ? ` · compact in ${fmtTokens(left)}` : ' · compact due', color: 'warning' })
  }
  // What a compaction dropped is gone for good: the cue to start afresh with /clear and a plan.
  if (v.compactions > 0) {
    ctx.push({ text: ` · compacted ×${v.compactions}`, color: 'warning' })
  }
  return [...joinGroups(who, DOT), SEP, ...ctx]
}

/** Tokens left before auto-compaction runs, once fewer than a fifth of them are; null otherwise. */
export function compactLeft(usage: LooplineUsage | null, compactAt: number | null): number | null {
  if (usage === null || usage.ctxTokens === undefined || compactAt === null) return null
  const left = compactAt - usage.ctxTokens
  return left <= compactAt * 0.2 ? left : null
}

/** The spinner's suffix while the main loop works: what it has done so far this turn. */
export function spinnerSuffix(turn: LooplineTurn | null): string | null {
  if (turn === null || turn.tools === 0) return null
  const edits = turn.edits > 0 ? ` · ${plural(turn.edits, 'edit')}/${plural(turn.files, 'file')}` : ''
  return ` · ${plural(turn.tools, 'tool')}${edits}`
}

function limitSegs(limit: LooplineLimit, now: number): Seg[] {
  const segs: Seg[] = [
    { text: `${limitLabel(limit.kind)} ` },
    { text: `${Math.round(limit.percentUsed)}%`, color: tone(limit.percentUsed) },
  ]
  const out = exhaustIn(limit, now)
  if (out !== null) {
    segs.push({ text: ` ⇡ out ~${fmtSpan(out)}`, color: out < 30 * 60_000 ? 'error' : 'warning' })
  } else {
    const reset = fmtReset(limit.resetsAt, now)
    if (reset !== null) segs.push({ text: ` @${reset}`, dim: true, optional: true })
  }
  return segs
}

function cacheSegs(v: BandView): Seg[] {
  if (v.cacheAt === null || v.turn !== null || v.usage === null) return []
  const ttl = cacheTtlMs(v.usage.limits)
  const left = v.cacheAt + ttl - v.now
  if (left <= 0) return [{ text: 'cache cold', color: 'warning' }]
  const text = `cache ${Math.ceil(left / 60_000)}m`
  return [left < ttl * 0.2 ? { text, color: 'warning' } : { text, dim: true }]
}

function spendLine(v: BandView): Seg[] {
  const { usage, now } = v
  if (usage === null) return []
  const usd = usage.usd ?? 0
  return joinGroups([
    [{ text: fmtUsd(usd), ...(usd > 0 ? { color: 'warning' } : { dim: true }) }],
    joinGroups(usage.limits.map(l => limitSegs(l, now)), DOT),
    cacheSegs(v),
    [{ text: `⏱ ${fmtDuration(now - usage.startedAt)}`, optional: true }],
  ], SEP)
}

function loopLine(v: BandView): Seg[] {
  const groups: Seg[][] = []
  if (v.agents.active > 0) groups.push([{ text: `⧉ ${plural(v.agents.active, 'agent')}`, color: 'suggestion' }])
  if (v.warning !== null) groups.push([{ text: `⚠ ${v.warning}`, color: 'warning' }])
  return joinGroups(groups, SEP)
}

/** The band's lines, each fitted to the band's width; an empty line is left out. */
export function bandLines(v: BandView): Seg[][] {
  return [identityLine(v), spendLine(v), loopLine(v)]
    .filter(line => line.length > 0)
    .map(line => fit(line, v.width))
}
