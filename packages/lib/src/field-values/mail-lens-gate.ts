// packages/lib/src/field-values/mail-lens-gate.ts

import { ModelTypeMeta } from '@auxx/database/enums'
import {
  type FieldReference,
  isFieldPath,
  isResourceFieldId,
  parseResourceFieldId,
} from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { findCachedResource, getCachedUserInstanceGrants } from '../cache'
import { satisfiesRung } from '../permissions/capabilities/rung'
import type { Lens } from '../permissions/visibility/lens'
import { getThreadLensBatch } from '../permissions/visibility/thread-lens'
import { parseRecordId } from '../resources/resource-id'
import type { FieldValueContext } from './field-value-helpers'
import type { TypedFieldValueResult } from './types'

/**
 * **The mail lens gate for the generic field-value read path.**
 *
 * `thread` and `message` are `NON_RECORD_DEF_SLUGS`, so `canViewEntity` /
 * `hasDefPresence` — the only enforcement `batchGetValues` had — pass them
 * through **unconditionally** for every org member
 * (`permissions/capabilities/capability-set.ts` → `isMailInfraDef`). Everything
 * downstream then reads mail off the raw table: `resolveSystemTableFields`
 * scopes by org id alone, so `thread:subject` came straight off `Thread.subject`,
 * and `thread:body` (a virtual field) returns the LATEST MESSAGE BODY.
 *
 * That gap is already recorded, in the refusal that guards the sibling list path
 * (`resources/crud/unified-handler-queries.ts` → `assertNotMailLensTable`):
 * *"a row predicate alone would not close it: this path's consumers hydrate a
 * thread's SUBJECT through `FieldValueService`, which applies no lens"*. This
 * module is that missing lens.
 *
 * **It reuses mail's own mechanism, it does not invent a second one**:
 * {@link getThreadLensBatch} for the lenses (one batched read for the whole
 * call — the same helper `assertCanActOnThreads` uses on the write side), and
 * the tier classification transposed from
 * `permissions/visibility/redact.ts` onto the resource-field keyspace.
 *
 * Enforcement is keyed on `ctx.capabilities`, exactly like the def filter it
 * sits beside: present ⇒ a request path with a resolved viewer ⇒ gate; absent ⇒
 * internal/system caller (workers, seeds, workflow runs, placeholder resolution)
 * ⇒ unchanged.
 */

/** `Resource.id` of the two mail tables this gate governs. */
const THREAD_DEF = 'thread'
const MESSAGE_DEF = 'message'

/** What a record id in the batch is, for gating purposes. */
type MailHostKind = typeof THREAD_DEF | typeof MESSAGE_DEF | null

/**
 * Every RecordId definition-part form that addresses a mail table, resolved
 * without I/O.
 *
 * `thread` and `message` are system resources, so `Resource.id ===
 * entityType === the slug` and there is no per-org `EntityDefinition` row to
 * look up — the only other accepted form is the apiSlug, taken from
 * `ModelTypeMeta` rather than spelled out so a rename cannot silently open the
 * gate. The apiSlug form matters: `threads:<id>` misses `isSystemResourceId`
 * (so it never reaches the system-table resolver) but still reads the
 * `FieldValue`-backed thread fields — `tags`, and the `visit*` visitor
 * telemetry.
 *
 * **`message` hosts are REFUSED rather than lensed.** `Message` carries no lens
 * of its own (a message's lens is its thread's — `messages/message-query.service.ts`
 * resolves it through `getThreadLensBatch`), and no request path passes a
 * `message:` anchor here: the mail UI reads messages through `mail-query/`, and
 * the only `toRecordId('message', …)` in the codebase is a workflow-engine node
 * variable, which never threads capabilities. Deriving a lens through a
 * `Message → Thread` join would therefore be an untested code path serving no
 * caller, so this follows the refusal the sibling list path already chose
 * (`resources/crud/unified-handler-queries.ts` → `assertNotMailLensTable`) —
 * withheld rather than thrown, since `batchGetValues` renders mixed batches.
 * Without it `message:textPlain` / `message:textHtml` — raw email bodies — read
 * org-wide off the same unlensed resolver.
 */
