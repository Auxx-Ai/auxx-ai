// apps/web/src/app/api/demo/create-session/route.ts

import { database as db, schema } from '@auxx/database'
import { DEMO_SESSION_DURATION_MS, generateDemoEmail, isDemoEnabled } from '@auxx/lib/demo'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter/redis-rate-limiter'
import { createScopedLogger } from '@auxx/logger'
import { count, eq, gt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('demo-create-session')

/** Rate limiter: max 3 demo sessions per IP per hour */
const demoCreationLimiter = new RedisRateLimiter({
  name: 'demo:create',
  maxRequests: 3,
  perInterval: 60 * 60 * 1000, // 1 hour
})

/**
 * Extract client IP from request headers.
 */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}

/**
 * POST /api/demo/create-session
 *
 * Creates an anonymous demo user, demo organization, enqueues seed job,
 * creates a better-auth session, and redirects to /app.
 */
export async function POST(request: NextRequest) {
  if (!isDemoEnabled()) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    // 1. Rate limit by IP
    const ip = getClientIp(request)
    const allowed = await demoCreationLimiter.acquire(`ip:${ip}`)

    if (!allowed) {
      logger.warn('Demo rate limit exceeded', { ip })
      return NextResponse.json(
        { error: 'Too many demo sessions. Please try again later.' },
        { status: 429 }
      )
    }

    // 2. Check concurrent demo org limit (max 100 active)
    const [activeDemoResult] = await db
      .select({ count: count() })
      .from(schema.Organization)
      .where(gt(schema.Organization.demoExpiresAt, new Date()))

    if ((activeDemoResult?.count ?? 0) >= 100) {
      logger.warn('Demo concurrent limit reached', { activeDemoCount })
      return NextResponse.json(
        { error: 'Demo is currently at capacity. Please try again in a few minutes.' },
        { status: 503 }
      )
    }

    // 3. Generate demo credentials
    const email = generateDemoEmail()
    const password = crypto.randomUUID()
    const demoExpiresAt = new Date(Date.now() + DEMO_SESSION_DURATION_MS)

    // 4. Create demo user via better-auth (triggers databaseHooks.user.create)
    // But we need to bypass email verification and onboarding for demo users.
    // First, sign up the user...
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: 'Demo User',
      },
      headers: request.headers,
    })

    if (!signUpResult?.user) {
      logger.error('Failed to create demo user')
      return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
    }

    const userId = signUpResult.user.id

    // 5. Update user to skip onboarding + mark email verified
    await db
      .update(schema.User)
      .set({
        completedOnboarding: true,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.User.id, userId))

    // 6. Find the org created by seedNewUserDatabase (in the auth hook) and set demoExpiresAt
    const [userRecord] = await db
      .select({ defaultOrganizationId: schema.User.defaultOrganizationId })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    const organizationId = userRecord?.defaultOrganizationId

    if (!organizationId) {
      logger.error('Demo user created but no organization found', { userId })
      return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
    }

    // Set the org name and demo expiry
    await db
      .update(schema.Organization)
      .set({
        name: 'Demo Workspace',
        demoExpiresAt,
        completedOnboarding: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.Organization.id, organizationId))

    // 7. The auth hook (seedNewUserDatabase) already called OrganizationSeeder.seedNewOrganization,
    // but it used the default (non-demo) path which creates a trial subscription.
    // We need to fix the subscription to use the demo plan instead.
    // Delete any trial subscription and enqueue demo-specific seeding.
    await db
      .delete(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, organizationId))

    // Find the Demo plan
    const [demoPlan] = await db
      .select({ id: schema.Plan.id })
      .from(schema.Plan)
      .where(eq(schema.Plan.name, 'Demo'))
      .limit(1)

    if (demoPlan) {
      await db.insert(schema.PlanSubscription).values({
        organizationId,
        planId: demoPlan.id,
        plan: 'Demo',
        status: 'active',
        billingCycle: 'MONTHLY',
        seats: 1,
        updatedAt: new Date(),
      })
    }

    // 8. Enqueue async demo data seeding job (customers, tickets, etc.)
    try {
      const maintenanceQueue = getQueue(Queues.maintenanceQueue)
      await maintenanceQueue.add(
        'demoSeedJob',
        {
          organizationId,
          userId,
          userEmail: email,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { count: 10 },
        }
      )
    } catch (error) {
      // Non-fatal: org still works without extra demo data
      logger.error('Failed to enqueue demo seed job', { organizationId, error })
    }

    // 9. Sign in to create a session
    const signInResult = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
    })

    if (!signInResult) {
      logger.error('Failed to sign in demo user', { userId })
      return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
    }

    logger.info('Demo session created', { userId, organizationId, ip })

    // 10. Redirect to app
    // The signInResult from better-auth with nextCookies plugin sets cookies automatically.
    // We just need to redirect.
    const redirectUrl = new URL('/app', request.url)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  } catch (error) {
    logger.error('Demo session creation failed', { error })
    return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
  }
}
