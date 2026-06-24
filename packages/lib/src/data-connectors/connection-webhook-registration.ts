// packages/lib/src/data-connectors/connection-webhook-registration.ts
// Connection-scoped webhook registration (Direction 2). One provider subscription set
// per CONNECTION, reconciled from the UNION of every consumer's desired topics — the
// webhook data connectors on the connection ∪ the webhook-trigger workflows/agents.
// Two data connectors + a workflow trigger all on `orders/create` share ONE provider
// subscription, so the provider sends one delivery (fanned to all by the ingress).
//
// Per-topic diff (not full teardown): only the topics that changed are (un)subscribed;
// unchanged topics keep their existing provider subscription. We register ONE topic per
// `register()` call so the reconciler owns the topic↔externalId mapping — uniform across
// Shopify (one webhook per topic) and Stripe (one endpoint per topic; Stripe routes each
// event to the endpoints subscribed to it, so per-topic endpoints never double-deliver).

import { randomBytes } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  deleteConnectionWebhookHandler,
  getConnectionWebhookHandler,
  upsertConnectionWebhookHandler,
} from '@auxx/services/app-webhook-handlers'
import { and, eq } from 'drizzle-orm'
import { resolveConnectorCredential } from './connector-runtime'
import type { ConnectorWebhookState, WebhookCapability, WebhookSubscription } from './types'
import { resolveConnectionWebhookCapability } from './webhooks/registry'

const logger = createScopedLogger('connection-webhook-registration')

/** Parse the `{ secret, callbackUrl, subscriptions }` metadata off a handler row. */
function parseWebhookState(metadata: string | null): ConnectorWebhookState | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as Partial<ConnectorWebhookState>
    if (!parsed.secret) return null
    return {
      secret: parsed.secret,
      callbackUrl: parsed.callbackUrl ?? '',
      subscriptions: parsed.subscriptions ?? [],
    }
  } catch {
    return null
  }
}

/**
 * The distinct set of provider topics every consumer on this connection wants:
 *   • webhook data connectors → the provider's full topic set (`capability.topics`)
 *   • enabled webhook-trigger workflows → their `triggerTopic`
 *   • enabled webhook agent triggers   → their `triggerTopic`
 */
async function computeDesiredTopics(
  db: Database,
  organizationId: string,
  connectionId: string,
  connectorTopics: string[]
): Promise<Set<string>> {
  const topics = new Set<string>()

  // A webhook data connector subscribes the provider's full topic set (the sink
  // drops actions for streams it doesn't map — `applyWebhookActions`).
  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.credentialId, connectionId),
      eq(schema.DataConnector.syncBehavior, 'webhook')
    ),
    columns: { id: true },
  })
  if (connectors.length > 0) for (const t of connectorTopics) topics.add(t)

  const workflows = await db.query.Workflow.findMany({
    where: and(
      eq(schema.Workflow.organizationId, organizationId),
      eq(schema.Workflow.triggerType, 'webhook-trigger'),
      eq(schema.Workflow.triggerConnectionId, connectionId),
      eq(schema.Workflow.enabled, true)
    ),
    columns: { triggerTopic: true },
  })
  for (const w of workflows) if (w.triggerTopic) topics.add(w.triggerTopic)

  const agentTriggers = await db.query.AgentTrigger.findMany({
    where: and(
      eq(schema.AgentTrigger.organizationId, organizationId),
      eq(schema.AgentTrigger.kind, 'webhook'),
      eq(schema.AgentTrigger.triggerConnectionId, connectionId),
      eq(schema.AgentTrigger.enabled, true)
    ),
    columns: { triggerTopic: true },
  })
  for (const a of agentTriggers) if (a.triggerTopic) topics.add(a.triggerTopic)

  return topics
}

