// apps/build/src/server/api/trpc.ts
// tRPC initialization for developer portal

import { initTRPC, TRPCError } from '@trpc/server'
import { type FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import SuperJSON from 'superjson'
import { ZodError } from 'zod'
import { database } from '@auxx/database'
import { getSession } from '~/lib/auth'

/**
 * Create context for tRPC requests
 */
export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const session = await getSession()

  return {
    db: database,
    session,
    headers: opts.req.headers,
  }
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>
interface Meta {
  authRequired: boolean
}

/**
 * Initialize tRPC instance
 */
const t = initTRPC
  .context<typeof createTRPCContext>()
  .meta<Meta>()
  .create({
    transformer: SuperJSON,
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

      // If it wasn’t a ZodError, just return the default shape.
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
 * Create a server-side caller
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory

/**
 * Create tRPC router
 */
export const createTRPCRouter = t.router

/**
 * Public procedure - no authentication required
 */
export const publicProcedure = t.procedure

/**
 * Protected procedure - authentication required
 */
export const protectedProcedure = t.procedure.meta({ authRequired: true }).use(({ ctx, next }) => {
  if (!ctx.session?.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  // Narrow the session type to non-nullable
  return next({
    ctx: {
      db: ctx.db,
      headers: ctx.headers,
      session: {
        userId: ctx.session.userId,
        userEmail: ctx.session.userEmail,
        userName: ctx.session.userName,
        userFirstName: ctx.session.userFirstName,
        userLastName: ctx.session.userLastName,
        userImage: ctx.session.userImage,
      },
    },
  })
})
