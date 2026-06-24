// packages/lib/src/webhooks/inbound/spec.ts
// Declarative per-delivery webhook behavior (Direction 1). A WebhookSpec describes a
// provider's verify → event-id → topic→action mapping as DATA, extending the shipped
// WebhookVerifyPreset. `compileWebhookSpec` turns one (plus coded registration hooks)
// into the runtime WebhookCapability — the contract stays, the authoring becomes config.
//
// Registration (register/unregister) is NOT declarative: GraphQL/REST construction +
// provider auth is genuinely code, passed in as `hooks`. See webhookspec-build-plan.md.

import { getByPath } from '@auxx/utils'
import type {
  WebhookAction,
  WebhookCapability,
  WebhookRegisterInput,
  WebhookSubscription,
  WebhookUnregisterInput,
} from '../../data-connectors/types'
import type { WebhookVerifyPreset } from './types'
import { verifyWebhook } from './verify'

/** Where a scalar is read from on a verified delivery. */
export type WebhookSource =
  /** A (lowercased) request header. */
  | { from: 'header'; name: string }
  /** A dot-path into the parsed JSON body (`''` = the whole body). */
  | { from: 'body'; path: string }
  /** A segment of the resolved topic, split on `separator` (default `'/'`). */
  | { from: 'topicSegment'; index: number; separator?: string }

/** A source that reads from a header or the body (no topic context — used for ids/topics). */
type FieldSource = { from: 'header'; name: string } | { from: 'body'; path: string }

/**
 * A provider's per-delivery webhook behavior as data. The `verify` block is the
 * already-shipped {@link WebhookVerifyPreset}; the rest describes idempotency and the
 * topic → sink-action mapping that each driver used to hand-write.
 */
export interface WebhookSpec {
  /** Signature verification — the shipped preset, reused verbatim. */
  verify: WebhookVerifyPreset
  /** Treat a missing secret as verified (unsecured fixture endpoints in tests). */
  unsignedOk?: boolean
  /** Idempotency key for receiver dedupe. Missing at runtime ⇒ caller hashes the body. */
  eventId: FieldSource
  /** Topic → action mapping. */
  resolve: {
    /** The provider topic for this delivery (`orders/delete`, `customer.deleted`). */
    topic: FieldSource
    /** The stream this delivery belongs to (Shopify: a topic segment; Stripe: a body path). */
    streamKey: WebhookSource & { fallback?: WebhookSource; default?: string }
    /** The external record id. */
    externalId: { from: 'body'; path: string }
    /** The fields to sink on upsert (`''` = whole body; `data.object` = Stripe). */
    fields: { from: 'body'; path: string }
    /** Optional human label. */
    displayName?: { from: 'body'; path: string }
    /** Delete-detection: a glob the topic matches, or a truthy/equality body flag. */
    deleteWhen: { topicMatches: string } | { bodyFlag: { path: string; equals?: unknown } }
  }
}

/** The coded escape hatch — registration stays per-provider. */
export interface WebhookSpecHooks {
  topics: string[]
  register(input: WebhookRegisterInput): Promise<WebhookSubscription[]>
  unregister(input: WebhookUnregisterInput): Promise<void>
}

/**
 * Match a topic against a leading-`*` glob (`*​/delete` ⇒ ends with `/delete`,
 * `*.deleted` ⇒ ends with `.deleted`). A glob without `*` is an exact match.
 */
export function topicGlob(pattern: string, topic: string): boolean {
  if (pattern.startsWith('*')) return topic.endsWith(pattern.slice(1))
  return topic === pattern
}

/** Resolve a header/body field to its raw value. */
function readField(
  source: FieldSource,
  headers: Record<string, string>,
  payload: unknown
): unknown {
  return source.from === 'header' ? headers[source.name] : getByPath(payload, source.path)
}

/** Resolve any source (incl. topic segments) given the already-resolved topic. */
function readSource(
  source: WebhookSource,
  headers: Record<string, string>,
  payload: unknown,
  topic: string
): unknown {
  if (source.from === 'topicSegment') {
    return topic.split(source.separator ?? '/')[source.index]
  }
  return readField(source, headers, payload)
}

