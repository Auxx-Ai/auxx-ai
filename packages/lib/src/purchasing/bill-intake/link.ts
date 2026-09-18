// packages/lib/src/purchasing/bill-intake/link.ts

/**
 * The one writer for "this bill line is against that order line"
 * (plans/money/tasks/58 §6.5). The intake create (§4.4) and the link card
 * (§6.5) both go through {@link linkBillLineToOrderLine}, so a manual bill
 * linked from the card is coded exactly the way a read bill is.
 *
 * 🛑 `resolveRoles` fails closed and names five distinct problems
 * (`postings/resolve-roles.ts`), which is right for a POSTING. Linking a bill
 * line is not one — the line is still correct with no GRNI account, and the
 * page can say the coding is a settings problem. {@link resolveGrniAccountId}
 * is the deliberately soft wrapper: log and return `null`, never throw.
 *
 * No permission checks. The router asserts and calls in.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { resolveRoles } from '../../accounting/ledger/roles/resolve-roles'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { guard } from './guard'

const logger = createScopedLogger('purchasing:bill-intake:link')

/**
 * The `gl_account` this org has mapped to the `grni` role, or `null`.
 *
 * Never throws: a linked line with no GRNI account is still a correctly
 * linked line (§4.5, §6.5) — the coding gap is a settings problem the page
 * names, not a reason to refuse the link.
 */
export async function resolveGrniAccountId(
  db: Database,
  organizationId: string
): Promise<string | null> {
  try {
    const resolved = await resolveRoles(db, organizationId, ['grni'])
    if (resolved.isErr()) {
      logger.warn('Could not resolve the grni account role for a bill line link', {
        organizationId,
        error: resolved.error.message,
      })
      return null
    }
    return resolved.value.get('grni')?.glAccountId ?? null
  } catch (error) {
    logger.error('Unexpected failure resolving the grni account role', { organizationId, error })
    return null
  }
}

/** One line, linked to one order line. */
export interface LinkBillLineInput {
  lineRecordId: RecordId
  orderLineRecordId: RecordId
}

/**
 * Write the one link, in one `update` call: `purchaseOrderLine`, `part` when
 * given, `glAccount` when given. Callers (the intake create and
 * {@link linkBillLines}) are responsible for verifying the line and the order
 * line actually belong together — this function trusts what it is handed.
 */
export async function linkBillLineToOrderLine(
  db: Database,
  organizationId: string,
  userId: string,
  input: LinkBillLineInput & { grniAccountId: string | null; partRecordId: RecordId | null }
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const handler = new UnifiedCrudHandler(organizationId, userId, db)
      const values: Record<string, unknown> = {
        vendor_bill_line_purchase_order_line: input.orderLineRecordId,
      }
      if (input.partRecordId) values.vendor_bill_line_part = input.partRecordId
      if (input.grniAccountId) values.vendor_bill_line_gl_account = input.grniAccountId

      await handler.update(input.lineRecordId, values)
    },
    'Failed to link a bill line to an order line',
    { organizationId, lineRecordId: input.lineRecordId, orderLineRecordId: input.orderLineRecordId }
  )
}

/** One relationship field's `relatedEntityId`, per entity instance among `entityIds`. */
async function relatedEntityMap(
  db: Database,
  organizationId: string,
  fieldId: string,
  entityIds: readonly string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (entityIds.length === 0) return map

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, [...entityIds])
      )
    )

  for (const row of rows) map.set(row.entityId, row.relatedEntityId)
  return map
}

/** What one call to {@link linkBillLines} is asked to do. */
export interface LinkBillLinesInput {
  billRecordId: RecordId
  links: LinkBillLineInput[]
}

/**
 * Link every named bill line to its order line, verifying ownership first.
 *
 * 🛑 Every `lineRecordId` must belong to `billRecordId`
 * (`vendor_bill_line_vendor_bill`), and every `orderLineRecordId` must belong
 * to the bill's own purchase order (`purchase_order_line_purchase_order`
 * against the bill's `vendor_bill_purchase_order`) — checked for the WHOLE
 * batch before anything is written, and refused naming every offender, the
 * same "the list, not a treasure hunt" rule `resolve-roles.ts` follows. A line
 * from another bill or an order line from another order would otherwise let
 * one bad row in a batch quietly cross-link two unrelated records.
 *
 * `grni` is resolved ONCE for the whole batch, never per line.
 */
