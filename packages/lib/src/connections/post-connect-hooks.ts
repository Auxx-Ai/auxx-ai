// packages/lib/src/connections/post-connect-hooks.ts
// In-process registry of post-connect provisioning hooks, keyed by provider key.
// The generic OAuth callback runs the matching hook AFTER the credential row commits,
// so domain layers (channels, etc.) can do their own provisioning (create runtime rows,
// arm webhooks) without the connections module depending on them. No-ops when no hook is
// registered for the provider — most platform providers are "just a Credential".

import { createScopedLogger } from '@auxx/logger'
import type { PendingSelectionKind } from './pending-selection'

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
  /**
   * The credential was minted PERSONAL (user-scoped, mail-permissions §11) —
   * channel provisioning branches to a dedicated personal inbox.
   */
  personal?: boolean
  /** Opaque flow context carried through OAuth state (e.g. calendar-grant target). */
  extra?: Record<string, unknown>
}

/**
 * What a hook reports back when it could NOT finish the connect on its own.
 *
 * `undefined` (or a hook that returns nothing) means "provisioned, done" — the shape every
 * existing hook already satisfies, which is why widening the return type edits no hook body.
 */
export interface PostConnectHookResult {
  /**
   * The connect stopped short of provisioning and needs a user choice to finish. The user's
   * answer is collected by a domain-specific mutation; this only names WHAT is outstanding.
   *
   * Typed as `PendingSelectionKind` rather than an inline literal so a second waiting provider
   * is a union member instead of a signature change rippling through the OAuth callback, the
   * popup payload, and the connect flow.
   */
  awaiting?: { kind: PendingSelectionKind; credentialId: string }
}

export interface PostConnectHook {
  /** Provider keys this hook handles. */
  providerKeys: string[]
  run(ctx: PostConnectHookContext): Promise<void | PostConnectHookResult>
}

const registry = new Map<string, PostConnectHook>()

/** Register a hook for each of its provider keys (last writer wins). */
export function registerPostConnectHook(hook: PostConnectHook): void {
  for (const key of hook.providerKeys) {
    registry.set(key, hook)
  }
}

/**
 * Run the hook registered for `providerKey`, if any. No-op (and `undefined`) otherwise.
 *
 * A result carrying `awaiting` means the credential is committed but nothing was provisioned —
 * the caller must not report the connect as finished. See `pending-selection.ts`.
 */
export async function runPostConnectHook(
  providerKey: string,
  ctx: PostConnectHookContext
): Promise<PostConnectHookResult | undefined> {
  const hook = registry.get(providerKey)
  if (!hook) return undefined
  logger.info('Running post-connect hook', { providerKey, credentialId: ctx.credentialId })
  return (await hook.run(ctx)) ?? undefined
}
