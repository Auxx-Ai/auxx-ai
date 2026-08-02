// packages/lib/src/mail-unsubscribe/subject-key.ts
// The ONE translation from a `subjectKey` string to a `Message` WHERE fragment.
// Both the executor's target read and the sweep job's "did they keep mailing?"
// count go through here, so the two can never disagree about which messages a
// subject key covers — which is the whole basis of the "Stripe ignored your
// unsubscribe" claim.

import { schema } from '@auxx/database'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { parseMailSubjectKey } from './client'

/**
 * `subjectKey` → a `Message` predicate.
 *
 * `list:<id>` matches on `listId`. `domain:<d>` matches on `senderDomain` **and
 * requires `listId IS NULL`**, mirroring the mining group-by's
 * `coalesce(listId, 'domain:' || senderDomain)`: a message that HAS a list id
 * belongs to its list group, never to the domain fallback. Without that clause
 * the two groups would overlap and a domain-keyed unsubscribe would count mail
 * that a list-keyed one already owns.
 *
 * @throws BadRequestError for an unparseable key — an unknown prefix must not
 * silently degrade into "match nothing", which would report every sender as
 * honoring their unsubscribe.
 */
export function buildSubjectKeyPredicate(subjectKey: string): SQL {
  const parsed = parseMailSubjectKey(subjectKey)
  if (!parsed) throw new BadRequestError(`Unrecognized mail subject key '${subjectKey}'`)

  if (parsed.kind === 'list') return eq(schema.Message.listId, parsed.listId)

  return and(
    isNull(schema.Message.listId),
    eq(schema.Message.senderDomain, parsed.senderDomain)
  ) as SQL
}
