// packages/lib/src/ai/kopilot/context-refs.ts

import { createScopedLogger } from '@auxx/logger'
import type { SessionContext, SessionRef, SessionRefKind } from './types'

const logger = createScopedLogger('kopilot-context-refs')

/**
 * Find the most-authoritative reference of a given kind in the session
 * context. Mention wins over surface; otherwise first ref of the kind.
 *
 * Same precedence is enforced by `applyContextDefaults` (engine pre-fill)
 * and taught by the agent prompt — three layers in agreement.
 */
export function findRef(ctx: SessionContext, kind: SessionRefKind): SessionRef | undefined {
  const refs = ctx.references ?? []
  return (
    refs.find((r) => r.kind === kind && r.origin === 'mention') ?? refs.find((r) => r.kind === kind)
  )
}

/** Every reference of a given kind, in registration order. */
export function findAllRefs(ctx: SessionContext, kind: SessionRefKind): SessionRef[] {
  return (ctx.references ?? []).filter((r) => r.kind === kind)
}

/**
 * Tool-argument → ref-kind binding table. Only arguments whose "the obvious
 * one from context" is unambiguous and almost always right belong here.
 *
 * `record` is deliberately omitted: pages often have several record-ish
 * things live at once (open contact drawer, `@`-mentioned deal, filter
 * results) and silently routing the wrong one is worse than asking.
 */
const ARG_TO_REF_KIND: Record<string, SessionRefKind> = {
  threadId: 'thread',
  articleId: 'article',
  knowledgeBaseId: 'kb',
  actorId: 'actor',
}

/**
 * Pre-fill tool-call arguments from the session refs before dispatch.
 *
 * When the model emits a tool call whose binding arg is absent / empty
 * (`threadId`, `articleId`, …), inject the matching ref id so the call
 * routes to the user's focused item even if the model ignored the prompt's
 * "Active references" block. Returns a new object — does not mutate input.
 */
export function applyContextDefaults<T extends Record<string, unknown>>(
  args: T,
  ctx: SessionContext
): T {
  const out: Record<string, unknown> = { ...args }
  for (const [arg, kind] of Object.entries(ARG_TO_REF_KIND)) {
    const existing = out[arg]
    if (existing != null && existing !== '') continue
    const hit = findRef(ctx, kind)
    if (!hit) continue
    out[arg] = hit.id
    logger.debug('Injected context default', { arg, kind, id: hit.id, origin: hit.origin })
  }
  return out as T
}
