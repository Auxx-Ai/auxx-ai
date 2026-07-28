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
import { AuxxError, AuxxErrorCodes } from '@auxx/lib/errors'
import { isOwner } from '@auxx/lib/members'
import {
  FeatureKey,
  FeaturePermissionService,
  getCapabilities,
  PERMISSION_REGISTRY_MAP,
  type PermissionKey,
} from '@auxx/lib/permissions'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter/redis-rate-limiter'
import { initTRPC, type TRPC_ERROR_CODE_KEY, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { ZodError } from 'zod'

import { getSession } from '~/auth/session'
import { ensureWebAppInitialized } from '~/server/bootstrap'

type CreateContextOptions = {
  session: Awaited<ReturnType<typeof getSession>> | null
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
  // Request-memoized: shares the session lookup with layouts/pages in the same
  // RSC render instead of re-running it. Reads the request's own headers, which
  // carry the same cookies as opts.headers in both the fetch adapter and RSC.
  const session = await getSession()

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

    // Unexpected errors (DB failures, etc.) carry internals like raw SQL in
    // their message — never send those to the client. Full details are logged
    // server-side by timingMiddleware. Intentional errors (AuxxError, ZodError,
    // explicit TRPCError) have a specific code and keep their message.
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: 'Internal server error' }
    }

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
    const cause = error.cause as { code?: string; errors?: unknown[] } | undefined
    if (cause?.code) {
      return {
        ...shape,
        data: {
          ...shape.data,
          code: cause.code,
          // Per-node compile errors for the draft-run 422 (evals phase-5A.2′).
          ...(cause.code === 'DRAFT_COMPILE_FAILED' && Array.isArray(cause.errors)
            ? { compileErrors: cause.errors }
            : {}),
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

const AUXX_ERROR_NAMES = new Set<string>(Object.values(AuxxErrorCodes))

/**
 * Detects AuxxError instances by duck-typing rather than `instanceof` alone.
 *
 * `@auxx/lib` is transpiled by Next (see `transpilePackages`), so the `AuxxError`
 * class bound here and the copy inside `@auxx/lib/dist/*.mjs` — which service code
 * actually throws — are different module instances. `instanceof` fails across that
 * boundary, so a thrown `BadRequestError` would otherwise fall through as an
 * `INTERNAL_SERVER_ERROR` and get its message masked. Matching on the `name` +
 * numeric `statusCode` shape keeps the correct code and message regardless of which
 * copy produced the error.
 *
 * Exported for routers whose own try/catch would otherwise flatten an AuxxError
 * into a generic 500 before `auxxErrorMiddleware` can map it (e.g. `record.delete`
 * rethrowing pre-delete-hook rejections).
 */
export const isAuxxError = (error: unknown): error is AuxxError =>
  error instanceof AuxxError ||
  (error instanceof Error &&
    typeof (error as AuxxError).statusCode === 'number' &&
    AUXX_ERROR_NAMES.has(error.name))

/**
 * Middleware that surfaces AuxxError instances thrown by resolver/service code
 * as proper TRPCErrors with the correct HTTP-derived code + message.
 *
 * IMPORTANT — tRPC v11 semantics: middleware `next()` RESOLVES with
 * `{ ok: false, error }` for a downstream throw; it does NOT reject. So a
 * `try/catch` around `next()` never fires for a resolver-thrown error (this used
 * to be a `try/catch` and silently did nothing — every AuxxError got masked as a
 * generic 500 by `errorFormatter`). tRPC has already wrapped the throw as
 * `INTERNAL_SERVER_ERROR` with the original preserved on `.cause`; we detect that
 * and re-throw with the real code + message so the client sees it.
 */
const auxxErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next()
  if (!result.ok && isAuxxError(result.error.cause)) {
    const cause = result.error.cause
    throw new TRPCError({
      code: HTTP_TO_TRPC[cause.statusCode] ?? 'INTERNAL_SERVER_ERROR',
      message: cause.message,
      cause,
    })
  }
  return result
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
/**
 * Owner procedure — genuinely rank-shaped actions ONLY (plan 21 §2.b.4):
 * delete the organization, transfer ownership, manage Owner roles. Everything
 * else gates on a capability via `permissionProcedure` — `adminProcedure` was
 * deleted 2026-07-27 once its last caller migrated (plan 21 §8 step 11); do
 * not reintroduce a role gate for anything a profile should decide.
 */
export const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const allowed = await isOwner(ctx.session.organizationId, ctx.session.userId)
  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the organization Owner can perform this action',
    })
  }

  return next()
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

/**
 * Capability (Layer-2) procedure factory — the per-member permission gate.
 *
 * Mirrors `dispatchProcedure`: resolves the member's {@link CapabilitySet} ONCE
 * (a single cached read, §6.1), runs the plan-AND when the key links a
 * `featureKey`, asserts the key, and attaches the resolved set as
 * `ctx.capabilities` so router bodies reuse it with zero re-resolve.
 *
 * **There is no instance-grant waiver here any more** (handoff item 5b, replacing
 * plan 25 §2's). A member composing `workflows: None` who holds one explicit
 * `view` grant now genuinely HOLDS `workflowsView`: `composeUserCapabilities`
 * synthesizes the area's Read rung from their instance grants, type-aware, at
 * composition time. So the plain assert below is correct for them and the
 * type-blind waiver — which any org with ≥1 dashboard turned into an open door
 * on all four instance-access areas — is gone.
 *
 * The derived key is a FRONT DOOR only: it says the member has some access
 * inside the feature, never which instance. Every procedure behind an
 * instance-access Read key must still assert per instance, and any procedure
 * that returns ORG-WIDE data behind one must scope that data to the instances
 * the member can view (see `dataset.getOrganizationStats`).
 *
 * The `FeatureKey` plan-AND is unaffected and still runs first — it is the whole
 * reason instance-scoped procedures use this rather than `capabilityProcedure`.
 *
 * @example
 * getWorkflow: permissionProcedure(PermissionKey.workflowsManage).query(...)
 */
export const permissionProcedure = (key: PermissionKey) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const meta = PERMISSION_REGISTRY_MAP.get(key)
    if (meta?.featureKey) {
      await new FeaturePermissionService().requireAccess(
        ctx.session.organizationId,
        meta.featureKey
      )
    }
    const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
    capabilities.assert(key)
    return next({ ctx: { capabilities } })
  })

/**
 * Resolves the member's {@link CapabilitySet} and attaches it as
 * `ctx.capabilities` WITHOUT asserting a single key — for routers that need the
 * set to make per-record decisions (e.g. `assertWriteEntity` per entity def in a
 * bulk write). Still one cached read per request (§6.1).
 */
export const capabilityProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  return next({ ctx: { capabilities } })
})
