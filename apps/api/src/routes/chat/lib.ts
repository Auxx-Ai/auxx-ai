// apps/api/src/routes/chat/lib.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'

export interface LoadedChatWidget {
  channelId: string
  organizationId: string
  widgetId: string
  isActive: boolean
  integrationEnabled: boolean
  allowedDomains: string[]
  appearance: {
    title: string
    subtitle: string | null
    primaryColor: string
    logoUrl: string | null
    position: string
    welcomeMessage: string | null
    autoOpen: boolean
    mobileFullScreen: boolean
    collectUserInfo: boolean
    offlineMessage: string | null
  }
}

/**
 * Loads a chat-widget integration by channel id (= Integration.id). Returns
 * `null` if the integration is missing or not a chat provider.
 *
 * Visitor-facing route: skips the org-cache helper because we don't know the
 * organizationId at call time.
 */
export async function loadChatWidgetByChannelId(
  channelId: string
): Promise<LoadedChatWidget | null> {
  const row = await database.query.Integration.findFirst({
    where: and(eq(schema.Integration.id, channelId), eq(schema.Integration.provider, 'chat')),
    with: { chatWidget: true },
  })
  if (!row?.chatWidget) return null

  return {
    channelId: row.id,
    organizationId: row.organizationId,
    widgetId: row.chatWidget.id,
    isActive: row.chatWidget.isActive,
    integrationEnabled: row.enabled,
    allowedDomains: row.chatWidget.allowedDomains ?? [],
    appearance: {
      title: row.chatWidget.title,
      subtitle: row.chatWidget.subtitle ?? null,
      primaryColor: row.chatWidget.primaryColor,
      logoUrl: row.chatWidget.logoUrl ?? null,
      position: row.chatWidget.position,
      welcomeMessage: row.chatWidget.welcomeMessage ?? null,
      autoOpen: row.chatWidget.autoOpen,
      mobileFullScreen: row.chatWidget.mobileFullScreen,
      collectUserInfo: row.chatWidget.collectUserInfo,
      offlineMessage: row.chatWidget.offlineMessage ?? null,
    },
  }
}

/** Extract hostname from an Origin/Referer header value, or null. */
export function hostnameFromHeader(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

/**
 * Return true if `host` is allowed by `allowedDomains`. An empty allowlist
 * matches everything.
 */
export function isHostAllowed(allowedDomains: string[], host: string | null): boolean {
  if (allowedDomains.length === 0) return true
  if (!host) return false
  return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Echo the request origin in CORS headers when it's allowed; otherwise wildcard. */
export function applyChatCorsHeaders(c: Context, opts: { allowCredentials: boolean }): void {
  const origin = c.req.header('origin')
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  } else {
    c.header('Access-Control-Allow-Origin', '*')
  }
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  if (opts.allowCredentials) {
    c.header('Access-Control-Allow-Credentials', 'true')
  }
}
