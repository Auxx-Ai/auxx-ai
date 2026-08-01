// apps/web/src/server/api/routers/record.ts

import { getCachedResource, getCachedResources } from '@auxx/lib/cache'
import { conditionGroupSchema } from '@auxx/lib/conditions'
import { BadRequestError, ForbiddenError } from '@auxx/lib/errors'
import { getDescendantIds } from '@auxx/lib/field-values'
import { getRecordIdentityViews } from '@auxx/lib/identity'
import {
  type CapabilitySet,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from '@auxx/lib/permissions'
import {
  type CreateEntityResult,
  type LookupCandidate,
  RESOURCE_TABLE_REGISTRY,
  UnifiedCrudHandler,
} from '@auxx/lib/resources'
import { type FieldId, parseResourceFieldId, resourceFieldIdSchema } from '@auxx/types/field'
import {
  ENTITY_DEFINITION_TYPES,
  parseRecordId,
  type RecordId,
  recordIdSchema,
  toRecordId,
} from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, isAuxxError, protectedProcedure } from '../trpc'

/** Extract socket ID from tRPC context headers for realtime self-event exclusion. */
function getSocketId(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

/**
 * Postgres FK constraint blocking an invoice's instance delete while ledger rows still
 * reference it (`PaymentTransaction.invoiceInstanceId` is the only RESTRICT FK in the schema).
 */
const INVOICE_PAYMENT_FK_CONSTRAINT = 'PaymentTransaction_invoiceInstanceId_EntityInstance_id_fk'

/**
 * Defense-in-depth mapping for `record.delete`/`bulkDelete`: the invoice pre-delete hook
 * (plans/dispatch/money/12-delete-safety.md §A) purges non-succeeded ledger rows and rejects
 * succeeded/disputed ones before the instance delete runs, so this FK should be unreachable in
 * practice. If it's ever hit anyway (a future RESTRICT FK the hook doesn't know about yet, or a
 * race), rethrow as a friendly `BadRequestError` instead of the raw Postgres violation.
 *
 * Walks the error's `.cause` chain (the CRUD handler wraps DB errors — see `unwrapResult` in
 * `packages/lib/src/resources/crud/unified-handler-mutations.ts`) looking for Postgres error
 * code `23503` on this specific constraint. Any other error — including other FK violations —
 * is left untouched.
 */
function rethrowIfInvoicePaymentFkViolation(error: unknown): void {
  let current: unknown = error
  while (current && typeof current === 'object') {
    const code = (current as { code?: unknown }).code
    const constraint = (current as { constraint?: unknown }).constraint
    const message = (current as { message?: unknown }).message
    const matchesConstraint =
      constraint === INVOICE_PAYMENT_FK_CONSTRAINT ||
      (typeof message === 'string' && message.includes(INVOICE_PAYMENT_FK_CONSTRAINT))
    if (code === '23503' && matchesConstraint) {
      throw new BadRequestError('Remove recorded payments before deleting this invoice')
    }
    current = (current as { cause?: unknown }).cause
  }
}

/**
 * The §3 closure: the generic record path REFUSES instance-access defs.
 *
 * Signatures are `EntityInstance` rows on the `signature` def, so before plan 36
 * they were read and mutated straight through `record.*` — whose only asserts
 * are three `recordsDelete` calls and whose def-level gate returned `true`
 * unconditionally for `signature` via `isMailInfraDef`. Minting
 * `signature.ts` alone would therefore have closed nothing: a member could still
 * enumerate, read, mutate and delete every signature in the org here. So this
 * path stops resolving them at all, and `signature.ts` becomes the only door.
 *
 * **Audit of what else this touches (re-verified 2026-07-29).** `dataset`, `kb`,
 * `dashboard`, `workflow` and `snippet` are first-class tables served by their
 * own routers and have no entry in `seed/entity-seeder/constants.ts` at all;
 * `article` IS a seeded def but is not an instance-access key (it inherits its
 * KB's grants, and its data lives in the `Article` table). The
 * `EntityDefinition`-backed keys are `signature` — the subject this guard was
 * built for — and, since plan 40 phase 1, the two MAIL keys, which are the
 * reason this function now has two arms.
 *
 * **THE MAIL EXEMPTION (plan 40 §8.1 / 40a §8.1, decision (a)).** `inbox` and
 * `personal_inbox` joined `INSTANCE_ACCESS_RESOURCES` in phase 1, and a blanket
 * refusal would have broken the mail sidebar, the inbox pickers and the thread
 * inbox column in the phase that is supposed to be INERT. So:
 *
 *  - {@link assertNotInstanceAccessDefForWrite} — every MUTATION on this router.
 *    Unchanged behaviour: the mail keys are refused here like every other one.
 *    That also satisfies 40a §8.4 for free — the generic create path must not
 *    accept `personal_inbox`, because personal inboxes are created ONLY through
 *    provisioning.
 *  - {@link assertNotInstanceAccessDefForRead} — every QUERY. The mail keys pass.
 *
 * **Why the read exemption is safe, and why it is not the leak it looks like:**
 * the records capability layer was never the access authority for an inbox.
 * Mail visibility is — `userInstanceGrants` (the per-inbox lens floor, composed
 * from `ResourceAccess` rows — the `role:org_member` baseline plus the
 * `Area.inboxes` fallback) and the mail-grant index —
 * and `UnifiedCrudHandler`'s def-level `canViewEntity('inbox')` short-circuits
 * to `true` via `isMailInfraDef` regardless of what this guard does. Refusing
 * the read arm would therefore have closed nothing that was open; it would only
 * have broken the readers. Contrast `signature`, which this guard genuinely
 * closes: `signature.ts` IS its only door, and it left `NON_RECORD_DEF_SLUGS`
 * precisely so no def-level pass-through survives.
 *
 * The mutation arm keeps its teeth for the same reason it has them elsewhere:
 * inbox WRITES answer to `channels.manage` + `assertAdminInstance` in
 * `inbox.ts`, and a second door into `EntityInstance` updates would route around
 * both.
 *
 * `ForbiddenError` rather than `BadRequestError` because it fails closed and
 * reads correctly to anything probing for data. It denies OWNER too — that is
 * intended: "one access authority per resource" is a routing invariant, not a
 * permission the caller can hold.
 */
async function assertNotInstanceAccessDef(
  organizationId: string,
  identifiers: Array<string | null | undefined>,
  exempt: ReadonlySet<InstanceAccessKey>
): Promise<void> {
  const candidates = identifiers.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (candidates.length === 0) return

  // The bare slug form ('signature') short-circuits without touching the cache;
  // everything else has to be resolved, because the client may just as well send
  // the def UUID or the apiSlug.
  const unresolved: string[] = []
  for (const candidate of candidates) {
    if (isInstanceAccessKey(candidate)) {
      if (!exempt.has(candidate)) throw instanceAccessDefError(candidate)
      continue
    }
    unresolved.push(candidate)
  }

  const resources = await getCachedResources(organizationId)
  for (const candidate of unresolved) {
    const resource = resources.find(
      (r) => r.id === candidate || r.entityDefinitionId === candidate || r.apiSlug === candidate
    )
    const entityType = resource?.entityType
    if (entityType && isInstanceAccessKey(entityType) && !exempt.has(entityType)) {
      throw instanceAccessDefError(entityType)
    }
  }
}

/**
 * The mail keys, exempted on the READ arm only — see
 * {@link assertNotInstanceAccessDef}. Explicit rather than derived from
 * `baselineAtCreate` or an area: this is a ROUTING carve-out for two named defs,
 * and a derived form would silently widen the moment another resource happened
 * to share the shape.
 */
const MAIL_READ_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>([
  'inbox',
  'personal_inbox',
])

const NO_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>()

/** Refuse EVERY instance-access def — the mutation arm. */
function assertNotInstanceAccessDefForWrite(
  organizationId: string,
  identifiers: Array<string | null | undefined>
): Promise<void> {
  return assertNotInstanceAccessDef(organizationId, identifiers, NO_EXEMPT_KEYS)
}

/** Refuse every instance-access def EXCEPT the mail keys — the query arm. */
function assertNotInstanceAccessDefForRead(
  organizationId: string,
  identifiers: Array<string | null | undefined>
): Promise<void> {
  return assertNotInstanceAccessDef(organizationId, identifiers, MAIL_READ_EXEMPT_KEYS)
}

function instanceAccessDefError(key: string): ForbiddenError {
  return new ForbiddenError(
    `"${key}" is not reachable through the generic record path — use its own router.`
  )
}

/**
 * The keys {@link getByIds} admits — the HYDRATION carve-out, and deliberately
 * wider than {@link MAIL_READ_EXEMPT_KEYS}.
 *
 * `kb` and `dataset` are instance-access resources that live in their own
 * tables, and `RecordPickerService` both resolves them from those tables and
 * gates them per row through `canViewInstance` (`admitSystemRows`) — the same
 * authority `kb.list` filters on. So for a hydration read they have exactly one
 * access authority, which is what the blanket refusal was protecting.
 *
 * They are NOT added to the general read arm: the paginated list/search paths
 * run through `getResources` / `querySystemResourceIdsPaged`, which have no
 * instance-access filter. Admitting them there would leak the org's whole KB
 * list. `signature`, `snippet`, `dashboard`, `workflow` and `agent` stay refused
 * everywhere — they are not statically pickable, so there is no system-table
 * path to gate in the first place.
 */
const HYDRATION_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>([
  ...MAIL_READ_EXEMPT_KEYS,
  'kb',
  'dataset',
])

/**
 * {@link assertNotInstanceAccessDefForRead} as a FILTER rather than an assert —
 * `getByIds` drops unroutable ids instead of failing the call.
 *
 * A hydration batch is not one caller's request: the client's record-store
 * batcher collects ids from every component that mounted in the same tick and
 * sends them as one query. Throwing for a single unroutable def therefore takes
 * every unrelated record down with it — which is exactly what a `kb:` id in the
 * batch did to the articles and contacts beside it. `RecordPickerService`
 * already answers "an id you cannot reach" by omitting it, and the client models
 * the gap (`missingIds` → `setNotFound`), so omission is the consistent answer
 * here too.
 *
 * The TARGETED procedures keep the throw: a caller that named one record is owed
 * a real error, not a silent empty.
 */
async function filterHydratableRecordIds(
  organizationId: string,
  recordIds: RecordId[]
): Promise<RecordId[]> {
  const kept: RecordId[] = []
  // Resolved lazily and once — a batch of plain record defs never touches it.
  let resources: Awaited<ReturnType<typeof getCachedResources>> | undefined

  for (const recordId of recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)

    // The bare slug form ('kb', 'signature') decides without the cache.
    if (isInstanceAccessKey(entityDefinitionId)) {
      if (HYDRATION_EXEMPT_KEYS.has(entityDefinitionId)) kept.push(recordId)
      continue
    }

    // A def UUID or apiSlug still has to resolve — the client sends both forms.
    resources ??= await getCachedResources(organizationId)
    const entityType = resources.find(
      (r) =>
        r.id === entityDefinitionId ||
        r.entityDefinitionId === entityDefinitionId ||
        r.apiSlug === entityDefinitionId
    )?.entityType
    if (entityType && isInstanceAccessKey(entityType) && !HYDRATION_EXEMPT_KEYS.has(entityType)) {
      continue
    }
    kept.push(recordId)
  }

  return kept
}

