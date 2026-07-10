// apps/web/src/app/api/connections/[connectionDefinitionId]/hosted-provision/return/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { getCredential, listCredentials, updateCredential } from '@auxx/credentials/store'
import { database as db } from '@auxx/database'
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

/** Validate a landing/return path — must be a relative path, not protocol-relative. */
function isValidPath(value: string | null | undefined): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Best-effort resolution of the consumer's landing path from the URL's `:connectionDefinitionId`
 * segment alone (id or providerKey) — used to build a sane error redirect even when the Redis
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

/**
 * Generalized hosted-provision Return Route — platform providers only.
 * GET /api/connections/:connectionDefinitionId/hosted-provision/return
 *
 * Reads + deletes the Redis state minted by the start route, finalizes the provider's hosted
 * flow (`handler.complete`), and persists a Credential — even when `ready` is false, so a
 * refresh/resume can pick the connection back up. Always ends in a full-page redirect to the
 * consumer's `landingPath` (no popup mode — hosted-provision is full-page only).
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

    const redis = await getRedisClient()
    if (!redis) {
      throw new Error('Redis client unavailable')
    }

    const raw = await redis.get(`hosted-provision:${state}`)
    if (!raw) {
      throw new Error('Invalid or expired state token')
    }
    await redis.del(`hosted-provision:${state}`)
    stateData = JSON.parse(raw) as HostedProvisionState

    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, stateData!.connectionDefinitionId),
    })
    if (!connDef?.providerKey) {
      throw new Error('Connection definition not found')
    }

    const provider = getProviderByKey(connDef.providerKey)
    if (!provider?.hostedProvisionKey) {
      throw new Error(`No hosted-provision handler configured for "${connDef.providerKey}"`)
    }
    const handler = await resolveHostedProvisionHandler(provider.hostedProvisionKey)

    const complete = await handler.complete({
      organizationId: stateData.organizationId,
      userId: stateData.userId,
      connectionDefinitionId: connDef.id,
    })

    // Reconnect resolution: prefer the explicit connectionId carried on the state (the row the
    // user clicked "Reconnect" from); otherwise look up an existing credential for this provider
    // in the definition's scope so a fresh onboarding attempt still updates in place rather than
    // creating a duplicate row.
    const scopedUserId = connDef.global ? null : stateData.userId
    let existingConnectionId = stateData.connectionId
    if (!existingConnectionId) {
      const existing = await listCredentials({
        organizationId: stateData.organizationId,
        kind: 'connection',
        type: connDef.providerKey,
        userId: scopedUserId,
      })
      if (existing.isOk() && existing.value.length > 0) {
        existingConnectionId = existing.value[0]!.id
      }
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
    // touches secretFields/secret/metadata.connectionVariables — it never refreshes the top-level
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

    await handler.onPersisted?.({
      organizationId: stateData.organizationId,
      userId: stateData.userId,
      connectionDefinitionId: connDef.id,
      credentialId,
    })

    logger.info('Hosted-provision connection persisted', {
      connectionDefinitionId: connDef.id,
      providerKey: connDef.providerKey,
      credentialId,
      ready: complete.ready,
      reconnect: !!existingConnectionId,
    })

    const landingPath = isValidPath(handler.landingPath)
      ? handler.landingPath
      : (stateData.returnTo ?? '/app')
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