/** Normalize a resolved id to a non-empty string, or null. Faithful to the driver rule. */
function toExternalId(raw: unknown): string {
  if (raw == null) return ''
  return String(raw)
}

/**
 * Resolve the provider topic for a delivery from a spec's `resolve.topic` source.
 * The ONE source of truth for the topic — both {@link resolveWebhookActions} (sink)
 * and `compileWebhookSpec().resolveTopic` (trigger routing) read through this so the
 * two can never desync. Exported for direct unit testing.
 */
export function resolveWebhookTopic(
  resolve: WebhookSpec['resolve'],
  headers: Record<string, string>,
  payload: unknown
): string {
  const topicRaw = readField(resolve.topic, headers, payload)
  return topicRaw == null ? '' : String(topicRaw)
}

/**
 * Map one verified delivery onto sink actions from a spec's `resolve` block. Pure.
 * Bails (`[]`) when the stream key or external id is missing — the union of every
 * driver's guard. Exported for direct unit testing.
 */
export function resolveWebhookActions(
  resolve: WebhookSpec['resolve'],
  headers: Record<string, string>,
  payload: unknown
): WebhookAction[] {
  const topic = resolveWebhookTopic(resolve, headers, payload)

  // Stream key: primary source, then optional fallback, then optional literal default.
  let streamKeyRaw = readSource(resolve.streamKey, headers, payload, topic)
  if (streamKeyRaw == null && resolve.streamKey.fallback) {
    streamKeyRaw = readSource(resolve.streamKey.fallback, headers, payload, topic)
  }
  if (streamKeyRaw == null && resolve.streamKey.default != null) {
    streamKeyRaw = resolve.streamKey.default
  }
  const streamKey = streamKeyRaw == null ? '' : String(streamKeyRaw)

  const externalId = toExternalId(getByPath(payload, resolve.externalId.path))
  if (!streamKey || !externalId) return []

  const isDelete =
    'topicMatches' in resolve.deleteWhen
      ? topicGlob(resolve.deleteWhen.topicMatches, topic)
      : matchesBodyFlag(resolve.deleteWhen.bodyFlag, payload)

  if (isDelete) return [{ kind: 'delete', streamKey, externalId }]

  const fields = getByPath(payload, resolve.fields.path) ?? {}
  const record = resolve.displayName
    ? {
        streamKey,
        externalId,
        displayName: getByPath(payload, resolve.displayName.path) as string | undefined,
        fields,
      }
    : { streamKey, externalId, fields }
  return [{ kind: 'upsert', streamKey, record }]
}

/** A truthy (default) or strict-equality test on a body flag. */
function matchesBodyFlag(flag: { path: string; equals?: unknown }, payload: unknown): boolean {
  const value = getByPath(payload, flag.path)
  return flag.equals === undefined ? Boolean(value) : value === flag.equals
}

/** Compile a declarative spec + coded registration hooks into a runtime WebhookCapability. */
export function compileWebhookSpec(spec: WebhookSpec, hooks: WebhookSpecHooks): WebhookCapability {
  return {
    topics: hooks.topics,

    verify({ rawBody, headers, secret }) {
      if (spec.unsignedOk && !secret) return true
      return verifyWebhook(spec.verify, { rawBody, headers, secret })
    },

    eventId({ rawBody, headers }) {
      if (spec.eventId.from === 'header') return headers[spec.eventId.name] ?? null
      let payload: unknown
      try {
        payload = rawBody ? JSON.parse(rawBody) : null
      } catch {
        return null
      }
      const value = getByPath(payload, spec.eventId.path)
      return value == null ? null : (value as string)
    },

    resolveWebhook({ headers, payload }) {
      return resolveWebhookActions(spec.resolve, headers, payload)
    },

    resolveTopic({ headers, payload }) {
      return resolveWebhookTopic(spec.resolve, headers, payload)
    },

    register: hooks.register,
    unregister: hooks.unregister,
  }
}