const MAIL_DEF_KEYS: ReadonlyMap<string, MailHostKind> = new Map<string, MailHostKind>([
  [THREAD_DEF, THREAD_DEF],
  [ModelTypeMeta[THREAD_DEF].apiSlug, THREAD_DEF],
  [MESSAGE_DEF, MESSAGE_DEF],
  [ModelTypeMeta[MESSAGE_DEF].apiSlug, MESSAGE_DEF],
])

/**
 * Thread resource-field keys readable at `metadata` — mail's
 * `THREAD_METADATA_FIELDS` allowlist (`permissions/visibility/redact.ts`)
 * transposed onto the resource-field keyspace, where the names differ
 * (`assignee`/`assigneeId`, `inbox`/`inboxId`, `ticket`/`primaryEntity`).
 *
 * `closedAt` / `createdAt` are not `ThreadMeta` keys at all; they are listed
 * because they are the same kind of fact as `firstMessageAt` / `lastMessageAt`,
 * which mail does classify as metadata. `from` / `to` are the participant
 * identifiers, and `participants` / `participantCount` are metadata there.
 */
const THREAD_METADATA_FIELD_KEYS: ReadonlySet<string> = new Set([
  'id',
  'externalId',
  'status',
  'messageCount',
  'firstMessageAt',
  'lastMessageAt',
  'closedAt',
  'createdAt',
  'assignee',
  'inbox',
  'ticket',
  'tags',
  'from',
  'to',
  'hasAttachments',
  'hasDraft',
  'sent',
])

/**
 * Thread field keys that expose MESSAGE CONTENT or read state — `read` only,
 * matching `READ_TIER_THREAD_FIELDS` + `MESSAGE_CONTENT_FIELDS`.
 *
 * `body` is the one that bites: it is a virtual field whose resolver joins
 * `Thread.latestMessageId → Message.textPlain`, i.e. the full body of the most
 * recent email, served today to anyone who can name the thread id.
 */
const THREAD_READ_FIELD_KEYS: ReadonlySet<string> = new Set(['body', 'freeText', 'readStatus'])

/**
 * The lens a thread field requires. **Unlisted keys default to `identity`, not
 * `read`** — deliberately: a viewer at `identity` or `read` must see exactly
 * what they see today (`subject`, and the visitor-telemetry `visit*` fields the
 * thread drawer renders), while an unclassified new field stays hidden from
 * `metadata` viewers rather than leaking by default. `subject` lands here.
 */
export function threadFieldMinLens(fieldKey: string): Lens {
  if (THREAD_READ_FIELD_KEYS.has(fieldKey)) return 'read'
  if (THREAD_METADATA_FIELD_KEYS.has(fieldKey)) return 'metadata'
  return 'identity'
}

/** The gate for one `batchGetValues` call. `null` when nothing mail is in play. */
export interface MailLensGate {
  /**
   * The anchors that survive ROW visibility — threads the viewer holds at least
   * `metadata` on, plus every non-mail record untouched. Feed this to the
   * resolvers instead of the caller's list.
   */
  visibleRecordIds: RecordId[]
  /**
   * Drop the resolved values a viewer's per-thread lens does not admit
   * (FIELD visibility). Non-mail results pass through by identity.
   */
  filterValues(values: TypedFieldValueResult[]): TypedFieldValueResult[]
}

/**
 * Build the gate for a batch, or `null` when it does not apply (no capabilities
 * threaded, or no mail host among the anchors) so the common record path pays
 * nothing — the applicability test is a static map lookup, no I/O at all.
 *
 * Query budget when it DOES apply: one cached `userInstanceGrants` read plus the
 * one `Thread` row query inside {@link getThreadLensBatch} (plus a single
 * `ThreadParticipant` query only for viewers holding contact grants). **Never
 * per row** — a per-value lens lookup in a batch read path is the regression
 * this shape exists to avoid.
 */
