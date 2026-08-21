// packages/lib/src/dedup/blocking.ts
//
// Candidate generation — READS ONLY. Writes live in `pairs.ts`.
//
// ZERO permission checks (lib-module-guide §6). Dedup blocking runs as SYSTEM:
// it never passes a `scopeWhere` to the lookup core, because a scan job has no
// viewer. The record-scope predicate is applied later, in SQL, by the READ path
// (`queries.ts`) — a pair whose other side the viewer cannot see is filtered
// there, not here.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import { lookupEntitiesByFieldValue } from '../resources/lookup/lookup-entities-by-field-value'
import { getInstanceId } from '../resources/resource-id'
import { BLOCK_CAP, ROLE_EMAIL_LOCALS } from './config'
import type { MatchKey } from './match-keys'
import type { Signal } from './types'

const logger = createScopedLogger('dedup:blocking')

/**
 * One candidate record, with every piece of evidence that produced it.
 *
 * Signals are oriented **self-first**: `value` is the SCANNED record's value and
 * `otherValue` the candidate's, when they differ. `toCandidatePair` re-orients
 * them onto the canonical low/high axis before storage.
 */
export interface BlockMatch {
  /** `EntityInstance.id` of the other record. */
  instanceId: string
  signals: Signal[]
}

/** One org-wide blocking bucket: a value plus every record holding it. */
export interface BlockGroup {
  value: string
  instanceIds: string[]
  signal: Omit<Signal, 'value'>
}

/** One `RecordIdentity` collision: the same external id under two records. */
export interface IdentityGroup {
  source: string
  /** The id KIND — the column is `appFieldKey`, e.g. `'customerId'`. NULL for bare-source links. */
  appFieldKey: string | null
  externalId: string
  instanceIds: string[]
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Fold a Gmail address onto its canonical delivery form — dots stripped from
 * the local part, `+tag` suffix dropped, `googlemail.com` collapsed onto
 * `gmail.com`.
 *
 * **Compare-time only. This is NEVER written back.** The address the user typed
 * is the address we display and send to; folding it into storage would silently
 * rewrite a contact's own email. It exists so `j.ohn+shop@googlemail.com` and
 * `john@gmail.com` can still block together.
 *
 * Returns `null` when the address is not Gmail or already canonical, so callers
 * can skip the extra lookup entirely.
 */
export function foldGmailAddress(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at <= 0) return null
  const domain = email.slice(at + 1).toLowerCase()
  if (!GMAIL_DOMAINS.has(domain)) return null

  const local = email.slice(0, at).toLowerCase().split('+')[0]?.replaceAll('.', '')
  if (!local) return null

  const folded = `${local}@gmail.com`
  return folded === email.toLowerCase() ? null : folded
}

/**
 * Is this a ROLE address (`info@`, `support@`, shared reception mailboxes)?
 *
 * Two contacts on `info@acme.com` are usually two humans behind one mailbox, so
 * a role-email match alone is not allowed to pair — it needs a second signal.
 */
export function isRoleEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at <= 0) return false
  return ROLE_EMAIL_LOCALS.has(email.slice(0, at).toLowerCase())
}

/** Stable identity for a signal, so the same evidence is never counted twice. */
const signalKey = (s: Signal) => `${s.type}|${s.fieldKey ?? ''}|${s.value}|${s.otherValue ?? ''}`

/** Read one record's own values for the given keys, ordered and bounded. */
async function readOwnValues(
  db: Database,
  organizationId: string,
  instanceId: string,
  keys: MatchKey[]
): Promise<Map<string, Array<string | number>>> {
  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, instanceId),
        inArray(
          schema.FieldValue.fieldId,
          keys.map((k) => k.fieldId as string)
        )
      )
    )
    .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))

  const byField = new Map<string, Array<string | number>>()
  const keyById = new Map(keys.map((k) => [k.fieldId as string, k]))
  for (const row of rows) {
    const key = keyById.get(row.fieldId)
    if (!key) continue
    const raw = key.column === 'valueNumber' ? row.valueNumber : row.valueText
    // Empty values are skipped, always: '' and NULL block against every other
    // blank cell in the org and would pair the whole definition.
    if (raw === null || raw === undefined) continue
    if (typeof raw === 'string' && raw.trim() === '') continue

    const bucket = byField.get(row.fieldId) ?? []
    // `MAX_MULTI_VALUES` bounds the fan-out (single-value keys bound to 1). The
    // write path already enforces the cap; this is the belt to that braces, so a
    // leaked row can never turn one record into an unbounded candidate storm.
    if (bucket.length >= key.maxValues) continue
    bucket.push(raw)
    byField.set(row.fieldId, bucket)
  }
  return byField
}

