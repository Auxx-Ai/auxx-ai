// packages/lib/src/apps/connections/connection-added-hooks.ts
// In-process listeners run after a NEW app connection is saved, so a domain (accounting) can react
// to an app connecting without this module knowing about it. Registered at boot by web and worker.

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('app-connection-added-hooks')

export interface AppConnectionAddedContext {
  organizationId: string
  appId: string
  appInstallationId: string
  credentialId: string
  /** The person who connected it. */
  actorUserId: string
  /** Null for an org-scoped connection. */
  userId: string | null
}

export type AppConnectionAddedHook = (ctx: AppConnectionAddedContext) => Promise<void>

const hooks = new Map<string, AppConnectionAddedHook>()

/** Register a listener under a stable name; re-registering replaces it. */
export function registerAppConnectionAddedHook(name: string, hook: AppConnectionAddedHook): void {
  hooks.set(name, hook)
}

/** Run every listener. Never throws: a listener's failure must not fail the connection save. */
export async function runAppConnectionAddedHooks(ctx: AppConnectionAddedContext): Promise<void> {
  for (const [name, hook] of hooks) {
    try {
      await hook(ctx)
    } catch (error) {
      logger.error('App connection-added hook failed', {
        name,
        credentialId: ctx.credentialId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