export async function resolveMailLensGate(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldReferences: FieldReference[]
): Promise<MailLensGate | null> {
  // Same trigger as the def filter beside it: no capabilities ⇒ internal caller.
  if (!ctx.capabilities) return null

  const hostKind = (recordId: RecordId): MailHostKind =>
    MAIL_DEF_KEYS.get(parseRecordId(recordId).entityDefinitionId) ?? null

  if (!recordIds.some((recordId) => hostKind(recordId) !== null)) return null

  const threadIds: string[] = []
  for (const recordId of recordIds) {
    if (hostKind(recordId) === THREAD_DEF) threadIds.push(parseRecordId(recordId).entityInstanceId)
  }

  // Fail closed on a capability-scoped call with no viewer to evaluate: the
  // request paths that thread capabilities always carry a user id, so this can
  // only be reached by a caller that half-configured enforcement.
  const lenses = ctx.userId
    ? await getThreadLensBatch(
        ctx.db,
        ctx.organizationId,
        await getCachedUserInstanceGrants(ctx.userId, ctx.organizationId),
        threadIds
      )
    : new Map<string, Lens>()

  /** Missing id ⇒ not in this org ⇒ invisible, the `getThreadLensBatch` contract. */
  const lensOf = (recordId: RecordId): Lens =>
    lenses.get(parseRecordId(recordId).entityInstanceId) ?? 'none'

  const minLensByRef = await buildRefMinLens(ctx, fieldReferences)

  const admits = (result: TypedFieldValueResult): boolean => {
    const kind = hostKind(result.recordId)
    if (kind === null) return true
    if (kind === MESSAGE_DEF) return false // refused outright — see MAIL_DEF_KEYS' note below
    const need = minLensByRef.get(refKey(result.fieldRef)) ?? 'identity'
    return satisfiesRung(lensOf(result.recordId), need)
  }

  return {
    visibleRecordIds: recordIds.filter((recordId) => {
      const kind = hostKind(recordId)
      if (kind === null) return true
      if (kind === MESSAGE_DEF) return false
      // `metadata` is where a thread becomes visible at all; below it the row is
      // dropped rather than blanked, so nothing about it — not even its
      // existence — reaches the resolvers.
      return satisfiesRung(lensOf(recordId), 'metadata')
    }),
    filterValues: (values) => values.filter(admits),
  }
}

/**
 * The gate for a SINGLE-host read — `getValue` / `getValues`. `null` when it does
 * not apply, on exactly the same two triggers as {@link resolveMailLensGate}.
 */
export interface MailHostGate {
  /**
   * The host is withheld in full: a `message` (refused outright — see
   * {@link MAIL_DEF_KEYS}), or a thread the viewer holds below `metadata`.
   * Return the caller's empty answer without issuing the read, so nothing about
   * the row — not even its existence — is observable.
   */
  hidden: boolean
  /**
   * Whether the viewer's lens on this host admits the field. **Synchronous**:
   * the whole `fieldId | fieldKey → Lens` map is built once when the gate is,
   * so `getValues` can filter a result set of unknown size without a lookup per
   * field. Accepts either the stored row id or the static key, because
   * `getValue`/`getValues` are keyed on `FieldValue.fieldId` while the
   * classification is keyed on the resource field's `key`.
   */
  admitsField(fieldId: string): boolean
}

/** The one shared "withheld" answer — no per-call allocation, no I/O. */
const WITHHELD_HOST: MailHostGate = { hidden: true, admitsField: () => false }

/**
 * {@link resolveMailLensGate}'s single-entity sibling, for the two reads that
 * take one `recordId` instead of a list.
 *
 * `getValue` / `getValues` read `FieldValue` rows only — they never reach
 * `resolveSystemTableFields` or the virtual-field resolvers, so what they expose
 * on a thread today is the `FieldValue`-backed slice (`tags`, the `visit*`
 * visitor telemetry) rather than `subject` or `body`. They are gated anyway, and
 * with the *same* classification: they are not router-exposed today, and the
 * next router that exposes them must not have to rediscover that
 * `hasDefPresence` authorizes nothing for `thread`. The two functions share the
 * `FieldValue.fieldId` keyspace with the batch path, so a divergent answer here
 * would be a second mechanism to keep in sync.
 *
 * **Cost.** Nothing when it does not apply: the applicability test is one
 * `Map.get` on the parsed def part, no I/O, so every non-mail caller
 * (`UnifiedCrudHandler.getFieldValues`, `captureEventData`, the dispatch and
 * money readers, the geocoding stale-write guard, and `field-value-mutations`'
 * own re-reads) is byte-identical. When it DOES apply: one cached
 * `userInstanceGrants` read, one single-id {@link getThreadLensBatch} `Thread`
 * query, and one cache-only `findCachedResource` — **per call**, since a
 * single-entity read has nothing to amortise across. That is accepted rather
 * than cached: no caller reaches this on a thread host today (thread and message
 * are blocked from the generic record path), so there is no N+1 to solve, and a
 * cache here would be a guess.
 */
