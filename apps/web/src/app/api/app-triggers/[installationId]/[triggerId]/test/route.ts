// apps/web/src/app/api/app-triggers/[installationId]/[triggerId]/test/route.ts

import { database } from '@auxx/database'
import { AppInstallation } from '@auxx/database/schema'
import { getRedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ installationId: string; triggerId: string }> }
) {
  const { installationId, triggerId } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Verify installation belongs to the user's org
  const installation = await database.query.AppInstallation.findFirst({
    where: and(
      eq(AppInstallation.id, installationId),
      eq(AppInstallation.organizationId, session.user.defaultOrganizationId)
    ),
    columns: { id: true },
  })

  if (!installation) {
    return new Response('Forbidden', { status: 403 })
  }

  const body = await req.json()
  const triggerData = body.triggerData ?? {}

  const redis = await getRedisClient(true)
  if (!redis) {
    return new Response('Redis unavailable', { status: 503 })
  }

  const redisKey = `app-trigger-test:${installationId}:${triggerId}:events`
  const testEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'manual',
    triggerData,
  }

  await redis.lpush(redisKey, JSON.stringify(testEvent))
  await redis.ltrim(redisKey, 0, 49)
  await redis.expire(redisKey, 300)

  return Response.json({ ok: true, eventId: testEvent.id })
}
