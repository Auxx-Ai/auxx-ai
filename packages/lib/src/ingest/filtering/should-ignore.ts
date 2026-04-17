// packages/lib/src/ingest/filtering/should-ignore.ts

import type { IngestContext } from '../context'
import type { MessageData } from '../types'
import { matchesFilterEntry } from './matches-filter'

/**
 * Evaluate integration filter settings against a MessageData.
 *
 * Evaluation order:
 * 1. `onlyProcessRecipients` allowlist — if set and no TO matches, ignore
 * 2. `excludeSenders` blocklist — if FROM matches, ignore
 * 3. `excludeRecipients` blocklist — skipped if allowlist was used
 */
export function shouldIgnoreMessage(ctx: IngestContext, messageData: MessageData): boolean {
  const settings = ctx.integrationSettings
  if (!settings) return false

  const fromEmail = messageData.from?.identifier?.toLowerCase().trim()
  const toEmails = (messageData.to ?? [])
    .map((p) => p.identifier?.toLowerCase().trim())
    .filter(Boolean) as string[]
  const ccEmails = (messageData.cc ?? [])
    .map((p) => p.identifier?.toLowerCase().trim())
    .filter(Boolean) as string[]

  const hasAllowlist = settings.onlyProcessRecipients && settings.onlyProcessRecipients.length > 0
  if (hasAllowlist) {
    const anyToMatches = toEmails.some((e) =>
      matchesFilterEntry(e, settings.onlyProcessRecipients!)
    )
    if (!anyToMatches) return true
  }

  if (settings.excludeSenders?.length && fromEmail) {
    if (matchesFilterEntry(fromEmail, settings.excludeSenders)) return true
  }

  if (!hasAllowlist && settings.excludeRecipients?.length) {
    const allRecipients = [...toEmails, ...ccEmails]
    if (allRecipients.some((e) => matchesFilterEntry(e, settings.excludeRecipients!))) return true
  }

  return false
}