/** Parameters for {@link blockRecord}. */
export interface BlockRecordParams {
  organizationId: string
  entityDefinitionId: string
  /** `EntityInstance.id` of the record being scanned. */
  instanceId: string
  keys: MatchKey[]
  /** Per-VALUE cap; defaults to {@link BLOCK_CAP}. */
  blockCap?: number
}

/**
 * Find every record that shares a strong exact key value with one record.
 *
 * **Multi-value fan-out is the point.** One lookup runs per VALUE, not per
 * field: a contact with three emails and two phones issues five lookups and can
 * therefore match a record on any alias, primary or not.
 *
 * *Deviation from the plan, deliberate:* the plan describes all values going
 * into ONE call to the lookup core as five `LookupCandidate`s. The core
 * deduplicates hits across candidates by recordId and lets "the earliest-priority
 * candidate win attribution", so a record matching on BOTH an email and a phone
 * would come back attributed to the email alone — losing the second signal — and
 * the per-value {@link BLOCK_CAP} would be unenforceable against a shared global
 * `limit`. One indexed call per value costs a handful of extra round-trips in a
 * background job and keeps both properties exact.
 *
 * Guards, in the order they bite:
 *  - empty / blank values are skipped (see {@link readOwnValues});
 *  - a value returning more than `blockCap` other records is discarded whole —
 *    a shared reception line or a placeholder domain would otherwise pair
 *    O(n²) rows of noise;
 *  - a candidate whose ONLY evidence is a role address (`info@`) is dropped,
 *    because that match needs a second signal it did not get.
 *
 * Runs with `excludeArchived: true` and NO `scopeWhere` — see the file header.
 */
export async function blockRecord(
  db: Database,
  params: BlockRecordParams
): Promise<Result<BlockMatch[], Error>> {
  const { organizationId, entityDefinitionId, instanceId, keys } = params
  if (keys.length === 0) return ok([])

  const cap = params.blockCap ?? BLOCK_CAP
  const ownValues = await readOwnValues(db, organizationId, instanceId, keys)

  /** instanceId → signals, plus whether any non-role evidence exists. */
  const bySignals = new Map<string, Map<string, Signal>>()
  const hasNonRoleEvidence = new Set<string>()

  for (const key of keys) {
    for (const own of ownValues.get(key.fieldId as string) ?? []) {
      const ownText = String(own)
      const roleEmail = key.signalType === 'email' && isRoleEmail(ownText)

      // Gmail folding adds a SECOND lookup rather than rewriting the first, so
      // the stored address is still matched exactly and the folded form only
      // widens the net.
      const folded = key.signalType === 'email' ? foldGmailAddress(ownText) : null
      const lookupValues: Array<string | number> = folded ? [own, folded] : [own]

      for (const lookupValue of lookupValues) {
        const result = await lookupEntitiesByFieldValue(db, {
          organizationId,
          entityDefinitionId,
          candidates: [{ fieldId: key.fieldId, value: lookupValue }],
          // +2 so an over-cap value is DETECTED rather than silently truncated:
          // one slot for the record itself, one to see past the cap.
          limit: cap + 2,
          excludeArchived: true,
          // Blocking WANTS every candidate, several records sharing a value is
          // the entire point of a duplicate scan, not an error condition.
          onAmbiguous: 'first',
        })
        if (result.isErr()) {
          // The core errors only when every candidate was unusable — here that
          // means this one value could not be normalized. Skip the value; a
          // garbage cell must never take down the rest of the record's scan.
          logger.debug('skipping unusable blocking value', {
            entityDefinitionId,
            fieldKey: key.fieldKey,
          })
          continue
        }

        const others = result.value.items
          .map((item) => getInstanceId(item.recordId))
          .filter((id) => id !== instanceId)
        if (others.length > cap) {
          logger.debug('discarding over-cap blocking value', {
            entityDefinitionId,
            fieldKey: key.fieldKey,
            matches: others.length,
          })
          continue
        }

        const matchedText = String(lookupValue)
        const signal: Signal = {
          type: key.signalType,
          strength: 'strong',
          value: ownText,
          ...(matchedText === ownText ? {} : { otherValue: matchedText }),
          fieldKey: key.fieldKey,
          ...(key.systemAttribute ? { systemAttribute: key.systemAttribute } : {}),
        }

        for (const other of others) {
          const bucket = bySignals.get(other) ?? new Map<string, Signal>()
          bucket.set(signalKey(signal), signal)
          bySignals.set(other, bucket)
          if (!roleEmail) hasNonRoleEvidence.add(other)
        }
      }
    }
  }

  const matches: BlockMatch[] = []
  for (const [otherId, signals] of bySignals) {
    // Role-address guard: a match built ONLY out of `info@`-style evidence is
    // one mailbox, not one person. Any other signal rescues it.
    if (!hasNonRoleEvidence.has(otherId)) continue
    matches.push({ instanceId: otherId, signals: [...signals.values()] })
  }
  return ok(matches)
}

