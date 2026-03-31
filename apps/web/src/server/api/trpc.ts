/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { database as db } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import { AuxxError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeatureKey } from '@auxx/lib/permissions'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter/redis-rate-limiter'
import { initTRPC, type TRPC_ERROR_CODE_KEY, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { ZodError } from 'zod'

import { auth } from '~/auth/server'
import { ensureWebAppInitialized } from '~/server/bootstrap'

type CreateContextOptions = {
  session: Awaited<ReturnType<typeof auth>> | null
  // Add other potential context properties like headers if needed
  headers: Headers
}

const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    headers: opts.headers,
  }
}

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  await ensureWebAppInitialized() // defensive fallback
  const session = await auth.api.getSession({ headers: opts.headers })

  return createInnerTRPCContext({ session, ...opts, headers: opts.headers })
}

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // By default, `shape` holds { code, message, data }
    // `error` is the original TRPCError with `cause`.
    // If the cause is a ZodError, we can re-shape things.

    if (error.cause instanceof ZodError) {
      const zodError = error.cause as ZodError

      // Turn Zod’s issues into a map: fieldName -> message
      const fieldErrors: Record<string, string> = {}
      zodError.issues.forEach((issue) => {
        // issue.path is an array like ["profile", "email"] if it was nested.
        // Let’s join them with dots for clarity.
        const fieldPath = issue.path.join('.') || 'root'
        // You can customize the message however you like:
        fieldErrors[fieldPath] = issue.message
      })

      return {
        // Keep the original tRPC shape, but override `message` and `data`.
        ...shape,
        message: 'Validation error',
        data: {
          ...shape.data,
          // Expose a neat `fieldErrors` object to the client.
          fieldErrors,
        },
      }
    }

    // Check for custom error codes from service layer
    const cause = error.cause as { code?: string } | undefined
    if (cause?.code) {
      return {
        ...shape,
        data: {
          ...shape.data,
          code: cause.code,
        },
      }
    }

    // If it wasn't a ZodError or custom error, just return the default shape.
    return shape
  },
  // errorFormatter({ shape, error }) {
  //   return {
  //     ...shape,
  //     data: {
  //       ...shape.data,
  //       zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
  //     },
  //   }
  // },
})

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now()

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  const result = await next()

  const end = Date.now()
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`)

  // Log errors with full details for debugging
  if (!result.ok) {
    const error = result.error
    console.error(`❌ tRPC failed on ${path}:`, error.message)
    if (error.cause) {
      console.error(`   Cause:`, error.cause)
    }
    // Log Zod validation errors in detail
    if (error.cause instanceof ZodError) {
      console.error(`   Zod issues:`, JSON.stringify(error.cause.issues, null, 2))
    }
  }

  return result
})

/** Maps HTTP status codes to tRPC error codes */
const HTTP_TO_TRPC: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
}

/**
 * Middleware that catches AuxxError instances thrown by service-layer code
 * and re-throws them as proper TRPCErrors with the correct error code.
 */
const auxxErrorMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof AuxxError) {
      throw new TRPCError({
        code: HTTP_TO_TRPC[error.statusCode] ?? 'INTERNAL_SERVER_ERROR',
        message: error.message,
        cause: error,
      })
    }
    throw error
  }
})

/**
 * Middleware factory that blocks demo organizations from performing the given action.
 * Use with `.use(notDemo('action description'))` on any authenticated procedure.
 *
 * @example
 * protectedProcedure.use(notDemo('connect email integrations')).input(...).mutation(...)
 */
export const notDemo = (action: string) =>
  t.middleware(async ({ ctx, next }) => {
    const session = (ctx as { session: { organizationId: string; isSuperAdmin?: boolean } }).session
    const { DemoGuard } = await import('@auxx/lib/demo')
    await DemoGuard.requireNotDemo(session.organizationId, action, session.isSuperAdmin)
    return next()
  })

/**
 * Rate limiter for tRPC mutations. Uses a token bucket with per-org limits
 * derived from the plan's appMutationsPerMinuteHard feature key.
 */
const mutationRateLimiter = new RedisRateLimiter({
  name: 'trpc:mutations',
  maxRequests: 60,
  perInterval: 60_000,
})

/**
 * Middleware that rate-limits mutations based on the org's plan velocity limit.
 * Queries and subscriptions are not affected.
 */
const mutationRateLimitMiddleware = t.middleware(async ({ ctx, next, type }) => {
  if (type !== 'mutation') return next()

  const orgId = ctx.session?.user?.defaultOrganizationId
  if (!orgId) return next()

  const { features } = await getOrgCache().getOrRecompute(orgId, ['features'])
  const hardLimit = features?.[FeatureKey.appMutationsPerMinuteHard]

  if (hardLimit === '+' || hardLimit === true || hardLimit === undefined || hardLimit === -1) {
    return next()
  }

  if (hardLimit === false || hardLimit === 0) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Mutations are disabled on this plan.',
    })
  }

  const key = `org:${orgId}:user:${ctx.session!.user!.id}`
  const allowed = await mutationRateLimiter.acquire(key, 1)

  if (!allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Please slow down.',
    })
  }

  return next()
})

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware).use(auxxErrorMiddleware)

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(auxxErrorMiddleware)
  .use(mutationRateLimitMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session || !ctx.session.user || !ctx.session.user.defaultOrganizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED' })
    }

    return next({
      ctx: {
        headers: ctx.headers,
        // infers the `session` as non-nullable
        session: {
          ...ctx.session,
          user: ctx.session.user,
          organizationId: ctx.session.user.defaultOrganizationId,
          userId: ctx.session.user.id,
        },
      },
    })
  })
/*create a new admin route */

export const adminProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  const organizationId = ctx.session.user.defaultOrganizationId
  const userId = ctx.session.user.id
  if (!organizationId || !userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' })
  }
  const allowed = await isAdminOrOwner(organizationId, userId)
  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be an admin or owner to perform this action',
    })
  }

  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: {
        ...ctx.session,
        user: ctx.session.user,
        organizationId: ctx.session.user.defaultOrganizationId!,
        userId: ctx.session.user.id,
      },
    },
  })
})

/**
 * Super Admin procedure
 *
 * Only accessible to users with isSuperAdmin = true
 */
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.user.isSuperAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Super admin access required',
    })
  }
  return next()
})
