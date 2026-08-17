// packages/lib/src/participants/list-contact-identifiers.ts
//
// Every identifier ONE contact record is reachable at, for one channel.
//
// 🔴 **A point lookup, emphatically not a search.** `search/search-recipients.ts`
// answers "who could I address?" over the whole org and pays for it: trigram
// `similarity()`, a recency rank, a `BitmapOr` sized for a 200k-row corpus, a
// candidate ceiling. This answers "which addresses does THIS record have?" —
// two equality probes on existing btrees (`FieldValue_entityId_fieldId_idx`,
// `Participant_entityInstanceId_idx`), no index and no migration added. Routing
// it through `searchRecipients` with a recordId filter would compute a fuzzy
// rank to order three rows whose correct order is `sortKey`.
//
// The ONE thing the two must share is `channel-identifier-fields`: if this read
// `primary_email` while the composer sits on a phone channel it would offer
// addresses the channel cannot send to — `recipient-search.md` §1.2's dead-row
// bug, rebuilt inside a menu. So it takes the `recipientModel` and derives both
// filters, exactly as `searchRecipients` does; passing `identifierTypes` and
// `systemAttributes` in separately (as the plan originally specified) makes
// their disagreement representable.
//
// 🔴 **Zero access checks live here.** `recordId` is caller-supplied, and this
// returns EVERY identifier on the record rather than the one primary a scoped
// search returned — so the router asserts record read on that one id before
// calling, and answers an unreadable record with an empty list rather than a
// 403 (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache/org-cache-helpers'
import { BadRequestError } from '../errors'
import {
  identifierFieldsForModel,
  identifierTypesForModel,
  type RecipientModel,
} from './channel-identifier-fields'

/**
 * A dropdown of addresses for one person. 25 is far past what any contact
 * carries (1–3 in practice) and exists only so a pathological record cannot
 * stream a thousand rows into a menu.
 */
const DEFAULT_LIMIT = 25

/** One address this contact is reachable at on the requested channel. */
export interface ContactIdentifier {
  /** The committable value — E.164 or a lowercased email, as stored. */
  identifier: string
  identifierType: IdentifierType
  /**
   * `true` = a value on the contact record; `false` = an address only ever
   * corresponded with.
   *
   * ⚠️ The `false` rows are the capability this surface exists to recover
   * (`recipient-search.md` §4.2 gives up the second address of a contact you
   * have only mailed once), and they are also the ones that can surprise:
   * `Participant.entityInstanceId` is set by ingest matching and is
   * `ON DELETE set null`, so it can point at a contact the user does not think
   * of as "them". Present them as *not on record*, never as the contact's own
   * data, and never write one back to the record as a side effect of picking it.
   */
  onRecord: boolean
  /**
   * Record values only: position in ascending `sortKey`, so `0` is the record's
   * primary value. `null` for a corresponded-with row, which has no place in the
   * record's ordering at all — deliberately not `-1` or a large sentinel, both
   * of which sort silently.
   */
  rank: number | null
}

export interface ListContactIdentifiersParams {
  organizationId: string
  /** `EntityInstance.id` of the contact. Read access is the router's job. */
  recordId: string
  /**
   * The sending channel's `PlatformCapabilities.recipientModel`. The model, not
   * a pair of filters — see the file header.
   */
  model: RecipientModel
  limit?: number
}

/**
 * Every address one contact is reachable at on one channel: record values ∪
 * corresponded-with, deduped, record values winning.
 *
 * The two arms run concurrently because neither informs the other — one
 * dropdown open costs two probes, which is the whole argument for fetching on
 * open instead of teaching the recipient search to return an identifier count
 * (~20 extra probes per keystroke, forever, for every user).
 */
export async function listContactIdentifiers(
  db: Database,
  params: ListContactIdentifiersParams
): Promise<Result<ContactIdentifier[], Error>> {
  const limit = params.limit ?? DEFAULT_LIMIT
  if (limit < 1) return err(new BadRequestError('limit must be at least 1'))

  const identifierTypes = identifierTypesForModel(params.model)
  // `[]` means nothing is addressable on this channel (`platform_user`) — an
  // empty result, never an unfiltered one. See `identifierTypesForModel`.
  if (identifierTypes.length === 0) return ok([])

  const [onRecord, correspondedWith] = await Promise.all([
    recordValueArm(db, params, limit),
    correspondedWithArm(db, params, identifierTypes, limit),
  ])

  return ok(mergeIdentifiers(onRecord, correspondedWith, limit))
}

/**
 * Union the two arms, record values first.
 *
 * Extracted as a pure function because the ordering and the tie rule are the
 * only decisions here — everything else is two index probes. Record values win
 * a tie: the same address on the record and in `Participant` is the record's,
 * and reporting it as corresponded-with-only would mark it with an affordance
 * that tells the user to be suspicious of their own data.
 *
 * Record ordering is preserved as-is (ascending `sortKey`, so the primary is
 * first) and corresponded-with rows are appended. 🔴 **Do not sort the merged
 * list.** `rank` is `null` on half the rows by construction, and the two arms
 * are ordered by different things (`sortKey` vs. last-sent recency) with nothing
 * calibrating them.
 */
