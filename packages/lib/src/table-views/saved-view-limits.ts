// packages/lib/src/table-views/saved-view-limits.ts

import { type Database, schema } from '@auxx/database'
import { and, count, eq, ne } from 'drizzle-orm'

/**
 * The single counter behind the `savedViews` plan limit.
 *
 * A "saved view" for billing purposes is a **shared** view a **member** created —
 * across both `TableView` (records) and `MailView` (mail). Two exclusions matter:
 *
 * 1. **System-seeded views don't count.** `entity-seeder/create-default-views.ts`,
 *    `create-field-views.ts` and the `ensureDefaultTableViews`/`ensureFieldViews`
 *    entity-migration helpers all write their rows as the org's system user
 *    (`Organization.systemUserId`). A fresh org lands with ~34 shared `TableView`
 *    rows before anyone touches anything — counting those put every new org
 *    instantly over the Demo/Free limit of 10 and made the create gate
 *    permanently closed.
 * 2. **Personal views don't count.** Only `isShared` views consume the limit;
 *    that's what the create gates have always enforced.
 *
 * Exported so the create gates (`tableView.create`, `mailView.create`) and
 * `OverageDetectionService` read one number — three independent counters for one
 * billing invariant is exactly how they drifted apart (the overage detector
 * counted `isDefault = false` on both tables, the table gate counted every
 * `isShared` row including seeds, the mail gate counted `MailView` alone).
 */
export async function countSavedViewsUsed(db: Database, organizationId: string): Promise<number> {
  const [org] = await db
    .select({ systemUserId: schema.Organization.systemUserId })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, organizationId))
    .limit(1)

  const systemUserId = org?.systemUserId

  const [tableResult] = await db
    .select({ value: count() })
    .from(schema.TableView)
    .where(
      and(
        eq(schema.TableView.organizationId, organizationId),
        eq(schema.TableView.isShared, true),
        ...(systemUserId ? [ne(schema.TableView.userId, systemUserId)] : [])
      )
    )

  const [mailResult] = await db
    .select({ value: count() })
    .from(schema.MailView)
    .where(
      and(
        eq(schema.MailView.organizationId, organizationId),
        eq(schema.MailView.isShared, true),
        ...(systemUserId ? [ne(schema.MailView.userId, systemUserId)] : [])
      )
    )

  return (tableResult?.value ?? 0) + (mailResult?.value ?? 0)
}
