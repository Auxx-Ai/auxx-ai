// packages/lib/src/jobs/maintenance/mail-suggestions-job.ts
// Weekly mail-suggestion mining (plans/mail-filter/03-suggestions-plan.md §5.1).
// Per org → per inbox → ONE indexed grouped query over a 90-day window, then the
// thresholds and suppression rules in `mail-suggestions/mine.ts`. No rollup
// counters and no aggregate table (S8) — that grouped query IS the analysis
// layer, which is why this can be weekly rather than incremental.
//
// Retention runs in the same tick (§5.4): `new` rows older than 90 days are
// swept, `dismissed` rows persist forever because they ARE the suppression list
// (invariant 7).
//
// Scheduled Mondays 05:10 — clear of the 03:00/03:45/04:10/04:25 maintenance
// slots. Weekly rather than nightly on purpose: the evidence is a 90-day
// aggregate, so a daily rerun would burn the query for a card whose numbers
// barely moved.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { mineOrganizationSuggestions, sweepStaleMailSuggestions } from '../../mail-suggestions'
import type { JobContext } from '../types'

const logger = createScopedLogger('mail-suggestions-job')

export const MAIL_SUGGESTIONS_JOB_NAME = 'mailSuggestionsJob'

export interface MailSuggestionsJobData {
  /** Mine one org only — the superadmin / manual-trigger path. Defaults to all. */
  organizationId?: string
  /** Cap orgs processed per run (defence against runaway); defaults to all. */
  batchSize?: number
  /** Skip the retention sweep (used when mining a single org on demand). */
  skipRetention?: boolean
}

export interface MailSuggestionsJobStats {
  organizations: number
  inboxes: number
  groups: number
  written: number
  pruned: number
  expired: number
  errors: number
}

/**
 * Mine every organization's inboxes, then sweep expired undecided cards.
 *
 * One org's failure never stops the run: mining is advisory, and a single
 * mailbox with an unusual shape must not cost every other customer its
 * suggestions for the week.
 */
export async function mailSuggestionsJob(
  ctx: JobContext<MailSuggestionsJobData | undefined>
): Promise<MailSuggestionsJobStats> {
  const { organizationId, batchSize, skipRetention } = ctx.data ?? {}

  const orgs = organizationId
    ? [{ id: organizationId }]
    : await database
        .select({ id: schema.Organization.id })
        .from(schema.Organization)
        .limit(batchSize ?? 100_000)

  const stats: MailSuggestionsJobStats = {
    organizations: orgs.length,
    inboxes: 0,
    groups: 0,
    written: 0,
    pruned: 0,
    expired: 0,
    errors: 0,
  }

  for (const org of orgs) {
    const result = await mineOrganizationSuggestions(database, org.id)
    if (result.isErr()) {
      stats.errors++
      logger.warn('Mail-suggestion mining failed for an organization', {
        organizationId: org.id,
        error: result.error.message,
      })
      continue
    }
    stats.inboxes += result.value.inboxes
    stats.groups += result.value.groups
    stats.written += result.value.written
    stats.pruned += result.value.pruned
  }

  if (!skipRetention) {
    const swept = await sweepStaleMailSuggestions(database)
    if (swept.isErr()) {
      stats.errors++
      logger.warn('Mail-suggestion retention sweep failed', { error: swept.error.message })
    } else {
      stats.expired = swept.value
    }
  }

  logger.info('Mail-suggestion mining finished', stats)
  return stats
}