export function mergeIdentifiers(
  onRecord: readonly ContactIdentifier[],
  correspondedWith: readonly ContactIdentifier[],
  limit: number
): ContactIdentifier[] {
  const seen = new Set<string>()
  const merged: ContactIdentifier[] = []
  for (const row of [...onRecord, ...correspondedWith]) {
    if (merged.length >= limit) break
    const key = dedupeKey(row.identifier)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }
  return merged
}

/**
 * Dedupe key across the arms. Lowercased only — both sides are already
 * canonical (E.164 from the phone write path since #1629, lowercased email from
 * the read paths), so this is a case fold rather than a normalizer.
 * Deliberately NOT `formatPhoneNumber`: that needs a region this function has no
 * business knowing, and it would silently drop a legacy value it cannot parse.
 * The same choice `search-recipients.ts` makes, for the same reason.
 */
function dedupeKey(identifier: string): string {
  return identifier.trim().toLowerCase()
}

/**
 * Arm 1 — values on the contact record.
 *
 * 🔴 `ORDER BY sortKey ASC` is the primary-value contract, not decoration.
 * `contact.primary_email` and `contact.phone` are both multi-value (#1625/#1634)
 * and one row IS one value, so omitting the ordering returns a
 * non-deterministic "primary" — #1613 exists because a read omitted it. This is
 * also the ordering `searchRecipients`' contact LATERAL slices its single row
 * with, which is what keeps the chip's own committed address at `rank: 0` here
 * instead of somewhere in the middle.
 */
async function recordValueArm(
  db: Database,
  params: ListContactIdentifiersParams,
  limit: number
): Promise<ContactIdentifier[]> {
  const fields = identifierFieldsForModel(params.model)
  // `undefined` is a real answer, not a gap: no contact field holds a Facebook
  // PSID or a platform user id, so the arm is skipped rather than falling back
  // to email — which would offer addresses the channel cannot send to.
  if (!fields) return []

  const contactDefId = await getCachedEntityDefId(params.organizationId, 'contact')
  if (!contactDefId) return []

  const customFields = await getCachedCustomFields(params.organizationId, contactDefId)
  const fieldIds = customFields
    .filter(
      (field) => field.systemAttribute && fields.systemAttributes.includes(field.systemAttribute)
    )
    .map((field) => field.id)
  // Zero queries so far — `getCachedCustomFields` is the org cache. An empty
  // list means this org has no field for the channel's systemAttributes, so
  // nothing is addressable through the record. (It is also the only way this
  // arm can plan as a seq scan: `fieldId IN ()`. That would be a cache bug, not
  // an index bug.)
  if (fieldIds.length === 0) return []

  const rows = await db
    .select({ identifier: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, params.organizationId),
        eq(schema.FieldValue.entityId, params.recordId),
        inArray(schema.FieldValue.fieldId, fieldIds),
        isNotNull(schema.FieldValue.valueText)
      )
    )
    // `fieldId` only breaks a tie the `sortKey` ordering cannot: an org holding
    // BOTH `phone` and `primary_phone` has two fields whose first value is
    // `sortKey` 'a'. It makes the answer stable across calls; it does not
    // reorder anything `sortKey` already decides.
    .orderBy(asc(schema.FieldValue.sortKey), asc(schema.FieldValue.fieldId))
    .limit(limit)

  return rows.flatMap((row, index) =>
    row.identifier
      ? [
          {
            identifier: row.identifier,
            // From the model's field spec, never from the row: `FieldValue` has
            // no identifier type, and this is the same switch the composer
            // commits with.
            identifierType: fields.identifierType,
            onRecord: true,
            rank: index,
          },
        ]
      : []
  )
}

/**
 * Arm 2 — addresses this contact has actually corresponded from.
 *
 * A `Participant` row is written only by ingest and chat visitor identity, so a
 * row means *this address has corresponded with you*. That is exactly the
 * address the recipient search cannot offer (it returns one row per person), and
 * therefore the whole reason this surface exists.
 *
 * Ordered most-recently-mailed first, with `identifier` as the tie-break so an
 * address never messaged (`lastSentMessageAt IS NULL` — the common case for an
 * inbound-only correspondent) still has a stable position.
 */
async function correspondedWithArm(
  db: Database,
  params: ListContactIdentifiersParams,
  identifierTypes: readonly IdentifierType[],
  limit: number
): Promise<ContactIdentifier[]> {
  const rows = await db
    .select({
      identifier: schema.Participant.identifier,
      identifierType: schema.Participant.identifierType,
    })
    .from(schema.Participant)
    .where(
      and(
        eq(schema.Participant.organizationId, params.organizationId),
        eq(schema.Participant.entityInstanceId, params.recordId),
        inArray(schema.Participant.identifierType, [...identifierTypes]),
        eq(schema.Participant.isSpammer, false)
      )
    )
    // `DESC NULLS LAST`, not bare `DESC`: SQL defaults `DESC` to `NULLS FIRST`,
    // which would float every never-mailed address above the ones you use.
    .orderBy(
      sql`${schema.Participant.lastSentMessageAt} DESC NULLS LAST`,
      asc(schema.Participant.identifier)
    )
    .limit(limit)

  return rows.map((row) => ({
    identifier: row.identifier,
    identifierType: row.identifierType,
    onRecord: false,
    rank: null,
  }))
}