/** The def part of each RecordId, for {@link assertNotInstanceAccessDef}. */
function recordIdDefParts(recordIds: string[]): string[] {
  return recordIds.map((id) => parseRecordId(id as RecordId).entityDefinitionId)
}

/**
 * The def-aware delete gate for a whole RecordId batch — asserted once per
 * DISTINCT definition, in memory, no extra I/O (same shape as
 * `fieldValue.setBulk`'s edit gate).
 *
 * Replaces the bare `assert(recordsDelete)` these three mutations used to carry.
 * That coarse verb is still honoured — it is the first branch of
 * `canDeleteEntity` — but a def the member holds an explicit `admin` grant on now
 * passes without it, which is what makes delete authority grantable per
 * definition instead of only org-wide.
 */
function assertCanDeleteDefs(capabilities: CapabilitySet, recordIds: string[]): void {
  for (const defId of new Set(recordIdDefParts(recordIds))) {
    capabilities.assertDeleteEntity(defId)
  }
}

/**
 * **The PER-ROW delete gate** (plan v3/03 §5.3) — the honest replacement for
 * {@link assertCanDeleteDefs} on the three batch mutations.
 *
 * The def-batch form above asks one question per DISTINCT definition. Once rows
 * of the same def can be reachable by two different routes — "mine because I can
 * see the whole def" and "mine because this row was shared with me" — that
 * question has no single right answer for the batch: a member who cannot delete
 * the def at all may hold `admin` on one row of it, and a member who CAN delete
 * the def is judged by the def gate on a row they only hold `read` on.
 *
 * So this reads the `_access` stamp per row instead. The stamp is
 * `max(effectiveRecordLevel(def), max rung across my grant rows)`, resolved in
 * the SAME query that fetches the rows (`getByIds` → `recordAccessRankSql`), and
 * the gate applied to it is the SHIPPED delete rule — `canDeleteRecordAt`, i.e.
 * the `edit` floor plus (`records.delete` OR rung ≥ `admin`). No new verb
 * vocabulary is introduced.
 *
 * **A row that comes back without a stamp, or does not come back at all, DENIES.**
 * A missing row means the read path's own scope excluded it, which is the
 * strongest possible signal; treating it as "no opinion" would let exactly the
 * ids the read path hid through the write path.
 *
 * Fails the batch WHOLE, like the def gate it replaces — a partial delete whose
 * failures are per-row strings is not something a user can reason about.
 */
