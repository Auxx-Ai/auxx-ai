// packages/lib/src/data-migrations/migrations/183-entity-def-palette.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { ensureGuestContact } from '../../accounting/parties'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { seedSession, UnifiedCrudHandler } from '../../resources/crud'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import { SystemUserService } from '../../users/system-user-service'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:183')

/** `Resource` carries `icon`/`color`, so a stale entry renders the old palette for a day. */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 183: restamp every system `EntityDefinition`'s icon and colour from
 * {@link SYSTEM_ENTITIES} (`plans/icons/entity-def-palette.md` §3), and mint the
 * guest customer for every org that already provisioned a chart, backfilling
 * `order_contact` on every order that names neither a contact nor a company
 * (`plans/accounting/tasks/79-guest-receipts-and-unresolved-refunds.md` §4.1).
 *
 * ## Unconditional, by decision (§4)
 *
 * A system def's appearance is ours: the appearance editor is rendered
 * `disabled={!!resource.entityType}`, so no customer can have set these. There is nothing
 * to preserve and no `from` table to compare against — which is why this reads
 * `SYSTEM_ENTITIES` directly and therefore cannot drift from the registry.
 *
 * Idempotent: the equality skip means a second run writes nothing. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 183-entity-def-palette`.
 */
export const migration183EntityDefPalette: PerOrgMigration = {
  id: '183-entity-def-palette',
  description:
    'Restamps system EntityDefinition icon/color from SYSTEM_ENTITIES - colour becomes the ' +
    'accounting axis (sell green, buy red, goods teal, cash blue, ledger gray). Also mints ' +
    'the guest customer for every org holding a gl_account row and backfills order_contact ' +
    'on every order with neither a contact nor a company (task 79 §4.1)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const rows = await db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
        icon: schema.EntityDefinition.icon,
        color: schema.EntityDefinition.color,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const byType = new Map(rows.filter((r) => r.entityType != null).map((r) => [r.entityType, r]))

    const now = new Date()
    let restamped = 0

    for (const entity of SYSTEM_ENTITIES) {
      const def = byType.get(entity.entityType)
      // Absent means the org predates the def; seeding it is the seeder's job, not this one's.
      if (!def) continue
      if (def.icon === entity.icon && def.color === entity.color) continue

      await db
        .update(schema.EntityDefinition)
        .set({ icon: entity.icon, color: entity.color, updatedAt: now })
        .where(
          and(
            eq(schema.EntityDefinition.id, def.id),
            eq(schema.EntityDefinition.organizationId, organizationId)
          )
        )
      restamped++
    }

    if (restamped > 0) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 183 applied', { organizationId, restamped })
    }

    const guest = await backfillGuestCustomer(db, organizationId)

    return {
      ...state,
      alreadyUpToDate: restamped === 0 && guest.created === 0 && guest.backfilled === 0,
    }
  },
}

/**
 * Mint the org's guest customer and give it to every order that has neither a
 * contact nor a company. Skipped whole for an org with no chart — provisioning
 * is the door that means "we want accounting", and this covers what exists at
 * this deploy while `provisionChart` covers every org after it.
 *
 * Idempotent: a second pass finds the guest through the setting and every order
 * already carrying it.
 */
async function backfillGuestCustomer(
  db: Database,
  organizationId: string
): Promise<{ created: 0 | 1; backfilled: number }> {
  const nothing = { created: 0, backfilled: 0 } as const

  // A `gl_account` ROW, not the definition — the definition ships with every org
  // and provisioning is what says the org wants accounting.
  const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
  if (!glAccountDefId) return nothing
  const [chart] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, glAccountDefId)
      )
    )
    .limit(1)
  if (!chart) return nothing

  const guest = await ensureGuestContact(db, organizationId)
  if (!guest.contactInstanceId) return nothing

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
    session: seedSession('guest order contact backfill'),
  })
  const guestRecordId = toRecordId('contact', guest.contactInstanceId)
  // 🛑 The memo pass runs whatever the order pass finds: orders backfilled on an
  // earlier run leave nothing missing here, and the memos still need their contact.
  const finish = async (backfilled: number) => {
    const memos = await backfillCreditMemoContacts(db, organizationId, handler, guestRecordId)
    if (backfilled > 0 || memos > 0 || guest.created > 0)
      logger.info('Migration 183 backfilled guest orders', {
        organizationId,
        guestCreated: guest.created,
        backfilled,
        memosBackfilled: memos,
        requeued: guest.requeued,
      })
    return { created: guest.created, backfilled: backfilled + memos }
  }

  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  if (!orderDefId) return finish(0)

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['order_contact', 'order_company'] as const)
  const partyFieldIds = [fields.order_contact?.id, fields.order_company?.id].filter(
    (id): id is string => !!id
  )
  if (partyFieldIds.length === 0) return finish(0)

  const orders = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, orderDefId)
      )
    )
  if (orders.length === 0) return finish(0)

  const withParty = await db
    .selectDistinct({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, partyFieldIds),
        isNotNull(schema.FieldValue.relatedEntityId)
      )
    )
  const covered = new Set(withParty.map((row) => row.entityId))
  const missing = orders.filter((order) => !covered.has(order.id))
  if (missing.length === 0) return finish(0)

  // Sequential: a fan-out over a five-figure order table is the one thing a
  // migration pass must not do to the pool.
  let backfilled = 0
  for (const order of missing) {
    await handler.update(toRecordId(orderDefId, order.id), { order_contact: guestRecordId })
    backfilled++
  }

  return finish(backfilled)
}

/**
 * Give every contactless `credit_memo` its order's contact — the guest, after the
 * pass above. The Shopify connector clears `credit_memo_contact` on a guest
 * checkout (`shopify.connector.ts:814-819`), which leaves the refund ingest's
 * customer leg unsatisfiable.
 */
async function backfillCreditMemoContacts(
  db: Database,
  organizationId: string,
  handler: UnifiedCrudHandler,
  guestRecordId: string
): Promise<number> {
  const memoDefId = await getCachedEntityDefId(organizationId, 'credit_memo')
  if (!memoDefId) return 0

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['credit_memo_contact', 'credit_memo_order', 'order_contact'] as const)
  const contactFieldId = fields.credit_memo_contact?.id
  const orderFieldId = fields.credit_memo_order?.id
  const orderContactFieldId = fields.order_contact?.id
  if (!contactFieldId) return 0

  const memos = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, memoDefId)
      )
    )
  if (memos.length === 0) return 0

  const withContact = await db
    .selectDistinct({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, contactFieldId),
        isNotNull(schema.FieldValue.relatedEntityId)
      )
    )
  const covered = new Set(withContact.map((row) => row.entityId))
  const missing = memos.filter((memo) => !covered.has(memo.id))
  if (missing.length === 0) return 0

  // memo -> its order, and order -> its contact, in two reads rather than 2N.
  const memoOrders = orderFieldId
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          related: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, orderFieldId),
            isNotNull(schema.FieldValue.relatedEntityId)
          )
        )
    : []
  const orderOf = new Map(memoOrders.map((row) => [row.entityId, row.related as string]))
  const orderContacts = orderContactFieldId
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          related: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, orderContactFieldId),
            isNotNull(schema.FieldValue.relatedEntityId)
          )
        )
    : []
  const contactOf = new Map(orderContacts.map((row) => [row.entityId, row.related as string]))

  let written = 0
  for (const memo of missing) {
    const inherited = contactOf.get(orderOf.get(memo.id) ?? '')
    await handler.update(toRecordId(memoDefId, memo.id), {
      credit_memo_contact: inherited ? toRecordId('contact', inherited) : guestRecordId,
    })
    written++
  }
  return written
}
