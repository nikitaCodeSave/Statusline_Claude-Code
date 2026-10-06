// loopline's $.state contract: every value the band draws from.

export type LooplineLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type LooplineUsage = {
  startedAt: number
  ctxTokens?: number
  ctxWindow: number
  ctxPercent?: number
  usd?: number
  limits: LooplineLimit[]
}

export type LooplineIdentity = {
  model: string | null
  effort: string | null
  branch: string | null
  /** Changed and untracked files in the working tree. */
  dirty: number
  /** Lines added and removed against HEAD. */
  added: number
  removed: number
}

/** The main loop's turn while it runs. */
export type LooplineTurn = {
  id: string
  startedAt: number
  tools: number
  edits: number
  files: number
  ctxAtStart?: number
}

export type LooplineAgents = {
  active: number
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    loopline: {
      usage: LooplineUsage | null
      identity: LooplineIdentity
      turn: LooplineTurn | null
      agents: LooplineAgents
      warning: string | null
      /** Context tokens the last main-loop turn added (negative after a compaction). */
      ctxDelta: number | null
      /** When the main loop last got a model response: the prompt cache's clock. */
      cacheAt: number | null
      /** Compactions since the context began (a /clear starts it over). */
      compactions: number
      /** The context tokens at which auto-compaction runs; null when it is off. */
      compactAt: number | null
    }
  }
}
