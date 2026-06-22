// packages/lib/src/connections/post-connect-hooks.ts
// In-process registry of post-connect provisioning hooks, keyed by provider key.
// The generic OAuth callback runs the matching hook AFTER the credential row commits,
// so domain layers (channels, etc.) can do their own provisioning (create runtime rows,
// arm webhooks) without the connections module depending on them. No-ops when no hook is
// registered for the provider — most platform providers are "just a Credential".

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('post-connect-hooks')

export interface PostConnectHookContext {
  /** The freshly-committed credential row id. */
  credentialId: string
  /** The provider blueprint key (e.g. `gmail`, `outlookMail`). */
  providerKey: string
  organizationId: string
  /** The connecting user (the credential's `createdById`). */
  userId: string
  /** Present on reconnect/reauth — the rotated credential id (== `credentialId`). */
  connectionId?: string
  /** Opaque flow context carried through OAuth state (e.g. calendar-grant target). */
  extra?: Record<string, unknown>
}

export interface PostConnectHook {
  /** Provider keys this hook handles. */
  providerKeys: string[]
  run(ctx: PostConnectHookContext): Promise<void>
}

const registry = new Map<string, PostConnectHook>()

/** Register a hook for each of its provider keys (last writer wins). */
export function registerPostConnectHook(hook: PostConnectHook): void {
  for (const key of hook.providerKeys) {
    registry.set(key, hook)
  }
}

/** Run the hook registered for `providerKey`, if any. No-op otherwise. */
export async function runPostConnectHook(
  providerKey: string,
  ctx: PostConnectHookContext
): Promise<void> {
  const hook = registry.get(providerKey)
  if (!hook) return
  logger.info('Running post-connect hook', { providerKey, credentialId: ctx.credentialId })
  await hook.run(ctx)
}
