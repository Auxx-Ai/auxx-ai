// apps/web/src/auth/trusted-apps.ts

import { DEV_PORTAL_URL, KB_URL } from '@auxx/config/server'
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/** Known satellite apps that can receive login tokens */
export type TrustedAppId = 'build' | 'kb'

interface ResolveOpts {
  /** Required when `appId === 'kb'` to resolve custom-domain origins */
  kbId?: string
}

/**
 * Resolve a trusted satellite app to its target origin URL.
 *
 * For `build`: returns the static `DEV_PORTAL_URL`.
 * For `kb`: requires `opts.kbId`. Returns the KB's verified custom domain
 * (`https://${customDomain}`) when `customDomainVerifiedAt != null`, else
 * falls back to `KB_URL`. Unverified custom domains never become a token
 * audience — that's the gate against issuing trust to unconfigured DNS.
 */
export async function resolveTrustedAppOrigin(
  appId: string,
  opts?: ResolveOpts
): Promise<string | null> {
  if (appId === 'build') return DEV_PORTAL_URL

  if (appId === 'kb') {
    if (!opts?.kbId) return KB_URL
    const [kb] = await database
      .select({
        customDomain: schema.KnowledgeBase.customDomain,
        customDomainVerifiedAt: schema.KnowledgeBase.customDomainVerifiedAt,
      })
      .from(schema.KnowledgeBase)
      .where(eq(schema.KnowledgeBase.id, opts.kbId))
      .limit(1)

    if (!kb) return null
    if (kb.customDomain && kb.customDomainVerifiedAt) {
      return `https://${kb.customDomain}`
    }
    return KB_URL
  }

  return null
}

/** Synchronous resolver for static apps (no DB lookup). */
export function getTrustedAppOrigin(appId: string): string | null {
  if (appId === 'build') return DEV_PORTAL_URL
  if (appId === 'kb') return KB_URL
  return null
}

/** Check if an app ID is registered */
export function isTrustedApp(appId: string): boolean {
  return appId === 'build' || appId === 'kb'
}
