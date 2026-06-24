// apps/web/src/app/api/connection-webhooks/[connectionId]/[topic]/test/route.ts

import { Credential, database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

/**
 * Push a manual delivery onto the connection-webhook inspector stream. Inspector-only:
 * it does NOT fan out to the sink/workflows/agents (a real signed delivery to
 * `POST /webhooks/connection/:id` exercises verify + dedupe + fan-out end-to-end).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; topic: string }> }
) {
  const { connectionId, topic } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const connection = await database.query.Credential.findFirst({
    where: and(
      eq(Credential.id, connectionId),
      eq(Credential.organizationId, session.user.defaultOrganizationId)
    ),
    columns: { id: true },
  })

  if (!connection) {
    return new Response('Forbidden', { status: 403 })
  }

  const body = await req.json()
  const triggerData = body.triggerData ?? {}

  const redis = await getRedisClient(true)
  if (!redis) {
    return new Response('Redis unavailable', { status: 503 })
  }

  const redisKey = `connection-webhook:${connectionId}:${topic}:events`
  const testEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'manual',
    topic,
    triggerData,
  }

  await redis.lpush(redisKey, JSON.stringify(testEvent))
  await redis.ltrim(redisKey, 0, 49)
  await redis.expire(redisKey, 300)

  return Response.json({ ok: true, eventId: testEvent.id })
}