export async function linkBillLines(
  db: Database,
  organizationId: string,
  userId: string,
  input: LinkBillLinesInput
): Promise<Result<{ linked: number }, Error>> {
  return guard(
    async () => {
      if (input.links.length === 0) return { linked: 0 }

      const { entityInstanceId: billInstanceId } = parseRecordId(input.billRecordId)

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'vendor_bill_purchase_order',
          'vendor_bill_line_vendor_bill',
          'purchase_order_line_purchase_order',
          'purchase_order_line_part',
        ] as const)

      const billOrderField = fields.vendor_bill_purchase_order
      const lineBillField = fields.vendor_bill_line_vendor_bill
      const orderLineOrderField = fields.purchase_order_line_purchase_order
      const orderLinePartField = fields.purchase_order_line_part
      if (!billOrderField || !lineBillField || !orderLineOrderField) {
        throw new UnprocessableEntityError(
          'The purchasing fields required to link a bill line are not seeded for this organization'
        )
      }

      const billOrderMap = await relatedEntityMap(db, organizationId, billOrderField.id, [
        billInstanceId,
      ])
      const billOrderInstanceId = billOrderMap.get(billInstanceId) ?? null
      if (!billOrderInstanceId) {
        throw new UnprocessableEntityError(
          'This bill has no purchase order — there is nothing for its lines to link against'
        )
      }

      const lineInstanceIds = input.links.map(
        (link) => parseRecordId(link.lineRecordId).entityInstanceId
      )
      const orderLineInstanceIds = input.links.map(
        (link) => parseRecordId(link.orderLineRecordId).entityInstanceId
      )

      const [lineBillMap, orderLineOrderMap, orderLinePartMap] = await Promise.all([
        relatedEntityMap(db, organizationId, lineBillField.id, lineInstanceIds),
        relatedEntityMap(db, organizationId, orderLineOrderField.id, orderLineInstanceIds),
        orderLinePartField
          ? relatedEntityMap(db, organizationId, orderLinePartField.id, orderLineInstanceIds)
          : Promise.resolve(new Map<string, string | null>()),
      ])

      const problems: string[] = []
      input.links.forEach((link, index) => {
        if (lineBillMap.get(lineInstanceIds[index] ?? '') !== billInstanceId) {
          problems.push(`Line ${link.lineRecordId} does not belong to bill ${input.billRecordId}`)
        }
        if (orderLineOrderMap.get(orderLineInstanceIds[index] ?? '') !== billOrderInstanceId) {
          problems.push(
            `Order line ${link.orderLineRecordId} does not belong to this bill's purchase order`
          )
        }
      })
      if (problems.length > 0) {
        throw new UnprocessableEntityError(
          `Cannot link: ${problems.length} link(s) name a line outside the bill or its order. ${problems.join(' ')}`
        )
      }

      const partDefId = orderLinePartField
        ? await getCachedEntityDefId(organizationId, 'part')
        : null
      const grniAccountId = await resolveGrniAccountId(db, organizationId)

      for (const [index, link] of input.links.entries()) {
        const orderLineInstanceId = orderLineInstanceIds[index] ?? ''
        const partInstanceId = orderLinePartMap.get(orderLineInstanceId) ?? null
        const partRecordId =
          partInstanceId && partDefId ? toRecordId(partDefId, partInstanceId) : null

        const linked = await linkBillLineToOrderLine(db, organizationId, userId, {
          lineRecordId: link.lineRecordId,
          orderLineRecordId: link.orderLineRecordId,
          grniAccountId,
          partRecordId,
        })
        if (linked.isErr()) throw linked.error
      }

      return { linked: input.links.length }
    },
    'Failed to link bill lines to order lines',
    { organizationId, billRecordId: input.billRecordId }
  )
}
