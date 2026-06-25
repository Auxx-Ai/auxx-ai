// packages/lib/src/webhooks/webhook-endpoint/service.ts
// Functional CRUD over the WebhookEndpoint control table (inbound, provider-agnostic
// webhook URLs). Drizzle + thrown AuxxErrors, no model classes (project convention).
// The tRPC router (apps/web `webhook-endpoint.ts`) consumes these. Secrets are minted +
// AES-256-GCM encrypted here and only ever returned in plaintext ONCE (create/rotate);
// every read masks the secret to a `hasSecret` boolean.

import { randomBytes } from 'node:crypto'
import { getApiUrl } from '@auxx/config/urls'
import { decryptValue, encryptValue } from '@auxx/credentials'
import { type Database, schema } from '@auxx/database'
import type { WebhookEndpointEntity, WebhookEndpointTopic } from '@auxx/database/types'
import { and, desc, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../../errors'

export type WebhookEndpointVerification = 'none' | 'token' | 'hmac'
export type WebhookEndpointTopicSource = { kind: 'header' | 'path'; value: string }
export type { WebhookEndpointTopic }

/** A WebhookEndpoint projected for the UI — the secret never leaves the server; `hasSecret` marks it set. */
export interface WebhookEndpointSummary {
  id: string
  name: string
  /** Derived public inbound URL — never stored. */
  url: string
  verification: WebhookEndpointVerification
  hasSecret: boolean
  signatureHeader: string | null
  signaturePrefix: string | null
  signatureEncoding: 'hex' | 'base64'
  topicSource: WebhookEndpointTopicSource | null
  /** Declared topics (with optional per-topic payload schema). Empty ⇒ free-form. */
  topics: WebhookEndpointTopic[]
  lastEventAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** The public inbound URL for an endpoint — derived from its id, never persisted. */
export function webhookEndpointUrl(id: string): string {
  return getApiUrl(`/webhooks/endpoint/${id}`)
}

/** Mint a fresh secret: a base64url token plus its encrypted-at-rest form. */
function mintSecret(): { plaintext: string; encrypted: string } {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, encrypted: encryptValue(plaintext) }
}

function toSummary(row: WebhookEndpointEntity): WebhookEndpointSummary {
  return {
    id: row.id,
    name: row.name,
    url: webhookEndpointUrl(row.id),
    verification: row.verification,
    hasSecret: !!row.secret,
    signatureHeader: row.signatureHeader,
    signaturePrefix: row.signaturePrefix,
    signatureEncoding: row.signatureEncoding,
    topicSource: row.topicSource ?? null,
    topics: row.topics ?? [],
    lastEventAt: row.lastEventAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Validate a declared-topics array: topics are only meaningful when the endpoint
 * extracts a topic (`topicSource` set), each entry needs a non-empty `key`, and
 * keys must be unique. Returns the cleaned array (trimmed keys).
 */
function normalizeTopics(
  topics: WebhookEndpointTopic[] | undefined,
  topicSource: WebhookEndpointTopicSource | null
): WebhookEndpointTopic[] | undefined {
  if (topics === undefined) return undefined
  if (topics.length === 0) return []
  if (!topicSource) {
    throw new BadRequestError('Configure a topic source before defining topics.')
  }
  const seen = new Set<string>()
  return topics.map((t) => {
    const key = t.key.trim()
    if (!key) throw new BadRequestError('Each topic needs a key.')
    if (seen.has(key)) throw new BadRequestError(`Duplicate topic "${key}".`)
    seen.add(key)
    return { ...t, key, name: t.name?.trim() || undefined }
  })
}

async function loadEndpoint(
  db: Database,
  organizationId: string,
  id: string
): Promise<WebhookEndpointEntity> {
  const row = await db.query.WebhookEndpoint.findFirst({
    where: and(
      eq(schema.WebhookEndpoint.id, id),
      eq(schema.WebhookEndpoint.organizationId, organizationId)
    ),
  })
  if (!row) throw new NotFoundError('Webhook endpoint not found')
  return row
}

/** Org endpoints, newest first, secret masked. */
export async function listWebhookEndpoints(
  db: Database,
  organizationId: string
): Promise<WebhookEndpointSummary[]> {
  const rows = await db.query.WebhookEndpoint.findMany({
    where: eq(schema.WebhookEndpoint.organizationId, organizationId),
    orderBy: desc(schema.WebhookEndpoint.createdAt),
  })
  return rows.map(toSummary)
}

/** A single endpoint, secret masked. */
export async function getWebhookEndpoint(
  db: Database,
  organizationId: string,
  id: string
): Promise<WebhookEndpointSummary> {
  return toSummary(await loadEndpoint(db, organizationId, id))
}

export interface CreateWebhookEndpointParams {
  name: string
  verification: WebhookEndpointVerification
  signatureHeader?: string | null
  signaturePrefix?: string | null
  signatureEncoding?: 'hex' | 'base64'
  topicSource?: WebhookEndpointTopicSource | null
  topics?: WebhookEndpointTopic[]
  createdById?: string | null
}

/**
 * Create an endpoint, minting a secret for `token`/`hmac` verification (`none` ⇒ no secret,
 * an open URL). Returns the row + the one-time **plaintext** secret (null for `none`).
 */
export async function createWebhookEndpoint(
  db: Database,
  organizationId: string,
  input: CreateWebhookEndpointParams
): Promise<{ endpoint: WebhookEndpointSummary; secret: string | null }> {
  const name = input.name.trim()
  if (!name) throw new BadRequestError('Name is required')

  const minted = input.verification === 'none' ? null : mintSecret()
  const isHmac = input.verification === 'hmac'
  const topicSource = input.topicSource ?? null
  const topics = normalizeTopics(input.topics, topicSource) ?? []

  const [row] = await db
    .insert(schema.WebhookEndpoint)
    .values({
      organizationId,
      name,
      verification: input.verification,
      secret: minted?.encrypted ?? null,
      signatureHeader: isHmac ? (input.signatureHeader ?? null) : null,
      signaturePrefix: isHmac ? (input.signaturePrefix ?? null) : null,
      signatureEncoding: input.signatureEncoding ?? 'hex',
      topicSource,
      topics,
      createdById: input.createdById ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to create webhook endpoint')

  return { endpoint: toSummary(row), secret: minted?.plaintext ?? null }
}

export interface UpdateWebhookEndpointParams {
  name?: string
  verification?: WebhookEndpointVerification
  signatureHeader?: string | null
  signaturePrefix?: string | null
  signatureEncoding?: 'hex' | 'base64'
  topicSource?: WebhookEndpointTopicSource | null
  topics?: WebhookEndpointTopic[]
}

/**
 * Patch an endpoint's config. Enforces the verification↔secret invariant: switching to
 * `token`/`hmac` on an endpoint with no stored secret is rejected (rotate first); switching
 * to `none` clears the secret. hmac-only fields are cleared when verification leaves `hmac`.
 */
export async function updateWebhookEndpoint(
  db: Database,
  organizationId: string,
  id: string,
  patch: UpdateWebhookEndpointParams
): Promise<WebhookEndpointSummary> {
  const current = await loadEndpoint(db, organizationId, id)
  const nextVerification = patch.verification ?? current.verification

  if (nextVerification !== 'none' && !current.secret) {
    throw new BadRequestError(
      'This verification mode needs a secret. Rotate the secret before switching to it.'
    )
  }

  const set: Partial<WebhookEndpointEntity> = { updatedAt: new Date() }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new BadRequestError('Name is required')
    set.name = name
  }
  if (patch.verification !== undefined) {
    set.verification = nextVerification
    if (nextVerification === 'none') set.secret = null // 'none' forbids a secret
  }
  if (nextVerification === 'hmac') {
    if (patch.signatureHeader !== undefined) set.signatureHeader = patch.signatureHeader
    if (patch.signaturePrefix !== undefined) set.signaturePrefix = patch.signaturePrefix
    if (patch.signatureEncoding !== undefined) set.signatureEncoding = patch.signatureEncoding
  } else if (patch.verification !== undefined) {
    set.signatureHeader = null
    set.signaturePrefix = null
  }
  if (patch.topicSource !== undefined) set.topicSource = patch.topicSource
  if (patch.topics !== undefined) {
    // Resolve the effective topic source: the incoming patch wins, else the stored one.
    const nextTopicSource =
      patch.topicSource !== undefined ? patch.topicSource : (current.topicSource ?? null)
    set.topics = normalizeTopics(patch.topics, nextTopicSource) ?? []
  }

  const [row] = await db
    .update(schema.WebhookEndpoint)
    .set(set)
    .where(
      and(
        eq(schema.WebhookEndpoint.id, id),
        eq(schema.WebhookEndpoint.organizationId, organizationId)
      )
    )
    .returning()
  if (!row) throw new NotFoundError('Webhook endpoint not found')
  return toSummary(row)
}

/** Mint a fresh secret, returning its one-time plaintext. Rejected for `none` (open) endpoints. */
export async function rotateWebhookEndpointSecret(
  db: Database,
  organizationId: string,
  id: string
): Promise<{ secret: string }> {
  const current = await loadEndpoint(db, organizationId, id)
  if (current.verification === 'none') {
    throw new BadRequestError('Open endpoints (no verification) have no secret to rotate.')
  }
  const minted = mintSecret()
  await db
    .update(schema.WebhookEndpoint)
    .set({ secret: minted.encrypted, updatedAt: new Date() })
    .where(
      and(
        eq(schema.WebhookEndpoint.id, id),
        eq(schema.WebhookEndpoint.organizationId, organizationId)
      )
    )
  return { secret: minted.plaintext }
}

export async function deleteWebhookEndpoint(
  db: Database,
  organizationId: string,
  id: string
): Promise<void> {
  const deleted = await db
    .delete(schema.WebhookEndpoint)
    .where(
      and(
        eq(schema.WebhookEndpoint.id, id),
        eq(schema.WebhookEndpoint.organizationId, organizationId)
      )
    )
    .returning({ id: schema.WebhookEndpoint.id })
  if (deleted.length === 0) throw new NotFoundError('Webhook endpoint not found')
}

/**
 * Decrypt an endpoint's stored secret for server-side verification (the ingress reads the
 * row directly; this is for callers that already hold a row, e.g. a future test-delivery path).
 */
export function revealWebhookEndpointSecret(row: WebhookEndpointEntity): string | null {
  return decryptValue(row.secret)
}
