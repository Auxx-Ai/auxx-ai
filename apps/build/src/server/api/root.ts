// apps/build/src/server/api/root.ts
// Root tRPC router for developer portal

import { createCallerFactory, createTRPCRouter } from './trpc'
import { developerAccountsRouter } from './routers/developer-accounts'
import { appsRouter } from './routers/apps'
import { membersRouter } from './routers/members'
import { connectionsRouter } from './routers/connections'
import { versionsRouter } from './routers/versions'
import { logsRouter } from './routers/logs'

/**
 * Root tRPC router
 * All routers are namespaced under their domain
 */
export const appRouter = createTRPCRouter({
  developerAccounts: developerAccountsRouter,
  apps: appsRouter,
  members: membersRouter,
  connections: connectionsRouter,
  versions: versionsRouter,
  logs: logsRouter,
})

/** Export type for use in client */
export type AppRouter = typeof appRouter

/**
 * Create a server-side caller for the tRPC API
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCaller = createCallerFactory(appRouter)