async function assertCanDeleteRows(
  handler: UnifiedCrudHandler,
  capabilities: CapabilitySet,
  recordIds: RecordId[]
): Promise<void> {
  // The coarse def gate still runs first: it is the cheap, in-memory answer for
  // the overwhelmingly common all-def-visible batch, and it also keeps the
  // `NON_RECORD_DEF_SLUGS` / mail-infra branch of `canDeleteEntity` reachable.
  // Rows it denies get a second chance below, per row, through their stamp.
  const denied: RecordId[] = []
  for (const recordId of recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)
    if (!capabilities.canDeleteEntity(entityDefinitionId)) denied.push(recordId)
  }
  if (denied.length === 0) return

  const stamped = await handler.getByIds(denied)
  for (const recordId of denied) {
    const access = stamped[recordId]?._access
    if (!access || !capabilities.canDeleteRecordAt(access)) {
      throw new ForbiddenError("You don't have permission to delete these records.")
    }
  }
}

/**
 * **The PER-ROW read gate** — the view twin of {@link assertCanDeleteRows}, for a
 * point read that does NOT flow through `UnifiedCrudHandler.getById` (which
 * applies the visibility scope in SQL for free). Today's only caller is
 * {@link recordRouter.getIdentities}.
 *
 * Same two-step shape, same reasons: the def gate runs first and short-circuits
 * in memory (the common all-def-viewable read pays no extra I/O and the
 * `NON_RECORD_DEF_SLUGS` / mail-infra branch of `canViewEntity` stays
 * reachable), and only a def-DENIED id is read back.
 *
 * Unlike the delete gate there is NO second judgement on the returned stamp, and
 * that is deliberate: `getByIds` is already scoped at the `read` floor
 * (`recordVisibilityScope` / `RECORD_READ_FLOOR`) and drops unauthorized ids
 * silently, so **a row coming back IS the read verdict**. Re-deriving that floor
 * from the stamp here would put the same rule in two places, which is exactly
 * how the two halves drift apart. A row that does not come back DENIES.
 */
