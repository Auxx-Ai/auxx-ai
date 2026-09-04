// apps/web/src/app/api/connections/[connectionDefinitionId]/hosted-provision/return/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { getCredential, listCredentials, updateCredential } from '@auxx/credentials/store'
import { database as db } from '@auxx/database'
import type { HostedProvisionCompleteResult } from '@auxx/lib/connections'
import { resolveHostedProvisionHandler, saveConnection } from '@auxx/lib/connections'
import { getProviderByKey } from '@auxx/lib/connections/providers'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('connection-hosted-provision-return')

interface HostedProvisionState {
  organizationId: string
  userId: string
  connectionDefinitionId: string
  providerKey: string
  returnTo: string | null
  connectionId?: string
}

/** Build a redirect URL safely using URL/URLSearchParams. */
function buildRedirectUrl(basePath: string, params: Record<string, string>): string {
  const url = new URL(basePath, WEBAPP_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Validate a landing/return path - must be a relative path, not protocol-relative. */
function isValidPath(value: string | null | undefined): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Best-effort resolution of the consumer's landing path from the URL's `:connectionDefinitionId`
 * segment alone (id or providerKey) - used to build a sane error redirect even when the Redis
 * state is missing/expired and `HostedProvisionState` was never recovered.
 */
async function resolveLandingPathByParam(defParam: string): Promise<string | null> {
  try {
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq, or }) => or(eq(cd.id, defParam), eq(cd.providerKey, defParam)),
    })
    if (!connDef?.providerKey) return null
    const provider = getProviderByKey(connDef.providerKey)
    if (!provider?.hostedProvisionKey) return null
    const handler = await resolveHostedProvisionHandler(provider.hostedProvisionKey)
    return isValidPath(handler.landingPath) ? handler.landingPath : null
  } catch {
    return null
  }
}

/** Read + delete the one-shot Redis state minted by the start route. */
async function consumeState(state: string): Promise<HostedProvisionState> {
  const redis = await getRedisClient()
  if (!redis) {
    throw new Error('Redis client unavailable')
  }
  const raw = await redis.get(`hosted-provision:${state}`)
  if (!raw) {
    throw new Error('Invalid or expired state token')
  }
  await redis.del(`hosted-provision:${state}`)
  return JSON.parse(raw) as HostedProvisionState
}

interface FinalizeResult {
  landingPath: string
  credentialIds: string[]
}

/**
 * The whole of "the flow came back": run `handler.complete`, persist one Credential per
 * returned provider account, and run `onPersisted` for each.
 *
 * Shared by both legs deliberately. A redirect flow re-enters through GET and an embed
 * flow through POST, but everything past `complete()` - the dedupe, the write, the
 * `providerAccountId`/`ready` refresh, the consumer hook - is identical, and the one
 * defect this seam has already produced (a reconnect that saved variables but left
 * `providerAccountId` stale) is exactly the kind that appears when two copies drift.
 */
async function finalizeHostedProvision(
  stateData: HostedProvisionState,
  payload?: Record<string, unknown>
): Promise<FinalizeResult> {
  const connDef = await db.query.ConnectionDefinition.findFirst({
    where: (cd, { eq }) => eq(cd.id, stateData.connectionDefinitionId),
  })
  if (!connDef?.providerKey) {
    throw new Error('Connection definition not found')
  }

  const provider = getProviderByKey(connDef.providerKey)
  if (!provider?.hostedProvisionKey) {
    throw new Error(`No hosted-provision handler configured for "${connDef.providerKey}"`)
  }
  const handler = await resolveHostedProvisionHandler(provider.hostedProvisionKey)

  const completed = await handler.complete({
    organizationId: stateData.organizationId,
    userId: stateData.userId,
    connectionDefinitionId: connDef.id,
    ...(payload && { payload }),
  })

  // 🛑 One flow may yield several provider accounts, and only a definition that DECLARES
  // `multiAccount` may. Refusing the extra results here rather than silently taking the
  // first is the point: a provider that starts returning two would otherwise create one
  // connection and drop the other with no error anywhere.
  const multiAccount = provider.capabilities?.multiAccount === true
  const results = Array.isArray(completed) ? completed : [completed]
  if (results.length === 0) {
    throw new Error('The connection flow returned no accounts')
  }
  if (results.length > 1 && !multiAccount) {
    throw new Error(
      `"${connDef.providerKey}" returned ${results.length} accounts but does not declare the multiAccount capability`
    )
  }

  const scopedUserId = connDef.global ? null : stateData.userId
  const existing = await listCredentials({
    organizationId: stateData.organizationId,
    kind: 'connection',
    type: connDef.providerKey,
    userId: scopedUserId,
  })
  const existingRows = existing.isOk() ? existing.value : []

  const credentialIds: string[] = []
  for (const complete of results) {
    const credentialId = await persistCompletion({
      stateData,
      connDef: { id: connDef.id, providerKey: connDef.providerKey, global: !!connDef.global },
      complete,
      multiAccount,
      existingRows,
    })
    credentialIds.push(credentialId)
    await handler.onPersisted?.({
      organizationId: stateData.organizationId,
      userId: stateData.userId,
      connectionDefinitionId: connDef.id,
      ...(payload && { payload }),
      credentialId,
      result: complete,
    })
  }

  logger.info('Hosted-provision connection persisted', {
    connectionDefinitionId: connDef.id,
    providerKey: connDef.providerKey,
    credentialIds,
    accounts: results.length,
  })

  const landingPath = isValidPath(handler.landingPath)
    ? handler.landingPath
    : (stateData.returnTo ?? '/app')
  return { landingPath, credentialIds }
}

