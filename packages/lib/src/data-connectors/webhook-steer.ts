// packages/lib/src/data-connectors/webhook-steer.ts
// Pure resolution of a webhook delivery → fetch-steering directive (sync bridge §4).
// Given a stream's `webhookTrigger` config + the delivery's `triggerData`, decide
// whether this event is a DELETE (skip the fetch, archive by externalId) or a
// FETCH (extract `{path}` values to steer the regular connector fetch at, then
// sink the FETCH result). Kept free of DB/connector deps so it unit-tests on plain
// payload fixtures. `resolveWebhookSteer` drives the steered partial run
// (runWebhookSteeredRun); `isSteerableDelivery` drives the dispatch-time decision
// of whether a delivery steers a partial run or falls through to a full sync.

import { unresolvedPlaceholders } from '@auxx/utils'
import type { StreamRequestConfig, StreamWebhookTrigger } from './connectors/types'

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
 * an externalId to archive; otherwise every declared payload path is read out of the
 * payload (envelope-relative dotted paths) into the `{path}` context the fetch
 * interpolates — the path IS the placeholder key (no rename, v7). Paths that return
 * nothing are omitted — the fetch's `assertResolved` then fails the event into the
 * dead-letter rather than firing a malformed request.
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
  for (const path of trigger.paths ?? []) {
    const value = getByPath(triggerData, path)
    if (value !== undefined && value !== null) triggerContext[path] = scalar(value)
  }
  return { kind: 'fetch', triggerContext }
}

/** Collect every string leaf of a value (depth-first) for placeholder scanning. */
function collectStringLeaves(value: unknown, acc: string[]): void {
  if (typeof value === 'string') acc.push(value)
  else if (Array.isArray(value)) for (const item of value) collectStringLeaves(item, acc)
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) collectStringLeaves(v, acc)
}

/**
 * Every `{token}` the steered request template references across path/params/headers/body.
 * These are exactly the placeholders the fetch's `assertResolved` would reject if a payload
 * path returned nothing — lifted here so the dispatcher can decide steerability BEFORE
 * opening a run, and the save path can validate the template against the declared paths.
 */
export function requiredSteerTokens(
  requestConfig: StreamRequestConfig | null | undefined
): string[] {
  if (!requestConfig) return []
  const leaves: string[] = []
  collectStringLeaves(requestConfig.path, leaves)
  collectStringLeaves(requestConfig.params, leaves)
  collectStringLeaves(requestConfig.headers, leaves)
  collectStringLeaves(requestConfig.body, leaves)
  return [...new Set(leaves.flatMap(unresolvedPlaceholders))]
}

/**
 * Can THIS delivery steer a targeted partial fetch on this stream? True iff the stream
 * declares steering (`{path}` paths, or a delete predicate) AND the delivery resolves
 * everything the request needs:
 *   • delete → the externalId path resolved (else there's nothing to archive);
 *   • fetch  → every `{token}` in the request template resolved from the payload.
 * A stream with no steering, or a delivery missing a required token, is NOT steerable — the
 * caller routes it to a full run-based sync instead of opening a doomed partial run (which
 * would otherwise fail `assertResolved` and dead-letter).
 */
export function isSteerableDelivery(
  requestConfig: StreamRequestConfig | null | undefined,
  triggerData: Record<string, unknown>
): boolean {
  const wt = requestConfig?.webhookTrigger
  if (!wt) return false
  const steer = resolveWebhookSteer(wt, triggerData)
  if (steer.kind === 'delete') return steer.externalId != null
  if ((wt.paths?.length ?? 0) === 0) return false
  const required = requiredSteerTokens(requestConfig)
  if (required.length > 0) return required.every((t) => t in steer.triggerContext)
  // Fixed-model (app) streams carry no {token} request template — the declared paths ARE
  // the contract, so all of them must resolve or the delivery falls back to a full sync.
  return (wt.paths ?? []).every((p) => p in steer.triggerContext)
}
