// packages/lib/src/signals/email/bot-detection.ts
// Classifies open-pixel / click-redirect hits as bot noise vs a real human read (Phase 2 of
// plans/signals/02-email-engagement.md "Open + click tracking"). Two independent tells: a
// known scanner/proxy/bot user-agent substring, or a hit landing implausibly fast after send
// (mailbox-provider link/image prescanning — Apple Mail Privacy Protection, corporate gateways).
// Pure/sync — no DB, no imports beyond the language — so it can run inline on the hot tracking
// endpoint before any signal gets recorded.

/** Case-insensitive substrings matched against the request's User-Agent header. */
const BOT_UA_PATTERNS = [
  'googleimageproxy',
  'ggpht.com',
  'yahoomailproxy',
  'barracuda',
  'mimecast',
  'proofpoint',
  'messagelabs',
  'symantec',
  'trendmicro',
  'slackbot',
  'bingbot',
  'python-requests',
  'python-urllib',
  'curl/',
  'wget/',
  'go-http-client',
  'okhttp',
  'headlesschrome',
  'phantomjs',
  'crawler',
  'spider',
  'linkcheck',
  'scanner',
  'urlscan',
  'validator',
] as const

/** Hits landing this soon after send are near-certainly a provider's prefetch/scan, not a human open. */
const PREFETCH_WINDOW_MS = 10_000

export interface TrackingHitContext {
  userAgent?: string | null
  sentAt?: Date | null
  now?: Date
}

export interface TrackingHitClassification {
  isBot: boolean
  botReason?: 'ua' | 'prefetch'
}

/**
 * Classifies a single open/click hit. A missing or empty User-Agent is NOT treated as a bot
 * signal on its own — several mainstream mail clients strip it — so absence of evidence isn't
 * evidence of a bot.
 */
export function classifyTrackingHit(ctx: TrackingHitContext): TrackingHitClassification {
  const userAgent = ctx.userAgent?.toLowerCase().trim()
  if (userAgent && BOT_UA_PATTERNS.some((pattern) => userAgent.includes(pattern))) {
    return { isBot: true, botReason: 'ua' }
  }

  if (ctx.sentAt) {
    const now = ctx.now ?? new Date()
    if (now.getTime() - ctx.sentAt.getTime() < PREFETCH_WINDOW_MS) {
      return { isBot: true, botReason: 'prefetch' }
    }
  }

  return { isBot: false }
}
