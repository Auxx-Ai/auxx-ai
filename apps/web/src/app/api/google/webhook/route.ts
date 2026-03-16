// apps/web/src/app/api/google/webhook/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { type ChannelProviderType, MessageService } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('google-webhook')

// --- Google Pub/Sub Verification (Keep as is) ---
// TODO: Move verification logic to a middleware or utility function
const AUDIENCE = `https://pubsub.googleapis.com/google.pubsub.v1.Subscriber` // Correct audience for Pub/Sub push
const jwksUri = 'https://www.googleapis.com/oauth2/v3/certs'
const client = jwksClient({ jwksUri, cache: true, rateLimit: true, jwksRequestsPerMinute: 5 })

const getSigningKey = async (kid: string): Promise<string> => {
  try {
    const key = await client.getSigningKey(kid)
    // Ensure publicKey or rsaPublicKey is returned
    return (key as jwksClient.RsaSigningKey).getPublicKey()
  } catch (err) {
    logger.error('Error getting signing key:', { error: err, kid })
    throw err
  }
}

async function verifyGoogleWebhook(req: NextRequest): Promise<boolean> {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid Authorization header in Google webhook')
      return false
    }
    const token = authHeader.substring(7)

    const decoded = jwt.decode(token, { complete: true })
    if (!decoded || !decoded.header || !decoded.header.kid) {
      logger.error('Invalid JWT token format in Google webhook')
      return false
    }

    const publicKey = await getSigningKey(decoded.header.kid)
    logger.info('WEBAPP_URL:', WEBAPP_URL)
    const verified = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      // Audience might need adjustment depending on how push endpoint is configured
      // Check Google Cloud console for Pub/Sub push subscription details if needed.
      // Often it's the push endpoint URL or a service account email.
      audience: [
        WEBAPP_URL,
        // 'https://auxx.ai',
        AUDIENCE,
        configService.get<string>('GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL'),
      ].filter(Boolean), // Allow multiple valid audiences
      issuer: ['https://accounts.google.com', 'googleidtoken.googleapis.com'], // Valid issuers
    }) as jwt.JwtPayload // Type assertion

    if (!verified) {
      logger.error('JWT verification failed')
      return false
    }

    // Additional check: verify email if present in token
    // if (verified.email && verified.email_verified) {
    //     // Potentially check against known service account?
    // } else {
    //      logger.warn("JWT token does not contain verified email.");
    // }

    logger.info('Google webhook token verified successfully.')
    return true
  } catch (error: any) {
    logger.error('Error verifying Google webhook token:', {
      error: error.message,
      name: error.name,
      // Avoid logging full token
    })
    return false
  }
}
// --- End Verification ---

// Webhook health check (Keep as is)
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', timestamp: Date.now() })
}

// Main webhook handler
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received Google webhook request')
  // 1. Verify the request comes from Google Pub/Sub
  // Skip verification in development?
  if (process.env.NODE_ENV === 'production') {
    const isValid = await verifyGoogleWebhook(req)
    if (!isValid) {
      logger.warn('Google webhook verification failed.')
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 })
    }
  } else {
    logger.warn('Skipping Google webhook verification in non-production environment.')
  }

  // 2. Process the Pub/Sub message
  try {
    const body = await req.json()

    if (!body || !body.message || !body.message.data) {
      logger.error('Invalid Google webhook message format', { body })
      return NextResponse.json({ error: 'Invalid message format' }, { status: 400 })
    }

    // Decode the actual notification data
    const dataStr = Buffer.from(body.message.data, 'base64').toString('utf-8')
    const data = JSON.parse(dataStr)
    logger.debug('Decoded Pub/Sub message data:', { data })

    // The data contains emailAddress and historyId
    if (!data.emailAddress || !data.historyId) {
      logger.error('Missing emailAddress or historyId in webhook data', { data })
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 })
    }

    // 3. Find the corresponding integration
    // Use metadata query to find integration by email
    const [integration] = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        lastHistoryId: schema.Integration.lastHistoryId,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.provider, 'google'),
          eq(schema.Integration.enabled, true),
          sql`${schema.Integration.metadata} ->> 'email' = ${data.emailAddress}`
        )
      )
      .limit(1)

    if (!integration) {
      // IMPORTANT: Acknowledge the message even if no integration is found
      // to prevent Pub/Sub from retrying indefinitely.
      logger.warn('No active Google integration found for email address. Acknowledging message.', {
        emailAddress: data.emailAddress,
      })
      return NextResponse.json({ status: 'ok - no integration found' }) // Use 200 OK
    }

    logger.info(
      `Found integration ${integration.id} for email ${data.emailAddress}. Triggering sync.`
    )

    // 4. Update history ID and trigger sync
    const currentHistoryId = BigInt(data.historyId)
    const lastKnownHistoryId = integration.lastHistoryId
      ? BigInt(integration.lastHistoryId)
      : BigInt(0)

    // Only proceed if the incoming history ID is newer
    if (currentHistoryId > lastKnownHistoryId) {
      // DON'T update history ID before sync - let syncMessages handle it
      // Store the target history ID for potential rollback scenarios
      const targetHistoryId = data.historyId.toString()

      logger.debug(
        `Starting sync for integration ${integration.id} from ${lastKnownHistoryId} to ${targetHistoryId}`
      )

      // Initialize message service for the integration's organization
      const messageService = new MessageService(integration.organizationId) // Use renamed service

      // Trigger sync for this specific integration.
      // The provider's syncMessages method will use the current lastHistoryId as startHistoryId
      // and update it to the latest after successful processing
      try {
        await messageService.syncMessages('google' as ChannelProviderType, integration.id)
        logger.info('Sync initiated successfully via webhook.', { integrationId: integration.id })
      } catch (syncError) {
        logger.error('Error during sync initiated by webhook:', {
          error: syncError,
          integrationId: integration.id,
        })
        // Even if sync fails, acknowledge the Pub/Sub message to prevent retries.
        // The error is logged, and subsequent syncs (manual or scheduled) can catch up.
      }
    } else {
      logger.warn(
        `Received stale historyId ${data.historyId} (<= ${lastKnownHistoryId}). Skipping sync.`,
        { integrationId: integration.id }
      )
    }

    // 5. Acknowledge the Pub/Sub message
    return NextResponse.json({ success: true, message: 'Webhook processed' }) // Return 200 OK
  } catch (error: any) {
    logger.error('Error processing Google webhook:', { error: error.message, stack: error.stack })
    // Return 500 for internal errors, Pub/Sub might retry.
    // However, if parsing failed, retrying won't help, so maybe return 400 or 200?
    // Let's return 500 for now to indicate server-side issue.
    return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 })
  }
}
