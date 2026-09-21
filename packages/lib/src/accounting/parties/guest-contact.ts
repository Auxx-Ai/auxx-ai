// packages/lib/src/accounting/parties/guest-contact.ts
//
// The org's one system "Guest customer" contact, minted where accounting is
// provisioned (plans/accounting/tasks/79-guest-receipts-and-unresolved-refunds.md §4.1).
// Every order carries a customer once this exists, so no downstream reader —
// the ingest, the poster, aging, the QuickBooks export — needs a guest case.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { seedSession, UnifiedCrudHandler } from '../../resources/crud'
import { readOrganizationSettings, updateOrganizationSetting } from '../../settings'
import { SystemUserService } from '../../users/system-user-service'

const logger = createScopedLogger('accounting:guest-contact')

export const GUEST_CONTACT_SETTING_KEY = 'accounting.guestContactId' as const

/**
 * 🛑 First/last, never `full_name` alone: QuickBooks builds a customer's display
 * name from first/last, email and company and never reads `full_name`, so a
 * full-name-only guest refuses its own export (`quickbooks/upsert-customer.ts`).
 */
export const GUEST_CONTACT_FIRST_NAME = 'Guest'
export const GUEST_CONTACT_LAST_NAME = 'customer'

/**
 * The acceptance reason the ingest writes when an order has no customer — the
 * rows this mint wakes. Literal rather than imported: `ingest.ts` writes it
 * inline and exports nothing.
 */
const UNRESOLVED_CUSTOMER_REASON = 'Order customer or currency is unresolved or incompatible'

export interface GuestContactResult {
  /** The guest's `EntityInstance` id, or `null` when the org has no `contact` definition. */
  contactInstanceId: string | null
  /** 1 when this pass minted the guest, 0 when it already existed. */
  created: 0 | 1
  /** Acceptances re-queued because the guest is now available. */
  requeued: number
}

/**
 * Ensure the organization has its guest customer and that
 * `accounting.guestContactId` names it. Idempotent: pressing the wizard's
 * button twice mints one guest, the way it mints one manual bucket.
 *
 * 🛑 An ARCHIVED guest is un-archived, never re-minted — archive has no hook to
 * refuse it, so re-minting is how an org ends up with two.
 */
export async function ensureGuestContact(
  db: Database,
  organizationId: string
): Promise<GuestContactResult> {
  const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
  if (!contactDefId) return { contactInstanceId: null, created: 0, requeued: 0 }

  // Through `db`, not the cache: a caller that just wrote the key in this same
  // frame would otherwise read the pre-write `orgSettings` map.
  const settings = await readOrganizationSettings(organizationId, [GUEST_CONTACT_SETTING_KEY], db)
  const namedId = settings[GUEST_CONTACT_SETTING_KEY]

  if (namedId) {
    const [existing] = await db
      .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, namedId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .limit(1)

    if (existing) {
      if (existing.archivedAt) {
        await db
          .update(schema.EntityInstance)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.EntityInstance.id, existing.id),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          )
        logger.info('Un-archived the guest customer', {
          organizationId,
          contactInstanceId: namedId,
        })
      }
      return { contactInstanceId: namedId, created: 0, requeued: 0 }
    }
    // The setting names a row that is gone; fall through and mint a fresh one.
  }

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
    session: seedSession('guest contact'),
  })
  // ⚠️ No email and no phone, deliberately: nothing for duplicate detection or
  // the QuickBooks email rung to match a real customer on.
  const result = await handler.create(contactDefId, {
    first_name: GUEST_CONTACT_FIRST_NAME,
    last_name: GUEST_CONTACT_LAST_NAME,
  })
  const contactInstanceId = result.instance.id

  await updateOrganizationSetting({
    organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
    value: contactInstanceId,
    db,
  })
  // No explicit bust: the write skips it only for a caller-supplied transaction
  // (`settings-service.ts`), and every caller here hands over the pool.

  const requeued = await requeueUnresolvedCustomerAcceptances(db, organizationId)

  logger.info('Minted the guest customer', { organizationId, contactInstanceId, requeued })
  return { contactInstanceId, created: 1, requeued }
}

/**
 * Wake every acceptance that blocked on a missing customer. Without this they
 * have nothing to wake them — the order never changed, the org acquired a guest.
 */
async function requeueUnresolvedCustomerAcceptances(
  db: Database,
  organizationId: string
): Promise<number> {
  const now = new Date()
  const rows = await db
    .update(schema.FinancialSourceAcceptance)
    .set({ nextAttemptAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceAcceptance.state, 'blocked'),
        eq(schema.FinancialSourceAcceptance.reason, UNRESOLVED_CUSTOMER_REASON)
      )
    )
    .returning({ id: schema.FinancialSourceAcceptance.id })
  return rows.length
}
