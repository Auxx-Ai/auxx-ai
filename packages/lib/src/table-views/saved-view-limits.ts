// packages/lib/src/table-views/saved-view-limits.ts

import { type Database, schema } from '@auxx/database'
import { and, count, eq, ne, notInArray } from 'drizzle-orm'
import { STRUCTURAL_CONTEXT_TYPES } from './structural-contexts'

/**
 * The single counter behind the `savedViews` plan limit.
 *
 * A "saved view" for billing purposes is a **shared** view a **member** created —
 * across both `TableView` (records) and `MailView` (mail). Three exclusions matter:
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
 * 3. **Panel/dialog field configs don't count.** A `panel`/`dialog_create`/
 *    `dialog_edit` row is the DEFINITION's field layout, not a saved view: one per
 *    def per context, written by a def admin through its own gate
 *    (`isStructural` → `assertStructuralAccess`), never named or picked from a list.
 *    They are created `isShared: true` under the acting admin's id
 *    (`use-field-view-draft.ts`), so neither exclusion above catches them — which
 *    meant customizing the Details panel on four definitions could exhaust a
 *    Demo/Free limit of 10 and then block real saved views with an error about
 *    "saved views". See {@link STRUCTURAL_CONTEXT_TYPES}.
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
        notInArray(schema.TableView.contextType, [...STRUCTURAL_CONTEXT_TYPES]),
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