export async function resolveMailHostGate(
  ctx: FieldValueContext,
  recordId: RecordId
): Promise<MailHostGate | null> {
  // Same trigger as the batch gate: no capabilities ⇒ internal caller.
  if (!ctx.capabilities) return null

  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const kind = MAIL_DEF_KEYS.get(entityDefinitionId) ?? null
  if (kind === null) return null
  if (kind === MESSAGE_DEF) return WITHHELD_HOST

  // Fail closed on a capability-scoped call with no viewer, exactly as the batch
  // gate does — a caller that half-configured enforcement gets nothing.
  const lens: Lens = ctx.userId
    ? ((
        await getThreadLensBatch(
          ctx.db,
          ctx.organizationId,
          await getCachedUserInstanceGrants(ctx.userId, ctx.organizationId),
          [entityInstanceId]
        )
      ).get(entityInstanceId) ?? 'none')
    : 'none'

  // `metadata` is where a thread becomes visible at all; below it the whole host
  // is withheld rather than blanked field by field.
  if (!satisfiesRung(lens, 'metadata')) return WITHHELD_HOST

  const resource = await findCachedResource(ctx.organizationId, entityDefinitionId)
  const minLensByFieldKey = new Map<string, Lens>()
  for (const field of resource?.fields ?? []) {
    const need = threadFieldMinLens(field.key)
    minLensByFieldKey.set(field.id, need)
    minLensByFieldKey.set(field.key, need)
  }

  return {
    hidden: false,
    // An unresolvable field id is unclassified, and unclassified means
    // `identity` — the same default {@link threadFieldMinLens} applies, so a
    // field added tomorrow hides from `metadata` viewers instead of leaking.
    admitsField: (fieldId) => satisfiesRung(lens, minLensByFieldKey.get(fieldId) ?? 'identity'),
  }
}

/**
 * The minimum lens each requested reference needs, keyed by {@link refKey}.
 *
 * A PATH is keyed on its first hop: that hop is the only segment that reads
 * thread data (every later hop is already gated by the `canViewEntity` test in
 * `batchGetValues`, and its rows belong to another def entirely).
 */
async function buildRefMinLens(
  ctx: FieldValueContext,
  fieldReferences: FieldReference[]
): Promise<Map<string, Lens>> {
  const minLens = new Map<string, Lens>()

  for (const ref of fieldReferences) {
    const first = isFieldPath(ref) ? ref[0] : ref
    // A bare `FieldId` carries no definition part, so it can never address a
    // thread field — and `parseResourceFieldId` would invent one.
    if (!isResourceFieldId(first)) continue

    const { entityDefinitionId, fieldId } = parseResourceFieldId(first)
    if (MAIL_DEF_KEYS.get(entityDefinitionId) !== THREAD_DEF) continue

    // The requested field id may be the static key or the stored row id; the
    // cached resource is what maps one to the other, and it is the same
    // (cache-only) lookup `categorizeFields` performs a moment later.
    const resource = await findCachedResource(ctx.organizationId, entityDefinitionId)
    const fieldKey = resource?.fields.find((f) => f.id === fieldId || f.key === fieldId)?.key
    // An unresolvable field is about to fail `validateFieldReferences`; treat it
    // as unclassified rather than as metadata.
    minLens.set(refKey(ref), fieldKey ? threadFieldMinLens(fieldKey) : 'identity')
  }

  return minLens
}

/**
 * Stable key for a {@link FieldReference}. Results echo the reference the caller
 * requested, so a path and its first hop must not collide — the array form is
 * joined rather than reduced to `ref[0]`.
 */
function refKey(ref: FieldReference): string {
  return isFieldPath(ref) ? ref.join(' ') : ref
}
