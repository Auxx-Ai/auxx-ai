// packages/lib/src/participants/search/search-recipients.ts
//
// Ranked recipient search: **participants ∪ contacts**, one endpoint.
//
// Why a union. `Participant` rows are written only by ingest and chat visitor
// identity, so a row means *you have corresponded with this address* — one row IS
// one identifier. A contact imported into the CRM and never messaged has no row
// at all. A helpdesk composer needs both: "reply to the person who wrote in" and
// "email this contact for the first time" are both core motions. The composer this
// replaces searched contact RECORDS only, and then had to fan each record out to
// its N identifiers on the client to find something addressable.
//
// 🔴 **Zero access checks live here.** The router asserts and hands both scopes
// down as SQL (`docs/lib-module-guide.md` §6). The two arms keep two *different*
// gates and this file must not flatten them: the participant arm narrows with the
// mail lens (`threadVisibility`), the contact arm with record scope
// (`contactVisibility`). They are different authorization models; merging them is
// how a permissions bug gets written.

import { type Database, schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import { DEFAULT_PHONE_REGION, type PhoneRegion } from '@auxx/utils'
import { type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache/org-cache-helpers'
import { BadRequestError } from '../../errors'
import {
  recordSearchColumnsAliased,
  recordSearchPredicate,
  recordSearchRank,
} from '../../resources/search/record-search-sql'
import {
  identifierFieldsForModel,
  identifierTypesForModel,
  type RecipientModel,
} from '../channel-identifier-fields'
import {
  participantDisplayLabel,
  participantSearchBinding,
  participantSearchPredicate,
  participantSearchRank,
} from './participant-search-sql'
import { phoneSearchPatterns } from './phone-query'

/** Default page size. A recipient picker shows ~20 and you refine by typing. */
const DEFAULT_LIMIT = 20

/**
 * How many text matches the lens `EXISTS` may examine before giving up.
 *
 * 🔴 **This is a recall cap and it is deliberate.** Measured on 200k participants
 * / 10k per org: the lens semi-join costs 12 ms in the typical case (Postgres
 * sorts the outer side first and probes ~22 rows to fill 20), but **51 ms when a
 * wide lens excludes every match** — all matching candidates probed, zero rows
 * returned. That case is not exotic: a member holding several inboxes searching a
 * common surname whose threads live elsewhere. Capping the candidate set bounds it
 * at ~1 200 probes instead of unbounded, with no effect on the good case.
 *
 * If the 20 visible matches all rank below the 200th text match they are missed.
 * For a picker where you refine by typing, rank 200+ on a fuzzy-name query is not
 * a row anyone was going to scroll to — but it IS a cap, so
 * {@link RecipientSearchResult.truncated} reports when it bound the answer.
 */
const CANDIDATE_CEILING = 200

/** One addressable candidate. */
export interface RecipientCandidate {
  /**
   * The committable value — E.164 or a lowercased email. **Never null**: both
   * arms resolve it in SQL, the contact arm via an inner LATERAL that doubles as
   * the filter, so a contact with no value for this channel cannot reach the list.
   */
  identifier: string
  identifierType: IdentifierType
  /** The person's name. Equals `identifier` when no name is known. */
  displayName: string
  /** `EntityInstance.id` of the contact, when there is one. */
  contactId: string | null
  /**
   * Which arm produced it. Drives the "never messaged before" affordance only —
   * both arms return equally committable rows.
   */
  source: 'participant' | 'contact'
  /**
   * Relevance within this row's OWN arm.
   *
   * ⚠️ **Not comparable across arms**, which is why the ordering is tiered rather
   * than blended — see {@link searchRecipients}.
   */
  score: number
}

export interface RecipientSearchResult {
  candidates: RecipientCandidate[]
  /**
   * True when {@link CANDIDATE_CEILING} was reached AND fewer than `limit` rows
   * came back — the one combination where the cap can have changed the answer.
   * Surfaced rather than logged so a caller can say "refine your search" instead
   * of implying the list is exhaustive.
   */
  truncated: boolean
}

export interface SearchRecipientsParams {
  organizationId: string
  /** Empty or whitespace switches to the most-recently-mailed path. */
  query: string
  /**
   * The channel's recipient model.
   *
   * 🔴 **The model, not a pair of filters.** The plan originally specified
   * `identifierTypes` and `systemAttributes` as separate params, which makes it
   * *representable* to filter participants to `PHONE` while reading
   * `primary_email` off contacts — a wrong answer that looks plausible because
   * both halves are individually correct. Taking the model and deriving both from
   * `channel-identifier-fields` makes that disagreement unrepresentable.
   *
   * It also removes the `identifierTypes: []` fail-open entirely rather than
   * guarding it: `identifierTypesForModel` never returns `undefined`, and a model
   * with no addressable type (`platform_user`) returns `[]`, which this function
   * answers with an empty result — never with "no filter".
   */
  model: RecipientModel
  /**
   * Region national (no `+`) phone input is parsed against. Must be the SENDING
   * channel's own region (`regionFromIdentifier`) — the same input means different
   * numbers in different regions. Ignored by non-phone models.
   */
  region?: PhoneRegion
  limit?: number
  /**
   * Mail-lens predicate for the participant arm, from
   * `buildMailVisibilityPredicate`. `undefined` means unscoped (SYSTEM only) and
   * emits **no `EXISTS` at all** — not an always-true one, which would still pay
   * for the semi-join.
   *
   * 🔴 Must constrain the `Thread` table **unaliased**. It is built from
   * `schema.Thread` `PgColumn` refs, which render as `"Thread"."inboxId"`, and a
   * Postgres alias replaces the table name — so the join below deliberately does
   * not alias `Thread`.
   */
  threadVisibility?: SQL
  /**
   * Record-scope predicate for the contact arm, built against the `ei` alias.
   * `null` means the caller resolved scope to "no rows" — the contact arm is
   * skipped entirely and the participant arm still answers.
   */
  contactVisibility?: SQL | null
}

/**
 * Search addressable recipients for one channel.
 *
 * **Ordering is tiered, not blended: participants first, then contacts.**
 * The two arms' scores are on different scales — the participant rank is
 * `2·name + 1·identifier + 0.25·recency` and the contact rank is the record
 * binding's `2·trigram + ts_rank_cd` — and nothing calibrates them against each
 * other. Blending them would be a guess dressed as a ranking. Tiering is also the
 * right answer on the merits: a person you have corresponded with is a better
 * recipient guess than one you have not, which is the same reasoning that lets a
 * participant row suppress its contact row below.
 *
 * **No cursor, no paging.** A deliberate scope cut that buys real safety: the
 * record picker has a live skip/duplicate bug from pairing a two-part keyset with
 * a three-part `ORDER BY` (`record-search-sql.ts:143-151`). Not having a cursor
 * makes that unrepresentable — and it is *required* here, because
 * `participantSearchRank` reads `now()` and so is not stable across calls.
 */
export async function searchRecipients(
  db: Database,
  params: SearchRecipientsParams
): Promise<Result<RecipientSearchResult, Error>> {
  const limit = params.limit ?? DEFAULT_LIMIT
  if (limit < 1) return err(new BadRequestError('limit must be at least 1'))

  const identifierTypes = identifierTypesForModel(params.model)
  // `[]` means nothing is addressable on this channel — an empty result, never an
  // unfiltered one. See `SearchRecipientsParams.model`.
  if (identifierTypes.length === 0) return ok({ candidates: [], truncated: false })

  const query = params.query.trim()
  const region = params.region ?? DEFAULT_PHONE_REGION
  const phonePatterns = params.model === 'phone' && query ? phoneSearchPatterns(query, region) : []

  const participants = query
    ? await participantArm(db, params, { query, identifierTypes, phonePatterns, limit })
    : await recentlyMailedArm(db, params, { identifierTypes, limit })

  // §4.2: a contact reachable through the participant arm is already listed, with
  // a recency signal the contact row has no equivalent for. Semantically exact,
  // not a heuristic — the contact arm exists ONLY to surface people never
  // corresponded with.
  const contacts =
    // An empty query lists most-recently-mailed; a contact never messaged has no
    // business at the top of that list.
    query && params.contactVisibility !== null
      ? await contactArm(db, params, { query, phonePatterns, limit, region })
      : []

  const candidates = mergeArms(participants.rows, contacts, limit)
  return ok({
    candidates,
    truncated: participants.hitCeiling && candidates.length < limit,
  })
}

/**
 * Merge the two arms into one ordered list.
 *
 * Extracted as a pure function because this is where the real decisions live —
 * everything around it is SQL. Two rules, in this order:
 *
 * 1. **Suppress by contact id (§4.2).** A contact reachable through the
 *    participant arm is already listed, and that row is strictly better: it
 *    carries a recency signal the contact row has no equivalent for. Semantically
 *    exact rather than a heuristic — the contact arm exists ONLY to surface people
 *    never corresponded with.
 *
 *    ⚠️ Consequence accepted knowingly: a contact with two emails where you have
 *    mailed only one returns ONE row, not two. The second address is reachable by
 *    typing it, or through the chip menu
 *    (`plans/email-editor/recipient-address-switch.md`). The picker is for
 *    *people*, and reintroducing per-record fan-out is what this endpoint exists
 *    to delete.
 *
 * 2. **Then dedupe by identifier**, which catches the same address arriving from
 *    both arms without a shared contact id — a `Participant` whose
 *    `entityInstanceId` was never linked, for instance.
 *
 * Participants keep their position ahead of contacts. 🔴 **Do not sort the merged
 * list by `score`.** The two arms' scores are on different scales (participant:
 * `2·name + 1·identifier + 0.25·recency`; contact: the record binding's
 * `2·trigram + ts_rank_cd`) and nothing calibrates them, so a blended sort would be
 * a guess presented as a ranking. Tiering is also right on the merits: someone you
 * have corresponded with is the better guess.
 */
export function mergeArms(
  participants: readonly RecipientCandidate[],
  contacts: readonly RecipientCandidate[],
  limit: number
): RecipientCandidate[] {
  const seenContactIds = new Set(
    participants.map((row) => row.contactId).filter((id): id is string => id !== null)
  )
  const seenIdentifiers = new Set(participants.map((row) => identifierKey(row.identifier)))

  const merged = participants.slice(0, limit)
  for (const row of contacts) {
    if (merged.length >= limit) break
    if (row.contactId && seenContactIds.has(row.contactId)) continue
    const key = identifierKey(row.identifier)
    if (seenIdentifiers.has(key)) continue
    seenIdentifiers.add(key)
    merged.push(row)
  }
  return merged
}

/**
 * Rows off a raw `db.execute`, typed by the caller.
 *
 * Drizzle types a raw result as `Record<string, unknown>[]`, so a cast is
 * unavoidable for hand-written SQL. Keeping it in one function means there is one
 * place to look when a column is renamed, instead of four casts that each looked
 * fine in isolation. 🔴 The row interfaces below are a CLAIM about the `SELECT`
 * list, not a check on it — change one, change the other.
 */
function rowsOf<T>(result: { rows?: Record<string, unknown>[] }): T[] {
  return (result.rows ?? []) as unknown as T[]
}

/**
 * Dedupe key across arms. Lowercased only — the identifiers are already canonical
 * (E.164 from the phone write path, lowercased email from the read paths), so
 * this is a case fold rather than a normalizer. Deliberately NOT
 * `formatPhoneNumber`: that would need a region here and would silently drop a
 * legacy value it cannot parse.
 */
function identifierKey(identifier: string): string {
  return identifier.trim().toLowerCase()
}

/** `IN (…)` over a string list. Drizzle's `= ANY(${array}::text[])` matches nothing. */
function inList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`
}

/**
 * The lens `EXISTS`, or `undefined` when the viewer is unscoped.
 *
 * `MessageParticipant → Message → Thread`, the id-correct path.
 * **Deliberately not `ThreadParticipant`**, despite being one hop shorter: its
 * only usable key is `email` (a wide text column with no index of its own), it
 * measured 1.5× *slower*, and it is a rollup rather than a mirror — 55 of 19 807
 * thread↔identifier pairs present in `MessageParticipant` are missing from it, so
 * scoping on it would silently hide real correspondence.
 *
 * `EXISTS` rather than a join + `DISTINCT`: a hot participant is on 5 000+
 * messages, and the semi-join stops at the first visible thread.
 */
function lensExists(participantId: SQL, threadVisibility: SQL | undefined): SQL | undefined {
  if (!threadVisibility) return undefined
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.MessageParticipant} mp
    JOIN ${schema.Message} m ON m."id" = mp."messageId"
    JOIN ${schema.Thread} ON ${schema.Thread}."id" = m."threadId"
    WHERE mp."participantId" = ${participantId}
      AND ${threadVisibility}
      -- Merged-away threads must not keep a participant visible. There is NO
      -- \`deletedAt\` on Thread — an early draft filtered one, on the strength of
      -- the guide's soft-delete rule, which is about \`Integration.deletedAt\`.
      -- Postgres rejected it; a rendered-SQL test would not have.
      -- \`Thread_organizationId_...\` carries a partial index on exactly this
      -- predicate.
      AND ${schema.Thread}."mergedIntoThreadId" IS NULL
  )`
}

interface ParticipantArmResult {
  rows: RecipientCandidate[]
  /** The text-match set reached {@link CANDIDATE_CEILING}. */
  hitCeiling: boolean
}

/**
 * The ranked participant arm: text match capped at {@link CANDIDATE_CEILING},
 * then the lens semi-join, then the page.
 *
 * The cap sits in a CTE so the `EXISTS` cannot be applied to an unbounded match
 * set. Its inner `ORDER BY` is the same expression the outer one uses, because a
 * cap that slices by a different ordering than it reports is a silent wrong answer
 * rather than a slow one.
 */
async function participantArm(
  db: Database,
  params: SearchRecipientsParams,
  input: {
    query: string
    identifierTypes: readonly IdentifierType[]
    phonePatterns: readonly string[]
    limit: number
  }
): Promise<ParticipantArmResult> {
  const p = participantSearchBinding('p')
  const rank = participantSearchRank(input.query, p)
  const predicate = participantSearchPredicate(input.query, p, input.phonePatterns)
  const lens = lensExists(sql`c."id"`, params.threadVisibility)

  // The linked contact joins for the LABEL only (`participantDisplayLabel`) —
  // predicate and rank stay on the stored participant columns, so match/rank
  // behavior and the trigram index plan are untouched.
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT p."id",
             p."identifier",
             p."identifierType",
             ${participantDisplayLabel(p, 'ct')} AS "displayName",
             p."entityInstanceId",
             p."lastSentMessageAt",
             ${rank} AS score
      FROM ${schema.Participant} p
      LEFT JOIN ${schema.EntityInstance} ct
        ON ct."id" = p."entityInstanceId"
        AND ct."organizationId" = ${params.organizationId}
        AND ct."archivedAt" IS NULL
      WHERE p."organizationId" = ${params.organizationId}
        AND NOT p."isSpammer"
        AND p."identifierType" IN ${inList(input.identifierTypes)}
        AND ${predicate}
      ORDER BY score DESC, p."lastSentMessageAt" DESC NULLS LAST, p."id" DESC
      LIMIT ${CANDIDATE_CEILING}
    )
    SELECT c.*, (SELECT count(*)::int FROM candidates) AS candidate_count
    FROM candidates c
    ${lens ? sql`WHERE ${lens}` : sql``}
    ORDER BY c."score" DESC, c."lastSentMessageAt" DESC NULLS LAST, c."id" DESC
    LIMIT ${input.limit}
  `)

  const rows = rowsOf<ParticipantRow>(result)
  return {
    rows: rows.map(toParticipantCandidate),
    hitCeiling: Number(rows[0]?.candidate_count ?? 0) >= CANDIDATE_CEILING,
  }
}

/**
 * The empty-query path: most recently mailed.
 *
 * The single most useful default a composer has, and the one case where the answer
 * is exact rather than fuzzy. A straight index scan on
 * `Participant_org_lastSent_idx`.
 *
 * 🔴 `DESC NULLS LAST`, not bare `DESC`. SQL defaults `DESC` to `NULLS FIRST`, the
 * index is `NULLS LAST`, and the planner will not prove them equivalent even
 * though the `WHERE` excludes nulls — measured, bare `DESC` keeps a `Sort` on top
 * of the scan while `DESC NULLS LAST` is an ordered scan that stops at `limit`.
 *
 * Scoped by the same lens: this is the widest possible enumeration of the org's
 * correspondents, so leaving it unscoped while scoping the typed path would leave
 * the hole open at its widest.
 */
async function recentlyMailedArm(
  db: Database,
  params: SearchRecipientsParams,
  input: { identifierTypes: readonly IdentifierType[]; limit: number }
): Promise<ParticipantArmResult> {
  const lens = lensExists(sql`p."id"`, params.threadVisibility)
  const p = participantSearchBinding('p')

  // Same label-only contact join as `participantArm` — the empty-query list
  // feeds the same picker, so its rows must carry the same name.
  const result = await db.execute(sql`
    SELECT p."id",
           p."identifier",
           p."identifierType",
           ${participantDisplayLabel(p, 'ct')} AS "displayName",
           p."entityInstanceId",
           p."lastSentMessageAt",
           0::float8 AS score
    FROM ${schema.Participant} p
    LEFT JOIN ${schema.EntityInstance} ct
      ON ct."id" = p."entityInstanceId"
      AND ct."organizationId" = ${params.organizationId}
      AND ct."archivedAt" IS NULL
    WHERE p."organizationId" = ${params.organizationId}
      AND NOT p."isSpammer"
      AND p."identifierType" IN ${inList(input.identifierTypes)}
      AND p."lastSentMessageAt" IS NOT NULL
      ${lens ? sql`AND ${lens}` : sql``}
    ORDER BY p."lastSentMessageAt" DESC NULLS LAST, p."id" DESC
    LIMIT ${input.limit}
  `)

  return {
    rows: rowsOf<ParticipantRow>(result).map(toParticipantCandidate),
    hitCeiling: false,
  }
}

interface ParticipantRow {
  id: string
  identifier: string
  identifierType: IdentifierType
  displayName: string | null
  entityInstanceId: string | null
  score: number | string
  candidate_count?: number | string
}

function toParticipantCandidate(row: ParticipantRow): RecipientCandidate {
  return {
    identifier: row.identifier,
    identifierType: row.identifierType,
    // `displayName` is nullable and the nulls are real (403 of 15 244 rows; 29% in
    // one live org). Falling back to the identifier matches what every write site
    // would have stored, and §5's row renders one line when the two are equal.
    displayName: row.displayName ?? row.identifier,
    contactId: row.entityInstanceId,
    source: 'participant',
    score: Number(row.score),
  }
}

/**
 * The contact arm — people in the CRM never corresponded with.
 *
 * Two shapes, because the selective table differs by query kind:
 *
 * 1. **name query** — search `EntityInstance` with the existing record predicate,
 *    and resolve the identifier through an **inner** `LATERAL` on `FieldValue`.
 *    The LATERAL does both jobs at once: a contact with no value for this
 *    channel's field produces an empty subquery and drops out, and every surviving
 *    row arrives carrying the exact string to commit. That is what makes a
 *    phone-less contact in a phone composer *unrepresentable* rather than
 *    filtered-after-the-fact.
 * 2. **digit query** — `EntityInstance.searchText` is `displayName +
 *    secondaryDisplayValue` and nothing else, so the record predicate cannot match
 *    a field value: measured **0 rows** for a 7-digit query over 100k contacts
 *    that all had phone numbers. For digits the selective side is `FieldValue`, so
 *    the join is inverted and served by
 *    `FieldValue_org_field_valueText_trgm_idx` (0.30 ms over 200k rows).
 *
 * Both are needed: (1) cannot find a number, (2) cannot find a name.
 */
async function contactArm(
  db: Database,
  params: SearchRecipientsParams,
  input: {
    query: string
    phonePatterns: readonly string[]
    limit: number
    region: PhoneRegion
  }
): Promise<RecipientCandidate[]> {
  const fields = identifierFieldsForModel(params.model)
  // `undefined` is a real answer, not a gap: no contact field holds a Facebook
  // PSID or a platform user id, so the arm is skipped rather than falling back to
  // email — which would offer addresses the channel cannot send to.
  if (!fields) return []

  const contactDefId = await getCachedEntityDefId(params.organizationId, 'contact')
  if (!contactDefId) return []

  const customFields = await getCachedCustomFields(params.organizationId, contactDefId)
  const fieldIds = customFields
    .filter(
      (field) => field.systemAttribute && fields.systemAttributes.includes(field.systemAttribute)
    )
    .map((field) => field.id)
  // Zero queries so far — `getCachedCustomFields` is the org cache, so the field
  // ids are inlined as literals below. An empty list means this org has no field
  // for the channel's systemAttributes; nothing is addressable through records.
  if (fieldIds.length === 0) return []

  const scope = params.contactVisibility ? sql`AND ${params.contactVisibility}` : sql``
  const rows = input.phonePatterns.length
    ? await contactsByFieldValue(db, params, { ...input, fieldIds, contactDefId, scope })
    : await contactsByName(db, params, { ...input, fieldIds, contactDefId, scope })

  return rows.map((row) => ({
    identifier: row.identifier,
    identifierType: fields.identifierType,
    displayName: row.displayName ?? row.identifier,
    contactId: row.id,
    source: 'contact' as const,
    score: Number(row.score ?? 0),
  }))
}

interface ContactRow {
  id: string
  displayName: string | null
  identifier: string
  score?: number | string
}

/** Shape (1): text-match records, resolve the identifier via an inner LATERAL. */
async function contactsByName(
  db: Database,
  params: SearchRecipientsParams,
  input: {
    query: string
    limit: number
    fieldIds: string[]
    contactDefId: string
    scope: SQL
  }
): Promise<ContactRow[]> {
  const ei = recordSearchColumnsAliased('ei')
  const result = await db.execute(sql`
    SELECT ei."id",
           ei."displayName",
           ident."valueText" AS identifier,
           ${recordSearchRank(input.query, ei)} AS score
    FROM ${schema.EntityInstance} ei
    JOIN LATERAL (
      SELECT fv."valueText"
      FROM ${schema.FieldValue} fv
      WHERE fv."entityId" = ei."id"
        AND fv."fieldId" IN ${inList(input.fieldIds)}
        AND fv."valueText" IS NOT NULL
      -- The primary value is the FIRST row by ascending sortKey (#1613). Both
      -- contact.primary_email and contact.phone are multi-value since #1625/#1634,
      -- and omitting this ordering returns a non-deterministic "primary".
      ORDER BY fv."sortKey" ASC
      LIMIT 1
    ) ident ON TRUE
    WHERE ei."organizationId" = ${params.organizationId}
      AND ei."entityDefinitionId" = ${input.contactDefId}
      AND ei."archivedAt" IS NULL
      AND ${recordSearchPredicate(input.query, ei)}
      ${input.scope}
    ORDER BY score DESC, ei."updatedAt" DESC, ei."id" DESC
    LIMIT ${input.limit}
  `)
  return rowsOf<ContactRow>(result)
}

/** Shape (2): `FieldValue`-first for a digit query, then join back to the record. */
async function contactsByFieldValue(
  db: Database,
  params: SearchRecipientsParams,
  input: {
    phonePatterns: readonly string[]
    limit: number
    fieldIds: string[]
    contactDefId: string
    scope: SQL
  }
): Promise<ContactRow[]> {
  const valueArms = sql.join(
    input.phonePatterns.map((pattern) => sql`fv."valueText" ILIKE ${`%${pattern}%`}`),
    sql` OR `
  )
  const result = await db.execute(sql`
    SELECT ei."id",
           ei."displayName",
           fv."valueText" AS identifier,
           0::float8 AS score
    FROM ${schema.FieldValue} fv
    JOIN ${schema.EntityInstance} ei ON ei."id" = fv."entityId"
    WHERE fv."organizationId" = ${params.organizationId}
      AND fv."fieldId" IN ${inList(input.fieldIds)}
      AND fv."valueText" IS NOT NULL
      AND (${valueArms})
      AND ei."entityDefinitionId" = ${input.contactDefId}
      AND ei."archivedAt" IS NULL
      ${input.scope}
    ORDER BY fv."sortKey" ASC, ei."id" DESC
    LIMIT ${input.limit}
  `)
  return rowsOf<ContactRow>(result)
}