/** Tear down any prior subscriptions + delete the connection handler row. */
async function teardown(
  organizationId: string,
  connectionId: string,
  userId: string,
  capability: WebhookCapability | null,
  prior: ConnectorWebhookState | null,
  hadRow: boolean
): Promise<void> {
  if (capability && prior?.subscriptions.length) {
    const credential = await resolveConnectorCredential(organizationId, connectionId, userId)
    await capability.unregister({
      externalIds: prior.subscriptions.map((s) => s.externalId),
      credential,
      config: {},
    })
  }
  if (hadRow) await deleteConnectionWebhookHandler({ connectionId })
}

/**
 * Reconcile a connection's provider webhook subscriptions to the union of its
 * consumers' desired topics. Idempotent + best-effort: a provider that rejects a
 * topic is logged, not fatal. A no-op (after teardown) when the connection has no
 * webhook-capable provider or no consumers left. Call from every write path that
 * changes a consumer's desired topics (connector toggle/delete, trigger save/delete).
 */
export async function reconcileConnectionWebhooks(
  db: Database,
  organizationId: string,
  connectionId: string,
  userId = 'system'
): Promise<void> {
  if (!connectionId) return

  const credential = await db.query.Credential.findFirst({
    where: and(
      eq(schema.Credential.id, connectionId),
      eq(schema.Credential.organizationId, organizationId)
    ),
    columns: { id: true, type: true },
  })
  const capability = credential
    ? resolveConnectionWebhookCapability({ type: credential.type })
    : null

  const existing = await getConnectionWebhookHandler({ connectionId })
  const prior = existing.isOk() ? parseWebhookState(existing.value.metadata) : null

  const desired = capability
    ? await computeDesiredTopics(db, organizationId, connectionId, capability.topics)
    : new Set<string>()

  // No webhook-capable provider, or no consumers left → tear everything down.
  if (!capability || desired.size === 0) {
    await teardown(organizationId, connectionId, userId, capability, prior, existing.isOk())
    return
  }

  // Mint-or-reuse the secret + handler row first so the callback URL exists before we subscribe.
  const secret = prior?.secret ?? randomBytes(32).toString('hex')
  const seeded = await upsertConnectionWebhookHandler({
    connectionId,
    metadata: { secret, callbackUrl: '', subscriptions: prior?.subscriptions ?? [] },
  })
  if (seeded.isErr()) {
    logger.warn('failed to seed connection webhook handler', {
      connectionId,
      error: seeded.error,
    })
    return
  }
  const callbackUrl = seeded.value.url

  // Per-topic diff: only (un)subscribe what changed; leave unchanged topics alone.
  const currentSubs = prior?.subscriptions ?? []
  const currentTopics = new Set(currentSubs.map((s) => s.topic))
  const toAdd = [...desired].filter((t) => !currentTopics.has(t))
  const toRemoveSubs = currentSubs.filter((s) => !desired.has(s.topic))
  const keptSubs = currentSubs.filter((s) => desired.has(s.topic))

  const cred = await resolveConnectorCredential(organizationId, connectionId, userId)

  if (toRemoveSubs.length) {
    await capability.unregister({
      externalIds: toRemoveSubs.map((s) => s.externalId),
      credential: cred,
      config: {},
    })
  }

  // Register one topic at a time so the stored subscription is keyed to the topic
  // (the reconciler owns the topic label — drivers may tag it differently).
  const addedSubs: WebhookSubscription[] = []
  for (const topic of toAdd) {
    const subs = await capability.register({
      callbackUrl,
      secret,
      topics: [topic],
      credential: cred,
      config: {},
    })
    for (const sub of subs) addedSubs.push({ topic, externalId: sub.externalId })
  }

  const subscriptions = [...keptSubs, ...addedSubs]
  await upsertConnectionWebhookHandler({
    connectionId,
    metadata: { secret, callbackUrl, subscriptions } satisfies ConnectorWebhookState,
  })

  logger.info('reconciled connection webhooks', {
    connectionId,
    desired: desired.size,
    added: addedSubs.length,
    removed: toRemoveSubs.length,
  })
}
