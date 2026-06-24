// packages/lib/src/data-connectors/webhook-steer.ts
// Pure resolution of a webhook delivery → fetch-steering directive (sync bridge §4).
// Given a stream's `webhookTrigger` config + the delivery's `triggerData`, decide
// whether this event is a DELETE (skip the fetch, archive by externalId) or a
// FETCH (extract `{token}` values to steer the regular connector fetch at, then
// sink the FETCH result). Kept free of DB/connector deps so it unit-tests on plain
// payload fixtures — the side-effecting slice (`runWebhookEventSlice`) consumes it.

import type { StreamWebhookTrigger } from './connectors/types'

/** A resolved steering directive for one webhook delivery. */
export type WebhookSteer =
  | { kind: 'fetch'; triggerContext: Record<string, string> }
  | { kind: 'delete'; externalId: string | null }

/** Walk a dotted JSON path (`a.b.c`) into a value; '' / undefined → the root. */
function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return obj
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * Scalarize a payload value for a `{token}` substitution. Arrays comma-join (so a
 * batch delivery can steer an `ids=1,2,3` style param); everything else stringifies.
 */
function scalar(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(',') : String(value)
}

/** Is this delivery a delete, per the stream's `deleteWhen` predicate? */
function isDeleteEvent(
  deleteWhen: StreamWebhookTrigger['deleteWhen'],
  triggerData: Record<string, unknown>
): boolean {
  if (!deleteWhen) return false
  if ('topicEquals' in deleteWhen && deleteWhen.topicEquals !== undefined) {
    return getByPath(triggerData, 'topic') === deleteWhen.topicEquals
  }
  if ('tokenTruthy' in deleteWhen && deleteWhen.tokenTruthy !== undefined) {
    return Boolean(getByPath(triggerData, deleteWhen.tokenTruthy))
  }
  return false
}

/**
 * Resolve a webhook delivery into a steering directive. A delete short-circuits to
 * an externalId to archive; otherwise every declared token is read out of the
 * payload (envelope-relative dotted paths) into the `{token}` context the fetch
 * interpolates. Tokens whose path returns nothing are omitted — the fetch's
 * `assertResolved` then fails the event into the dead-letter rather than firing a
 * malformed request.
 */
export function resolveWebhookSteer(
  trigger: StreamWebhookTrigger,
  triggerData: Record<string, unknown>
): WebhookSteer {
  if (isDeleteEvent(trigger.deleteWhen, triggerData)) {
    const externalId = trigger.deleteExternalIdPath
      ? scalar(getByPath(triggerData, trigger.deleteExternalIdPath))
      : null
    return { kind: 'delete', externalId }
  }
  const triggerContext: Record<string, string> = {}
  for (const [token, path] of Object.entries(trigger.tokens ?? {})) {
    const value = getByPath(triggerData, path)
    if (value !== undefined && value !== null) triggerContext[token] = scalar(value)
  }
  return { kind: 'fetch', triggerContext }
}