/** Persist one completion onto a new or existing Credential and return its id. */
async function persistCompletion(args: {
  stateData: HostedProvisionState
  connDef: { id: string; providerKey: string; global: boolean }
  complete: HostedProvisionCompleteResult
  multiAccount: boolean
  existingRows: { id: string; metadata: Record<string, unknown> }[]
}): Promise<string> {
  const { stateData, connDef, complete, multiAccount, existingRows } = args
  const scopedUserId = connDef.global ? null : stateData.userId

  // Reconnect resolution, in three tiers.
  //
  // The explicit `connectionId` on the state is the row the user pressed Reconnect from
  // and always wins. Failing that: a `multiAccount` provider matches on the completion's
  // own `providerAccountId`, because "the org already has a credential for this provider"
  // is NOT the same question as "the org already has this bank login" - one BoA login and
  // one Wells Fargo login are two rows, and reusing the first for the second is how the
  // second connection silently erases the first. A single-account provider keeps the
  // original behaviour: reuse whatever row exists, so a fresh onboarding attempt updates
  // in place rather than duplicating.
  let existingConnectionId = stateData.connectionId
  if (!existingConnectionId) {
    existingConnectionId = multiAccount
      ? existingRows.find((row) => row.metadata?.providerAccountId === complete.providerAccountId)
          ?.id
      : existingRows[0]?.id
  }

  const result = await saveConnection({
    connectionDefinitionId: connDef.id,
    providerKey: connDef.providerKey,
    name: complete.label,
    organizationId: stateData.organizationId,
    createdById: stateData.userId,
    userId: scopedUserId,
    connectionData: {
      ...(complete.secrets &&
        Object.keys(complete.secrets).length > 0 && { secretFields: complete.secrets }),
      metadata: {
        providerAccountId: complete.providerAccountId,
        ready: complete.ready,
        connectionVariables: complete.connectionVariables,
      },
    },
    ...(existingConnectionId && { connectionId: existingConnectionId }),
  })

  if (result.isErr()) {
    throw result.error
  }
  const credentialId = result.value

  // Reconnect: `saveConnection`'s non-token-mint merge path (mergeManualConnectionEdit) only
  // touches secretFields/secret/metadata.connectionVariables - it never refreshes the top-level
  // providerAccountId/ready. Refresh them explicitly so a re-run of onboarding (e.g. resuming
  // after `ready:false`) actually lands the updated state.
  if (existingConnectionId) {
    const current = await getCredential(credentialId, stateData.organizationId)
    if (current.isOk()) {
      await updateCredential(credentialId, stateData.organizationId, {
        metadata: {
          ...(current.value.metadata as Record<string, unknown>),
          providerAccountId: complete.providerAccountId,
          ready: complete.ready,
        },
      })
    }
  }

  return credentialId
}

/**
 * Generalized hosted-provision Return Route - platform providers only.
 * GET /api/connections/:connectionDefinitionId/hosted-provision/return
 *
 * The REDIRECT leg. Reads + deletes the Redis state minted by the start route, finalizes
 * the provider's hosted flow (`handler.complete`), and persists a Credential - even when
 * `ready` is false, so a refresh/resume can pick the connection back up. Always ends in a
 * full-page redirect to the consumer's `landingPath`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionDefinitionId: string }> }
) {
  const { connectionDefinitionId: defParam } = await params
  const state = request.nextUrl.searchParams.get('state')

  let stateData: HostedProvisionState | null = null

  try {
    if (!state) {
      throw new Error('Missing state parameter')
    }
    stateData = await consumeState(state)
    const { landingPath } = await finalizeHostedProvision(stateData)
    return NextResponse.redirect(buildRedirectUrl(landingPath, { connected: '1' }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Hosted-provision return failed', { error: message, defParam, state })

    // Prefer the consumer's landing path (re-resolved from the URL's def/providerKey, independent
    // of whether the state parsed) so a failed onboarding attempt still lands back on the
    // consumer's settings page; fall back to the caller's returnTo, then a generic default.
    const stateReturnTo = stateData?.returnTo ?? null
    const landingPath =
      (await resolveLandingPathByParam(defParam)) ??
      (isValidPath(stateReturnTo) ? stateReturnTo : null) ??
      '/app'
    return NextResponse.redirect(buildRedirectUrl(landingPath, { connect_error: message }))
  }
}

/**
 * POST /api/connections/:connectionDefinitionId/hosted-provision/return
 *
 * The EMBED leg. An embedded flow finishes inside the tab it started in, so there is no
 * provider navigation to catch - the browser posts `{ state, payload }` itself and gets
 * JSON back instead of a redirect.
 *
 * 🛑 `payload` is whatever the widget produced and is UNTRUSTED. The state token is the
 * only authorization here (it is single-use, org-bound and minted behind a session
 * check), so a handler must treat every value in the payload as an identifier to
 * re-read from the provider, never as a fact to persist. That rule lives in
 * `HostedProvisionCompleteCtx`'s doc comment because it is the handler's to keep - this
 * route cannot know what a given provider's payload means, and must not try.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionDefinitionId: string }> }
) {
  const { connectionDefinitionId: defParam } = await params
  let state: string | null = request.nextUrl.searchParams.get('state')

  try {
    const body = (await request.json().catch(() => ({}))) as {
      state?: string
      payload?: Record<string, unknown>
    }
    state = state ?? body.state ?? null
    if (!state) {
      return NextResponse.json({ error: 'Missing state parameter' }, { status: 400 })
    }

    const stateData = await consumeState(state)
    const { landingPath, credentialIds } = await finalizeHostedProvision(
      stateData,
      body.payload ?? {}
    )
    return NextResponse.json({ credentialIds, landingPath })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Hosted-provision embed return failed', { error: message, defParam })
    const status = (error as { statusCode?: number })?.statusCode ?? 500
    return NextResponse.json({ error: message }, { status })
  }
}