async function assertCanViewRows(
  handler: UnifiedCrudHandler,
  capabilities: CapabilitySet,
  recordIds: RecordId[]
): Promise<void> {
  const denied = recordIds.filter(
    (recordId) => !capabilities.canViewEntity(parseRecordId(recordId).entityDefinitionId)
  )
  if (denied.length === 0) return

  const visible = await handler.getByIds(denied)
  for (const recordId of denied) {
    if (!visible[recordId]) {
      throw new ForbiddenError("You don't have permission to view this record.")
    }
  }
}

/**
 * Validate entity definition ID - accepts system TableId, new system entity type, or custom entity UUID
 */
const entityDefinitionIdSchema = z.string().refine(
  (val: string) => {
    // System table IDs (thread, user, inbox, etc.)
    if (RESOURCE_TABLE_REGISTRY.some((r: { id: string }) => r.id === val)) return true
    // New system entity types (tag, contact, ticket, etc.) - resolved to UUIDs downstream
    if (ENTITY_DEFINITION_TYPES.includes(val as any)) return true
    // Custom entity IDs - UUID format (cuid2 minimum length)
    if (val.length >= 20) return true
    return false
  },
  {
    message:
      'Invalid resource ID. Must be system TableId, system entity type, or EntityDefinitionId (UUID).',
  }
)

/**
 * Schema for global search endpoint
 */
const globalSearchInputSchema = z.object({
  /** Optional - if provided, searches specific resource (system or custom entity) */
  entityDefinitionId: entityDefinitionIdSchema.optional(),
  /** Optional - resolve by apiSlug instead of entityDefinitionId */
  apiSlug: z.string().optional(),
  /** Optional search query - if empty, returns first N records */
  query: z.string().max(500).optional().default(''),
  /** Max results per page */
  limit: z.number().min(1).max(100).default(25),
  /** Cursor for pagination */
  cursor: z.string().optional(),
  /** Optional - filter to specific entity definitions (only used in global search mode) */
  entityDefinitionIds: z.array(z.string()).optional(),
})

/**
 * Input for getById using RecordId
 */
const getByIdInputSchema = z.object({
  recordId: recordIdSchema,
})

/**
 * Input for legacy getById using separate params
 */
const getByIdLegacyInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  id: z.string(),
})

/**
 * Input for create mutation
 */
const createInputSchema = z.object({
  entityDefinitionId: z.string(),
  values: z.record(z.string(), z.any()).optional(),
})

/**
 * Input for createMany mutation. Capped at 50 — the caller is an interactive
 * bulk add (e.g. a catalog-group explode), not an import pipeline.
 */
const createManyInputSchema = z.object({
  entityDefinitionId: z.string(),
  records: z.array(z.record(z.string(), z.any())).min(1).max(50),
})

/**
 * Input for `record.lookupByField`.
 *
 * Priority-ordered equality lookup. A candidate references its field either by
 * `systemAttribute` (system fields) or by `fieldId` (custom fields, whose
 * `systemAttribute` is null — e.g. connector-provisioned fields). Data Connectors
 * are the custom-field caller this `fieldId` variant was always meant for.
 *
 * `limit` caps distinct recordIds across ALL candidates combined (not
 * per-candidate). Default 1 ("exists or not" — the 90% case). Cap at 25
 * so callers can't turn this into a listing endpoint through the side
 * door — beyond 25 the UX should be "search in Auxx".
 */
const lookupValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
])
const lookupByFieldInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  candidates: z
    .array(
      z.union([
        z.object({ systemAttribute: z.string().min(1), value: lookupValueSchema }),
        z.object({ fieldId: z.string().min(1), value: lookupValueSchema }),
      ])
    )
    .min(1)
    .max(5),
  limit: z.number().int().min(1).max(25).default(1),
})

/**
 * Input for update mutation.
 *
 * `values` stays `Record<fieldId, unknown>` — all existing callers keep
 * working byte-for-byte. The optional parallel `modes` map lets a single
 * call mix modes across fields (e.g. replace status, add a tag, remove an
 * externalId in one round-trip). Any field not listed in `modes` defaults
 * to `'set'` — today's behavior. Note: `'set'` on `record.update` is
 * per-field replace, not whole-record replace — fields absent from
 * `values` are left alone.
 */
const updateInputSchema = z.object({
  recordId: recordIdSchema,
  values: z.record(z.string(), z.any()),
  modes: z.record(z.string(), z.enum(['set', 'add', 'remove'])).optional(),
})

/**
 * Record router - handles individual record operations (instances of resources)
 * Unified CRUD operations for both system entities (contact, ticket) and custom entities.
 */
export const recordRouter = createTRPCRouter({
  // ─────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get single record by RecordId
   */
  getById: capabilityProcedure
    .input(getByIdInputSchema.or(getByIdLegacyInputSchema))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      // Handle both RecordId and legacy separate params
      const recordId: RecordId =
        'recordId' in input ? input.recordId : toRecordId(input.entityDefinitionId, input.id)
      // §3 — outside the try: the catch below flattens everything to a 500.
      await assertNotInstanceAccessDefForRead(organizationId, recordIdDefParts([recordId]))

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })

        const result = await handler.getById(recordId)
        if (!result) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Record not found: ${recordId}`,
          })
        }

        return result
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch record: ${error.message}`,
        })
      }
    }),

  /**
   * External identities linked to a record — the "External identities" card
   * data source (RecordIdentity index, decorated from org cache). One batch
   * query, no N+1. Values themselves still render as normal FieldValues in the
   * field grid; this surfaces the cross-system/cross-store link set.
   *
   * 🔴 **This shipped as a `protectedProcedure` with NO view authority.**
   * `assertNotInstanceAccessDefForRead` is a ROUTING guard — it refuses defs
   * that belong to another router — and it was the only thing standing here, so
   * any member of the org could read the identity index of any row of any def:
   * defs they hold `none` on, rows they hold no grant on. It returned
   * `externalId`, the app field key/label, the app name and the connection
   * label — the linked customer's id in every connected store.
   *
   * It is now `capabilityProcedure` + {@link assertCanViewRows}, which is the
   * same authority every other point read on this router gets for free through
   * `UnifiedCrudHandler` (this one reads no record at all — hence the explicit
   * gate). A def-viewable row costs zero extra I/O; only a def-denied row is
   * read back through the scoped `getByIds`, where absent ⇒ 403.
   */
  getIdentities: capabilityProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const recordId = input.recordId as RecordId
      await assertNotInstanceAccessDefForRead(organizationId, recordIdDefParts([recordId]))
      // Both guards sit OUTSIDE the try — the catch below flattens everything to
      // a 500, and a denial must surface as a 403 (§3).
      await assertCanViewRows(
        new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        }),
        ctx.capabilities,
        [recordId]
      )
      try {
        return await getRecordIdentityViews(organizationId, recordId)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch record identities: ${message}`,
        })
      }
    }),

  /**
   * Get multiple records by IDs (batch)
   * Used for hydrating relationship field values
   *
   * Unroutable defs are FILTERED, not refused — see
   * {@link filterHydratableRecordIds} for why a shared batch must not fail whole.
   */
  getByIds: capabilityProcedure
    .input(
      z.object({
        items: z.array(recordIdSchema).max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const items = await filterHydratableRecordIds(organizationId, input.items as RecordId[])
      if (items.length === 0) return {}

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.getByIds(items)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch records by IDs: ${message}`,
        })
      }
    }),

  /**
   * Search records with optional global search support
   */
  search: capabilityProcedure.input(globalSearchInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    const { apiSlug, entityDefinitionId, query, limit, cursor, entityDefinitionIds } = input
    await assertNotInstanceAccessDefForRead(organizationId, [
      apiSlug,
      entityDefinitionId,
      ...(entityDefinitionIds ?? []),
    ])

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })

      // Handler handles all resolution internally (apiSlug -> entityDefinitionId, system names -> UUIDs)
      const result = await handler.search({
        query: query || '',
        apiSlug,
        entityDefinitionId,
        entityDefinitionIds,
        limit,
        cursor,
      })

      // §3, the UNSCOPED arm. A scoped search is refused above, but the global
      // union takes no def scope at all: it merges every EntityInstance in the
      // org and post-filters on `canViewEntity(defId)` — which, now that
      // `signature` has left `NON_RECORD_DEF_SLUGS`, resolves through the RECORDS
      // area and so returns `true` for any member with a records rung. That would
      // leak signature names into cmd+K. Drop them here instead. Post-filtering a
      // page is acceptable only because the union is unpaginated (`cursor` is
      // ignored in that mode) and the excluded defs are settings-only, so this
      // can neither short a page nor desync a cursor.
      //
      // This filter is DERIVED from `isInstanceAccessKey`, so plan 40 phase 1
      // would have silently dropped inboxes out of cmd+K the moment `inbox`
      // joined the registry — a behavior change in the phase that must be inert.
      // It takes the same `MAIL_READ_EXEMPT_KEYS` carve-out as the read-arm
      // assert above, and for the same reason: inboxes are searchable today,
      // this router is not their access authority, and `userInstanceGrants` is.
      if (!entityDefinitionId && !apiSlug && !entityDefinitionIds?.length) {
        const blocked = new Set(
          (await getCachedResources(organizationId))
            .filter(
              (r) =>
                r.entityType &&
                isInstanceAccessKey(r.entityType) &&
                !MAIL_READ_EXEMPT_KEYS.has(r.entityType)
            )
            .map((r) => r.entityDefinitionId)
        )
        if (blocked.size > 0) {
          return {
            ...result,
            items: result.items.filter(
              (item: { recordId: string }) =>
                !blocked.has(parseRecordId(item.recordId as RecordId).entityDefinitionId)
            ),
          }
        }
      }
      return result
    } catch (error: any) {
      if (isAuxxError(error)) throw error
      if (error instanceof TRPCError) throw error
      if (error.message?.includes('not found')) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error.message,
        })
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Search failed: ${error.message}`,
      })
    }
  }),

  /**
   * Typed equality lookup by `(systemAttribute, value)` — the primitive
   * the extension uses for capture-side dedup and "already in Auxx"
   * button state. Column-aware (routes to the right FieldValue typed
   * column) and value-normalizing (EMAIL lowercased, URL protocol added,
   * PHONE_INTL to E.164 — matches write-path formatting).
   *
   * Accepts a priority list so the caller can express "externalId, else
   * primary_email" in one round-trip; without that, the extension pays
   * two iframe→API crossings per capture.
   */
  lookupByField: capabilityProcedure
    .input(lookupByFieldInputSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForRead(organizationId, [input.entityDefinitionId])
      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.lookupByField({
          entityDefinitionId: input.entityDefinitionId,
          // `fieldId` arrives as a plain string from zod; the handler brands it.
          candidates: input.candidates as LookupCandidate[],
          limit: input.limit,
        })
      } catch (error: unknown) {
        if (error instanceof BadRequestError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Lookup failed: ${message}`,
        })
      }
    }),

  /**
   * List record IDs with server-side filtering, paged straight from SQL.
   *
   * One call = one page (`LIMIT n + 1 OFFSET m`); `hasMore` is the probe row.
   * `total` comes back on the first page only — the client keeps it.
   *
   * **`droppedConditions` / `droppedConditionCount` ride on the page** whenever a
   * filter could not be compiled into SQL. They are optional and additive: this
   * lane fails open by design (a saved view naming a retired field still
   * renders), so the page is simply *wider* than the caller asked for and no
   * error is raised. A surface that wants to be honest about that renders the
   * notice; a surface that ignores it behaves exactly as before. The AI boundary
   * does the opposite and refuses — see `inspectFilterConditions` in
   * `@auxx/lib/resources`.
   *
   * The payload is the caller's own `conditionId` / `fieldId` / `operator` plus a
   * coarse reason, capped at `MAX_REPORTED_DROPPED_CONDITIONS`. No SQL, no column
   * or table names, no builder internals.
   */
  listFiltered: capabilityProcedure
    .input(
      z.object({
        /** Resource type: 'contact', 'ticket', 'entity_xxx' */
        entityDefinitionId: z.string(),
        /** Filter groups (optional) */
        filters: z.array(conditionGroupSchema).optional(),
        /**
         * Free-text search from the records search bar. A separate axis from
         * `filters` (plan decision 0.3) — conditions narrow, this IS the search.
         * Ranked (`tsvector` + trigram) and, when no `sorting` is given, it also
         * supplies the ordering.
         */
        search: z.string().max(200).optional(),
        /** Sort configuration (optional) */
        sorting: z
          .array(
            z.object({
              id: z.string(),
              desc: z.boolean(),
            })
          )
          .optional(),
        /** Limit per request */
        limit: z.number().min(1).max(500).default(100),
        /** Cursor for infinite query pagination (typed object) */
        cursor: z.object({ offset: z.number() }).optional(),
        /** Pagination offset. `cursor.offset` wins when both are given. */
        offset: z.number().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForRead(organizationId, [input.entityDefinitionId])

      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      return handler.listFiltered({
        entityDefinitionId: input.entityDefinitionId,
        filters: input.filters,
        search: input.search,
        sorting: input.sorting,
        limit: input.limit,
        cursor: input.cursor,
        offset: input.offset,
      })
    }),

  /**
   * List all records with field values (for small datasets like tags, inboxes)
   * Supports resolution of entityDefinitionId ('tag' → UUID) or apiSlug ('tags' → UUID)
   */
  listAll: capabilityProcedure
    .input(
      z.object({
        /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
        entityDefinitionId: z.string().optional(),
        /** API slug like 'tags', 'contacts' */
        apiSlug: z.string().optional(),
        /** Specific field IDs to fetch (all if undefined) - branded FieldId type */
        fieldIds: z.array(z.string() as unknown as z.ZodType<FieldId>).optional(),
        /** Specific field output keys to fetch (ignored when fieldIds is set) */
        fieldKeys: z.array(z.string()).optional(),
        /** Include archived records */
        includeArchived: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForRead(organizationId, [
        input.entityDefinitionId,
        input.apiSlug,
      ])

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.listAll(input)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list records: ${message}`,
        })
      }
    }),

  // ─────────────────────────────────────────────────────────────────
  // MUTATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new entity instance with optional field values
   */
  create: capabilityProcedure.input(createInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    await assertNotInstanceAccessDefForWrite(organizationId, [input.entityDefinitionId])

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      return await handler.create(input.entityDefinitionId, input.values ?? {})
    } catch (error: any) {
      // Let def-level ForbiddenError (403) and other AuxxErrors reach the middleware.
      if (isAuxxError(error)) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create record: ${error.message}`,
      })
    }
  }),

  /**
   * Create multiple entity instances in one round-trip (plans/dispatch/31 §D).
   * Runs the exact single-create pipeline per record, in input order, and
   * returns `{ recordId, instance }` per row in the same order.
   *
   * Deliberately NOT wrapped in a DB transaction: the synchronous field-change
   * hooks (e.g. the money totals recompute, `totals-hooks.ts`) read and write
   * through pool-scoped services, so rows created inside an open transaction
   * would be invisible to their reads and their writes would FK-fail against
   * the uncommitted instances. All-or-nothing is approximated instead: a
   * mid-loop failure deletes the rows already created, then rethrows.
   */
  createMany: capabilityProcedure.input(createManyInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    await assertNotInstanceAccessDefForWrite(organizationId, [input.entityDefinitionId])
    const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
      capabilities: ctx.capabilities,
    })
    const created: Array<Pick<CreateEntityResult, 'recordId' | 'instance'>> = []

    try {
      for (const values of input.records) {
        const result = await handler.create(input.entityDefinitionId, values)
        created.push({ recordId: result.recordId, instance: result.instance })
      }
      return created
    } catch (error: any) {
      // Compensate best-effort — a failed cleanup delete must not mask the
      // original error, so each one is swallowed individually.
      for (const row of [...created].reverse()) {
        try {
          await handler.delete(row.recordId)
        } catch {
          // Leave the orphan; the original error below is what the user sees.
        }
      }
      // A def-level 403 on the very first row leaves `created` empty — surface it.
      if (isAuxxError(error)) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create records: ${error.message}`,
      })
    }
  }),

  /**
   * Update entity instance field values
   */
  update: capabilityProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts([input.recordId]))

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      return await handler.update(input.recordId, input.values, input.modes)
    } catch (error: any) {
      if (isAuxxError(error)) throw error
      if (error.message?.includes('not found')) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error.message,
        })
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to update record: ${error.message}`,
      })
    }
  }),

  /**
   * Archive entity instance (soft delete)
   */
  archive: capabilityProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts([input.recordId]))

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.archive(input.recordId)
      } catch (error: any) {
        if (isAuxxError(error)) throw error
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to archive record: ${error.message}`,
        })
      }
    }),

  /**
   * Restore archived entity instance
   */
  restore: capabilityProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts([input.recordId]))

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.restore(input.recordId)
      } catch (error: any) {
        if (isAuxxError(error)) throw error
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to restore record: ${error.message}`,
        })
      }
    }),

  /**
   * Permanently delete entity instance
   */
  delete: capabilityProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts([input.recordId]))
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      // Layer-2 × Layer-3 write guard (§11.4 / plan v3/03 §5.3): the delete verb,
      // asserted PER ROW against the `_access` stamp.
      await assertCanDeleteRows(handler, ctx.capabilities, [input.recordId])

      try {
        await handler.delete(input.recordId)
        return { success: true }
      } catch (error: any) {
        // Rethrow pre-delete-hook rejections (BadRequestError, ForbiddenError, …) so
        // auxxErrorMiddleware maps them to their proper codes — duck-typed, since
        // `instanceof` fails across the `@auxx/lib` transpile boundary (see trpc.ts).
        if (isAuxxError(error)) throw error
        rethrowIfInvoicePaymentFkViolation(error)
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to delete record: ${error.message}`,
        })
      }
    }),

  /**
   * Bulk archive entity instances
   */
  bulkArchive: capabilityProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts(input.recordIds))

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
          capabilities: ctx.capabilities,
          requestPath: true,
        })
        return await handler.bulkArchive(input.recordIds)
      } catch (error: any) {
        if (isAuxxError(error)) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to bulk archive records: ${error.message}`,
        })
      }
    }),

  /**
   * Bulk delete entity instances
   */
  bulkDelete: capabilityProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(organizationId, recordIdDefParts(input.recordIds))
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      // Layer-2 × Layer-3 write guard (§11.4 / plan v3/03 §5.3): the delete verb,
      // asserted PER ROW against the `_access` stamp. A batch containing one row
      // the member may not delete fails WHOLE rather than partially — same as the
      // edit gate, and the only outcome a user can reason about.
      await assertCanDeleteRows(handler, ctx.capabilities, input.recordIds)

      try {
        // NOTE on friendly messages here: the invoice pre-delete hook's admin-gate /
        // succeeded-charges guard throws `BadRequestError` with an already-friendly message
        // (e.g. "Remove recorded payments before deleting this invoice") — `bulkDeleteEntities`
        // (packages/lib/src/resources/crud/unified-handler-mutations.ts) catches that per-record
        // and stores `error.message` verbatim in `result.errors`, so it reads well here with no
        // extra mapping needed.
        // The raw-FK defense-in-depth mapping (`rethrowIfInvoicePaymentFkViolation`, used in the
        // `delete` mutation above) does NOT apply here: `bulkDeleteEntities` flattens each per-record
        // failure to a plain `{ recordId, message }` string before it ever reaches this router
        // (the original error/cause chain, including the pg error code + constraint, is
        // discarded in the lib loop) — so this router has nothing left to pattern-match on for
        // that edge case in bulk mode. This should be unreachable post-§A anyway (the hook purges
        // non-succeeded ledger rows before the instance delete runs); worth revisiting only if a
        // per-record error surface is added to the lib handler.
        const result = await handler.bulkDelete(input.recordIds)

        if (result.errors.length > 0 && result.count === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to delete ${result.errors.length} record(s): ${result.errors[0]?.message}`,
          })
        }

        return result
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        if (isAuxxError(error)) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to bulk delete records: ${error.message}`,
        })
      }
    }),

  /**
   * Merge multiple entity instances into a target instance
   */
  merge: capabilityProcedure
    .input(
      z.object({
        targetRecordId: recordIdSchema,
        sourceRecordIds: z.array(recordIdSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForWrite(
        organizationId,
        recordIdDefParts([input.targetRecordId, ...input.sourceRecordIds])
      )
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx), {
        capabilities: ctx.capabilities,
        requestPath: true,
      })
      // Layer-2 × Layer-3 write guard (§11.4 / plan v3/03 §5.3): merge permanently
      // REMOVES the source records, so it gates on the delete verb (chosen over
      // recordsEdit — the destructive half is the binding one), asserted PER ROW
      // for the target and every source.
      await assertCanDeleteRows(handler, ctx.capabilities, [
        input.targetRecordId,
        ...input.sourceRecordIds,
      ])

      try {
        return await handler.merge(input.targetRecordId, input.sourceRecordIds)
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        if (isAuxxError(error)) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to merge records: ${error.message}`,
        })
      }
    }),

  /**
   * Invalidate cache (for testing/admin)
   */
  invalidateCache: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: entityDefinitionIdSchema,
        id: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      await assertNotInstanceAccessDefForRead(organizationId, [input.entityDefinitionId])

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        await handler.invalidateCache(input.entityDefinitionId, input.id)
        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to invalidate cache: ${message}`,
        })
      }
    }),

  /**
   * Get all descendant RecordIds for self-referential relationship filtering.
   * Used by UI to exclude invalid options (self + descendants) from picker.
   */
  getDescendantRecordIds: protectedProcedure
    .input(
      z.object({
        recordId: recordIdSchema,
        resourceFieldId: resourceFieldIdSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await assertNotInstanceAccessDefForRead(organizationId, recordIdDefParts([input.recordId]))

      try {
        // Parse composite IDs to get raw values for DB query
        const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId as RecordId)
        const { fieldId } = parseResourceFieldId(input.resourceFieldId)

        // Get field from org cache
        const resource = await getCachedResource(organizationId, entityDefinitionId)
        const field = resource?.fields.find((f) => f.key === fieldId || f.id === fieldId)

        if (!field?.id) return []

        const descendantInstanceIds = await getDescendantIds(
          { db: ctx.db, organizationId },
          entityInstanceId,
          field.id
        )

        // Convert back to RecordIds for client
        return [...descendantInstanceIds].map((instanceId) =>
          toRecordId(entityDefinitionId, instanceId)
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get descendant record IDs: ${message}`,
        })
      }
    }),
})