/** Parameters for {@link blockOrgKey}. */
export interface BlockOrgKeyParams {
  organizationId: string
  entityDefinitionId: string
  key: MatchKey
  /** Per-VALUE cap; defaults to {@link BLOCK_CAP}. */
  blockCap?: number
}

/**
 * Org-wide sweep for ONE key: every value held by more than one live record.
 *
 * `GROUP BY` the typed value column, served by `FieldValue_lookup_text_idx`
 * (`organizationId, fieldId, valueText`, partial on `valueText IS NOT NULL`).
 * Cheaper than N per-record lookups once the dirty set for a definition is
 * large, and the only way a backfill finds pairs where NEITHER side is dirty.
 *
 * Naturally per-value already: multi-value fields store one row per value, so a
 * non-primary alias groups exactly like a primary one with no fan-out logic.
 *
 * The cap is applied in `HAVING`, so an over-common value never leaves the
 * database. Role addresses are dropped outright here rather than deferred: a
 * group produces exactly one signal per pair, so a role-email group can never
 * acquire the second signal the guard demands.
 */
export async function blockOrgKey(
  db: Database,
  params: BlockOrgKeyParams
): Promise<Result<BlockGroup[], Error>> {
  const { organizationId, entityDefinitionId, key } = params
  const cap = params.blockCap ?? BLOCK_CAP
  const valueColumn =
    key.column === 'valueNumber' ? schema.FieldValue.valueNumber : schema.FieldValue.valueText

  const rows = await db
    .select({
      value: valueColumn,
      instanceIds: sql<string[]>`array_agg(DISTINCT ${schema.FieldValue.entityId})`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityDefinitionId, entityDefinitionId),
        eq(schema.FieldValue.fieldId, key.fieldId as string),
        isNotNull(valueColumn),
        key.column === 'valueText' ? ne(schema.FieldValue.valueText, '') : undefined
      )
    )
    .groupBy(valueColumn)
    .having(
      sql`count(DISTINCT ${schema.FieldValue.entityId}) > 1 AND count(DISTINCT ${schema.FieldValue.entityId}) <= ${cap}`
    )

  const groups: BlockGroup[] = []
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue
    const value = String(row.value)
    if (key.signalType === 'email' && isRoleEmail(value)) continue
    groups.push({
      value,
      instanceIds: row.instanceIds,
      signal: {
        type: key.signalType,
        strength: 'strong',
        fieldKey: key.fieldKey,
        ...(key.systemAttribute ? { systemAttribute: key.systemAttribute } : {}),
      },
    })
  }
  return ok(groups)
}

/** Parameters for {@link blockIdentity}. */
export interface BlockIdentityParams {
  organizationId: string
  entityDefinitionId: string
  /** Per-GROUP cap; defaults to {@link BLOCK_CAP}. */
  blockCap?: number
}

/**
 * Cross-connection identity overlap: one external id, two records.
 *
 * `RecordIdentity_identity_key` COALESCEs `connectionId`, so the SAME customer
 * synced under two connections is legitimately two identity rows and therefore
 * two records — a duplicate the write path is structurally unable to prevent
 * and this is the only pass that finds it.
 *
 * Grouped by `(source, appFieldKey, externalId)`. Note the kind column is
 * **`appFieldKey`** (e.g. `'customerId'`), not `kind`; `connectionId` is
 * deliberately NOT in the grouping, since collapsing across connections is the
 * entire point.
 */
export async function blockIdentity(
  db: Database,
  params: BlockIdentityParams
): Promise<Result<IdentityGroup[], Error>> {
  const { organizationId, entityDefinitionId } = params
  const cap = params.blockCap ?? BLOCK_CAP

  const rows = await db
    .select({
      source: schema.RecordIdentity.source,
      appFieldKey: schema.RecordIdentity.appFieldKey,
      externalId: schema.RecordIdentity.externalId,
      instanceIds: sql<string[]>`array_agg(DISTINCT ${schema.RecordIdentity.entityInstanceId})`,
    })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.entityDefinitionId, entityDefinitionId)
      )
    )
    .groupBy(
      schema.RecordIdentity.source,
      schema.RecordIdentity.appFieldKey,
      schema.RecordIdentity.externalId
    )
    .having(
      sql`count(DISTINCT ${schema.RecordIdentity.entityInstanceId}) > 1 AND count(DISTINCT ${schema.RecordIdentity.entityInstanceId}) <= ${cap}`
    )

  return ok(
    rows.map((row) => ({
      source: row.source,
      appFieldKey: row.appFieldKey,
      externalId: row.externalId,
      instanceIds: row.instanceIds,
    }))
  )
}
