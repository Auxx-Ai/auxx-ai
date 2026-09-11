// packages/lib/src/postings/gl-account-pointers.ts

/**
 * Every registry field that holds a `gl_account` EntityInstance id **as TEXT**,
 * and the read that finds what is pointing at one account.
 *
 * ## Why this file has to exist
 *
 * Task 15 decided these pointers are plain `text()` with no `references()` -
 * the shape `GlRoleAssignment.glAccountId` and `GlPostingLine.glAccountId`
 * already use, so a posted line outlives the chart row it was posted against
 * and a renumber restates nothing (`bank-account-fields.ts`, DECIDED
 * 2026-09-09). That decision is sound and this file does not reopen it.
 *
 * 🛑 What the decision costs is that **the id lives in `FieldValue.valueText`,
 * not in `FieldValue.relatedEntityId`** - so every guard written against the
 * relationship column is blind to all of them. Two such guards existed and both
 * were blind:
 *
 *  - `scripts/reset-gl-chart.ts` refuses to wipe a chart anything points at,
 *    and queried `relatedEntityId` only. It wiped a referenced chart on
 *    2026-09-11, reported success, and left `payment_gateway.clearingAccount`
 *    naming an id that existed nowhere. The next fulfillment post refused.
 *  - `chart-write.ts`'s `assertNoLiveRole` refuses to remove or deactivate an
 *    account a ROLE points at, and reads `GlRoleAssignment` only. Nothing
 *    stopped a person removing an account a payment gateway or a bank account
 *    named.
 *
 * Both now go through {@link findGlAccountPointers}, so a pointer added to the
 * registry is protected by adding one row to {@link GL_ACCOUNT_POINTER_ATTRIBUTES}
 * rather than by remembering two call sites.
 *
 * ⚠️ **This is not a substitute for the read-time check.** Nothing here makes a
 * dangling id impossible - a direct SQL delete still produces one, and
 * `resolveAccountLines` still has to fail closed on it. This closes the doors
 * auxx itself owns.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * The `systemAttribute` of every TEXT field holding a `gl_account` id, with the
 * human name of what carries it.
 *
 * 🛑 **Add a row here when the registry gains a pointer.** The coverage test in
 * `__tests__/gl-account-pointers.test.ts` walks the registry for TEXT fields
 * whose attribute ends in `_gl_account`, plus the two `payment_gateway` account
 * fields (named for their ROLE on the gateway rather than for what they point
 * at), and fails when one is missing - so this cannot silently fall behind.
 *
 * Deliberately NOT here:
 *
 * - `gl_account_code` / `gl_account_name` / `gl_account_type` - attributes OF an
 *   account, not pointers AT one.
 * - `*_bank_account` (`bank_deposit_bank_account`, `bank_rule_bank_account`,
 *   `bank_rule_counterpart_bank_account`, `bank_transaction_bank_account`) -
 *   these name a `bank_account` instance, not a `gl_account`. A bank account's
 *   own `bank_account_gl_account` is the pointer, and it IS here.
 */
export const GL_ACCOUNT_POINTER_ATTRIBUTES: Readonly<Record<string, string>> = {
  bank_account_gl_account: 'a bank account',
  bank_rule_gl_account: 'a bank rule',
  bank_transaction_gl_account: 'a bank transaction',
  bank_transaction_suggested_gl_account: 'a bank transaction suggestion',
  payment_gateway_clearing_account: 'a payment gateway (clearing account)',
  payment_gateway_fee_account: 'a payment gateway (fee account)',
  stock_movement_gl_account: 'a stock movement',
  vendor_bill_line_gl_account: 'a vendor bill line',
}

/** One thing found pointing at an account. */
export interface GlAccountPointer {
  /** The `systemAttribute` that holds the id. */
  attribute: string
  /** What carries it, in words - {@link GL_ACCOUNT_POINTER_ATTRIBUTES}'s value. */
  label: string
  /** The `EntityInstance` doing the pointing. */
  entityId: string
  /** Which account of `accountIds` it names. */
  glAccountId: string
}

/**
 * Everything in this org pointing at any of `accountIds`, through a TEXT field.
 *
 * One query, whatever the number of accounts: the pointer fields are found by
 * `systemAttribute` across every definition the org has, then matched against
 * the ids in the same statement. Never per-account, because the chart wipe asks
 * about a hundred accounts at once.
 *
 * ⚠️ **Archived pointers count.** An archived `bank_transaction` still holds
 * the id, and un-archiving it after the account went would resurrect exactly
 * the dangling state this exists to prevent. A caller that genuinely wants live
 * rows only must filter the result itself.
 *
 * @param limit caps the rows returned - a refusal needs a few examples and a
 *   count, never every row. Pass a larger number to enumerate.
 */
export async function findGlAccountPointers(
  db: Database,
  organizationId: string,
  accountIds: readonly string[],
  limit = 5
): Promise<GlAccountPointer[]> {
  if (accountIds.length === 0) return []

  const attributes = Object.keys(GL_ACCOUNT_POINTER_ATTRIBUTES)

  const rows = await db
    .select({
      attribute: schema.CustomField.systemAttribute,
      entityId: schema.FieldValue.entityId,
      glAccountId: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, attributes),
        inArray(schema.FieldValue.valueText, [...accountIds])
      )
    )
    .limit(limit)

  return rows.flatMap((row) => {
    // Both columns are nullable in the schema and neither can be null here -
    // the `inArray`s filtered on them. Narrowed rather than asserted.
    if (!row.attribute || !row.glAccountId) return []
    return [
      {
        attribute: row.attribute,
        label: GL_ACCOUNT_POINTER_ATTRIBUTES[row.attribute] ?? row.attribute,
        entityId: row.entityId,
        glAccountId: row.glAccountId,
      },
    ]
  })
}

/**
 * The refusal sentence for a set of pointers, or null when there are none.
 *
 * Names WHAT points here rather than only that something does: "a payment
 * gateway (clearing account)" sends somebody to a screen, "this account is in
 * use" sends them to the logs.
 */
export function describeGlAccountPointers(pointers: readonly GlAccountPointer[]): string | null {
  if (pointers.length === 0) return null
  const labels = [...new Set(pointers.map((pointer) => pointer.label))]
  return labels.length === 1
    ? (labels[0] ?? null)
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}
