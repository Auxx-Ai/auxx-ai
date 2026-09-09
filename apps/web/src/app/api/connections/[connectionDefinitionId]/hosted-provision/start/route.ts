// apps/web/src/app/api/connections/[connectionDefinitionId]/hosted-provision/start/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { BANK_FEED_PROVIDER_KEY } from '@auxx/lib/banking'
import { resolveHostedProvisionHandler } from '@auxx/lib/connections'
import { getProviderByKey } from '@auxx/lib/connections/providers'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const HOSTED_PROVISION_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL
/** Onboarding can take a while (the user may abandon and come back) - keep the state generous. */
const STATE_TTL_SECONDS = 60 * 60 * 24

const logger = createScopedLogger('connection-hosted-provision-start')

interface HostedProvisionState {
  organizationId: string
  userId: string
  connectionDefinitionId: string
  providerKey: string
  returnTo: string | null
  connectionId?: string
}

/** Validate a returnTo value - must be a relative path, not protocol-relative. */
function isValidReturnTo(value: string | null | undefined): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Generalized hosted-provision Start Route - platform providers only.
 * GET /api/connections/:connectionDefinitionId/hosted-provision/start
 *
 * `:connectionDefinitionId` is resolved smartly: it matches either a ConnectionDefinition `id`
 * or a platform `providerKey` (e.g. `stripeConnect`), so callers can link by either.
 *
 * Two entry modes:
 *  - Fresh connect (no `?state=`): session-guarded, mints a new state token and redirects into
 *    the provider's hosted onboarding flow.
 *  - Refresh leg (`?state=<token>`): the provider's `refresh_url` re-enters here when a hosted
 *    link expires mid-flow. Reuses the already-stored state (no session required - the provider
 *    calls this directly) and re-mints a link via the same idempotent `handler.start`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionDefinitionId: string }> }
) {
  const { connectionDefinitionId: defParam } = await params
  const searchParams = request.nextUrl.searchParams
  const stateParam = searchParams.get('state')
  const redis = await getRedisClient()

  try {
    if (!redis) {
      throw new Error('Redis client unavailable')
    }

    let state: string
    let stateData: HostedProvisionState

    if (stateParam) {
      // Refresh leg: reuse the stored state (the provider hits this URL directly, no session).
      const raw = await redis.get(`hosted-provision:${stateParam}`)
      if (!raw) {
        return NextResponse.json({ error: 'Invalid or expired state token' }, { status: 400 })
      }
      state = stateParam
      stateData = JSON.parse(raw) as HostedProvisionState
      // Extend the TTL - a refresh mid-flow means onboarding is still in progress.
      await redis.setex(`hosted-provision:${state}`, STATE_TTL_SECONDS, JSON.stringify(stateData))
    } else {
      // Fresh connect: session-guarded.
      const session = await auth.api.getSession({ headers: await headers() })
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const organizationId = (session.user as any).defaultOrganizationId
      if (!organizationId) {
        return NextResponse.json({ error: 'No organization' }, { status: 401 })
      }

      const connectionId = searchParams.get('connectionId') ?? undefined
      const returnTo = searchParams.get('returnTo')
      const validReturnTo = isValidReturnTo(returnTo) ? returnTo : null

      const connDef = await db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq, or }) => or(eq(cd.id, defParam), eq(cd.providerKey, defParam)),
      })
      if (!connDef) {
        return NextResponse.json({ error: 'Connection definition not found' }, { status: 404 })
      }
      if (connDef.connectionType !== 'hosted-provision' || !connDef.providerKey) {
        return NextResponse.json(
          { error: 'Hosted provisioning is not configured for this connection' },
          { status: 400 }
        )
      }

      // The gate is keyed off the definition, not the route, and there is now no
      // definition it lets through unasserted.
      //
      // The bank feed is the one hosted-provision definition that touches the
      // ledger, so it needs `ledgerControl` (Area.ledger's Full rung - the
      // chart, the opening balance, and bank feed provisioning). Every OTHER
      // hosted-provision definition asserts `integrationsManage`: hosted
      // provisioning always mints a `Credential`, both shipped definitions are
      // `global: true` so that credential is always ORG-SCOPED
      // (`userId IS NULL`), and org-scoped connection lifecycle is precisely
      // what `Area.integrations`' Full rung governs everywhere else in the
      // product (`routers/connections.ts` `save`, `requireConnectionManageAccess`
      // in `routers/apps.ts`, and the app OAuth authorize route). There is no
      // ownership carve-out to make here for the same reason: nothing on this
      // route mints a user-scoped row.
      //
      // 🛑 `stripeConnect` was the specific hole. Until 2026-09-09 it asserted
      // NOTHING on this route - its only gate was an `AdminGate` on the payments
      // settings page - so any signed-in member could navigate to
      // `/api/connections/stripeConnect/hosted-provision/start` and take the
      // workspace through Stripe Connect onboarding. That was recorded as a
      // known open item (plans/accounting/tasks/12-accountant-permissions.md
      // §11.6, HANDOFF §21) rather than fixed, on the grounds that the money
      // plan should pick its key. `integrationsManage` is not that key and does
      // not pre-empt it: an admin holds it either way, and narrowing it later to
      // a payments-specific key is a strictly smaller change than opening a
      // route that is currently open to everyone.
      //
      // NOT a floor under `ledgerControl`: the bank feed asserts the ledger key
      // ALONE, deliberately. Requiring both would refuse a controller-shaped
      // profile that holds `ledger: Full` and no integrations key, which is
      // exactly the grant task 12 §4.3 designed for bank feed provisioning.
      await requirePermission(
        session.user.id,
        organizationId,
        connDef.providerKey === BANK_FEED_PROVIDER_KEY
          ? PermissionKey.ledgerControl
          : PermissionKey.integrationsManage
      )

      state = crypto.randomBytes(32).toString('hex')
      stateData = {
        organizationId,
        userId: session.user.id,
        connectionDefinitionId: connDef.id,
        providerKey: connDef.providerKey,
        returnTo: validReturnTo,
        ...(connectionId && { connectionId }),
      }
      await redis.setex(`hosted-provision:${state}`, STATE_TTL_SECONDS, JSON.stringify(stateData))
    }

    // Code-native resolution (fact §3): the def carries no `hostedProvisionKey` column - look the
    // provider up in the platform catalog by its providerKey and read the key off the def.
    const provider = getProviderByKey(stateData.providerKey)
    if (!provider?.hostedProvisionKey) {
      return NextResponse.json(
        { error: `No hosted-provision handler configured for "${stateData.providerKey}"` },
        { status: 404 }
      )
    }
    const handler = await resolveHostedProvisionHandler(provider.hostedProvisionKey)

    const returnUrl = `${HOSTED_PROVISION_REDIRECT_BASE}/api/connections/${defParam}/hosted-provision/return?state=${state}`
    const refreshUrl = `${HOSTED_PROVISION_REDIRECT_BASE}/api/connections/${defParam}/hosted-provision/start?state=${state}`

    logger.info('Starting hosted-provision flow', {
      connectionDefinitionId: stateData.connectionDefinitionId,
      providerKey: stateData.providerKey,
      refresh: !!stateParam,
    })

    const started = await handler.start({
      organizationId: stateData.organizationId,
      userId: stateData.userId,
      connectionDefinitionId: stateData.connectionDefinitionId,
      returnUrl,
      refreshUrl,
    })

    // 🛑 Branch on WHAT CAME BACK, never on which provider it is (decision B13). A
    // `redirect` flow is hosted by the provider and continues as a page navigation; an
    // `embed` flow has no page to navigate to, so the caller gets JSON, mounts the
    // provider's widget itself, and POSTs the result to `returnUrl` when it finishes.
    // The `state` token travels with the JSON because the browser - not the provider -
    // is what completes an embed flow, and the return route still keys on it.
    if (started.kind === 'embed') {
      return NextResponse.json({
        kind: 'embed',
        config: started.config,
        state,
        returnUrl,
      })
    }

    return NextResponse.redirect(started.url)
  } catch (error) {
    logger.error('Hosted-provision start failed', {
      error: error instanceof Error ? error.message : String(error),
      defParam,
    })
    const status = (error as { statusCode?: number })?.statusCode ?? 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start hosted provisioning' },
      { status }
    )
  }
}
