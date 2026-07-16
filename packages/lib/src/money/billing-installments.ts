// packages/lib/src/money/billing-installments.ts

import { type Database, database, schema } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import {
  computeWorkOrderBillingProjection,
  syncWorkOrderBillingProjection,
} from './billing-projection'
import type { BillingInstallmentInput, SaveBillingInstallmentsInput } from './types'

function validateRow(row: BillingInstallmentInput): void {
  if (!row.name.trim()) throw new BadRequestError('Every installment needs a name')
  if (row.trigger === 'date' && !row.scheduledDate) {
    throw new BadRequestError(`Choose a date for '${row.name}'`)
  }
  if (row.calculation === 'percentage') {
    if (
      !Number.isInteger(row.percentageBasisPoints) ||
      row.percentageBasisPoints! <= 0 ||
      row.percentageBasisPoints! > 10_000
    ) {
      throw new BadRequestError(`Enter a valid percentage for '${row.name}'`)
    }
  } else if (!Number.isInteger(row.amount) || row.amount! <= 0) {
    throw new BadRequestError(`Enter a valid fixed amount for '${row.name}'`)
  }
}

function resolveRows(rows: BillingInstallmentInput[], contractValue: number, target: number) {
  const resolved = rows.map((row) => ({
    ...row,
    name: row.name.trim(),
    amount:
      row.calculation === 'percentage'
        ? Math.floor((contractValue * row.percentageBasisPoints!) / 10_000)
        : row.amount!,
  }))
  const total = resolved.reduce((sum, row) => sum + row.amount, 0)
  const remainder = target - total
  if (resolved.length > 0 && Math.abs(remainder) <= resolved.length) {
    resolved[resolved.length - 1]!.amount += remainder
  }
  if (resolved.reduce((sum, row) => sum + row.amount, 0) !== target) {
    throw new BadRequestError('Active installment amounts must equal the remaining contract value')
  }
  if (resolved.some((row) => row.amount <= 0)) {
    throw new BadRequestError('Every installment must resolve to a positive amount')
  }
  return resolved
}

async function heldDepositAmount(db: Database, organizationId: string, workOrderId: string) {
  const rows = await db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.workOrderInstanceId, workOrderId),
      eq(schema.PaymentTransaction.status, 'succeeded')
    ),
    columns: { amount: true, invoiceInstanceId: true, kind: true },
  })
  return rows.reduce(
    (sum, row) =>
      row.invoiceInstanceId === null && row.kind === 'charge' ? sum + row.amount : sum,
    0
  )
}

/** Replace pending installments while preserving drafted and issued schedule history. */
export async function saveBillingInstallments(input: SaveBillingInstallmentsInput): Promise<void> {
  for (const row of input.installments) validateRow(row)

  await database.transaction(
    async (tx) => {
      const db = tx as unknown as Database
      const projection = await computeWorkOrderBillingProjection({ ...input, db })
      if (projection.basis !== 'fixed_contract') {
        throw new BadRequestError('Payment schedules are only available for fixed contracts')
      }
      const existing = await db.query.WorkOrderBillingInstallment.findMany({
        where: and(
          eq(schema.WorkOrderBillingInstallment.organizationId, input.organizationId),
          eq(schema.WorkOrderBillingInstallment.workOrderId, input.workOrderInstanceId)
        ),
        orderBy: [asc(schema.WorkOrderBillingInstallment.sortOrder)],
      })
      const locked = existing.filter((row) => row.status === 'drafted' || row.status === 'invoiced')
      const lockedAmount = locked.reduce((sum, row) => sum + row.amount, 0)
      const target = projection.billingAmount - lockedAmount
      if (target < 0)
        throw new BadRequestError('Issued installments exceed the current contract value')
      if (target === 0 && input.installments.length > 0) {
        throw new BadRequestError('This contract is already fully scheduled')
      }
      if (target > 0 && input.installments.length === 0) {
        throw new BadRequestError('Add installments for the remaining contract value')
      }
      const resolved = resolveRows(input.installments, projection.billingAmount, target)
      const deposit = await heldDepositAmount(db, input.organizationId, input.workOrderInstanceId)
      if (deposit > 0 && locked.length === 0 && resolved[0] && resolved[0].amount < deposit) {
        throw new BadRequestError('The first installment cannot be smaller than the held deposit')
      }
      const replaceableIds = existing
        .filter((row) => row.status === 'pending' || row.status === 'canceled')
        .map((row) => row.id)
      if (replaceableIds.length > 0) {
        await db
          .delete(schema.WorkOrderBillingInstallment)
          .where(inArray(schema.WorkOrderBillingInstallment.id, replaceableIds))
      }
      if (resolved.length > 0) {
        await db.insert(schema.WorkOrderBillingInstallment).values(
          resolved.map((row, index) => ({
            organizationId: input.organizationId,
            workOrderId: input.workOrderInstanceId,
            name: row.name,
            sortOrder: locked.length + index,
            calculation: row.calculation,
            percentageBasisPoints:
              row.calculation === 'percentage' ? row.percentageBasisPoints : null,
            amount: row.amount,
            trigger: row.trigger,
            scheduledDate: row.trigger === 'date' ? row.scheduledDate : null,
            status: 'pending' as const,
          }))
        )
      }
    },
    { isolationLevel: 'serializable' }
  )
  await syncWorkOrderBillingProjection(input)
}
