// packages/lib/src/jobs/purchasing/bill-intake-job.ts

/**
 * The invoice-to-vendor-bill worker (plans/money/tasks/58 §4.1 and §4.6).
 *
 * The run is deliberately the source of progress. A resumed run already has
 * its transcription in Redis, so the expensive document call is never made a
 * second time when a person supplies a vendor from the picker.
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  assignBillLines,
  findExistingBill,
  findOrderByReference,
  foldKey,
  loadOrderLineFacts,
  proposeLandedBills,
  resolveInvoiceVendor,
  transcribeInvoice,
} from '../../accounting/purchasing/bill-intake'
import type {
  BillIntakeWarning,
  BillLineFacts,
  OrderLineFacts,
  TranscribedInvoice,
} from '../../accounting/purchasing/bill-intake/client'
import {
  createBillFromIntake,
  loadPurchaseOrderCurrency,
} from '../../accounting/purchasing/bill-intake/create'
import { foldInvoiceNumber } from '../../accounting/purchasing/bill-intake/duplicate'
import {
  failBillIntakeRun,
  parkBillIntakeRunForVendor,
  readStoredBillIntakeRun,
  type StoredBillIntakeRun,
  setBillIntakeRunPhase,
  updateBillIntakeRun,
} from '../../accounting/purchasing/bill-intake/run-store'
import { resolveIntakeUnitPrice } from '../../accounting/purchasing/intake/client'
import { checkIntakeModelCapability } from '../../accounting/purchasing/intake/transcribe'
import { getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { getOrgCurrencyCode } from '../../field-values/org-currency'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'
import { PURCHASE_INTAKE_DAILY_LIMIT } from './purchase-intake-job'

const logger = createScopedLogger('job:bill-intake')

/** The BullMQ name. It must match the worker mapping. */
export const BILL_INTAKE_JOB_NAME = 'billIntakeJob'

const DAY_MS = 24 * 60 * 60 * 1000

export interface BillIntakeJobData {
  organizationId: string
  /** The member who uploaded or selected the vendor. */
  userId: string
  /** The Redis run this job advances. */
  runId: string
  /** Set when a parked `needs_vendor` run is being continued. */
  resume?: boolean
}

/** Enqueue one invoice read with a stable idempotency key. */
export async function enqueueBillIntake(data: BillIntakeJobData): Promise<void> {
  const queue = getQueue(Queues.purchaseIntakeQueue)
  await queue.add(BILL_INTAKE_JOB_NAME, data, {
    // Keep exactly three colon-separated segments for BullMQ job-id parsing.
    // A parked job is normally removed on completion, but a retained completed
    // job or a race with cleanup must not swallow the resume enqueue. Keep the
    // suffix as the third segment for BullMQ's custom-id compatibility.
    jobId: `bill-intake:${data.organizationId}:${data.runId}${data.resume ? '-resume' : ''}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
  })
}

/**
 * Read an invoice, resolve its context, and create its draft vendor bill.
 *
 * A transient model/database error keeps the run reading until the final
 * BullMQ attempt, when it is marked failed. Deterministic refusals (unsupported model, duplicate,
 * unreadable invoice, or a missing vendor) are recorded and return cleanly.
 */
export async function billIntakeJob(ctx: JobContext<BillIntakeJobData>) {
  const { organizationId, userId, runId } = ctx.job.data
  const startedAt = Date.now()

  const finish = <T extends Record<string, unknown>>(outcome: string, result: T): T => {
    logger.info('Bill intake finished', {
      organizationId,
      runId,
      outcome,
      attempt: ctx.job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    })
    return result
  }
  const skip = (reason: string) => finish(reason, { skipped: reason })

  const stored = await readStoredBillIntakeRun(organizationId, runId)
  if (!stored) return skip('run_not_found')
  if (stored.status === 'created') return skip('run_created')
  if (stored.status === 'needs_vendor') return skip('needs_vendor')

  let run = stored

  try {
    if (run.status === 'failed') {
      const reset = await update(organizationId, runId, { status: 'reading', error: null })
      if (!reset) throw new Error('Failed to resume the failed invoice read')
      run = { ...run, status: 'reading', error: null }
    }

    // ── Phase 1: document ─────────────────────────────────────────────────
    if (!run.transcription) {
      const window = await checkFixedWindowLimit({
        key: `bill-intake:${organizationId}:${new Date().toISOString().slice(0, 10)}`,
        limit: PURCHASE_INTAKE_DAILY_LIMIT,
        windowMs: DAY_MS,
      })
      if (!window.allowed) {
        const message = `This organization has read ${PURCHASE_INTAKE_DAILY_LIMIT} invoices today, which is the daily limit. Try again tomorrow.`
        await fail(organizationId, runId, message)
        logger.warn('Bill intake daily limit reached', {
          organizationId,
          runId,
          count: window.count,
          limit: PURCHASE_INTAKE_DAILY_LIMIT,
        })
        return skip('daily_limit_reached')
      }

      await phase(organizationId, runId, 'document')
      const capability = await checkIntakeModelCapability(organizationId)
      if (capability.isErr()) throw capability.error
      if (!capability.value.ok) {
        const message =
          capability.value.reason ??
          `${capability.value.modelId} cannot read uploaded invoices. Pick another default model.`
        await fail(organizationId, runId, message)
        return skip('model_cannot_read_files')
      }
      const read = await transcribeInvoice(database, organizationId, userId, {
        assetRef: run.assetRef,
        fileName: run.fileName,
        mimeType: run.mimeType,
      })
      if (read.isErr()) {
        const message = `We could not read this invoice. ${describe(read.error)}`
        throw new UnprocessableEntityError(message, { cause: read.error.message })
      }

      const transcription = read.value.document
      // A parser-valid response with neither line data nor a total is not an
      // invoice. Refuse before any vendor/order lookup or bill creation.
      if (transcription.lines.length === 0 && !hasPrintedTotal(transcription)) {
        const error = new UnprocessableEntityError(
          'We could not read an invoice total or any invoice lines from this document.'
        )
        await fail(organizationId, runId, error.message)
        return skip('invoice_not_readable')
      }

      const saved = await update(organizationId, runId, {
        transcription,
        extractedText: read.value.extractedText,
        error: null,
      })
      run = { ...run, transcription, extractedText: read.value.extractedText, error: null }
      if (!saved) throw new Error('Failed to persist invoice transcription')
    }

    const transcription = run.transcription
    if (!transcription) throw new UnprocessableEntityError('This invoice has not been read yet')

    // ── Phase 2: vendor ───────────────────────────────────────────────────
    await phase(organizationId, runId, 'vendor')
    if (!run.vendorRecordId) {
      const resolution = await resolveInvoiceVendor(database, organizationId, transcription)
      if (resolution.isErr()) throw resolution.error

      if (!resolution.value.vendorRecordId) {
        const parked = await parkBillIntakeRunForVendor(
          organizationId,
          runId,
          resolution.value.candidates
        )
        if (parked.isErr()) throw parked.error
        return finish('needs_vendor', {
          needsVendor: true,
          candidateCount: resolution.value.candidates.length,
        })
      }

      const warning: BillIntakeWarning = {
        code: 'vendor_from_invoice',
        message: `Vendor ${resolution.value.candidates.find((c) => c.recordId === resolution.value.vendorRecordId)?.displayName ?? 'from the invoice'} was taken from the invoice.`,
      }
      const warnings = appendWarning(run.warnings, warning)
      const saved = await update(organizationId, runId, {
        vendorRecordId: resolution.value.vendorRecordId,
        vendorCandidates: resolution.value.candidates,
        warnings,
        error: null,
      })
      if (!saved) throw new Error('Failed to persist the invoice vendor')
      run = {
        ...run,
        vendorRecordId: resolution.value.vendorRecordId,
        vendorCandidates: resolution.value.candidates,
        warnings,
        error: null,
      }
    }

    // Duplicate detection must happen after the vendor is known and before
    // loading/matching lines, so a resent invoice never creates a bill.
    if (!transcription.invoiceNumber?.trim()) {
      const message = 'The invoice prints no number.'
      await fail(organizationId, runId, message)
      return skip('invoice_number_missing')
    }
    const duplicate = await findExistingBill(database, organizationId, {
      vendorRecordId: run.vendorRecordId as RecordId,
      invoiceNumber: transcription.invoiceNumber,
    })
    if (duplicate.isErr()) throw duplicate.error
    if (duplicate.value) {
      const message = `Invoice ${transcription.invoiceNumber} from ${transcription.vendorName ?? 'this vendor'} is already ${duplicate.value.internalNumber ?? duplicate.value.billRecordId}`
      await fail(organizationId, runId, message, duplicate.value.billRecordId)
      return skip('duplicate_invoice')
    }

    // ── Phase 3: lines ─────────────────────────────────────────────────────
    await phase(organizationId, runId, 'lines')
    let purchaseOrderRecordId = run.purchaseOrderRecordId
    let warnings = run.warnings
    if (!purchaseOrderRecordId) {
      const found = await findOrderByReference(
        database,
        organizationId,
        run.vendorRecordId as RecordId,
        transcription.purchaseOrderReference
      )
      if (found.isErr()) throw found.error
      if (found.value) {
        purchaseOrderRecordId = found.value
        warnings = appendWarning(warnings, {
          code: 'order_from_invoice',
          message: `Purchase order ${transcription.purchaseOrderReference} was taken from the invoice.`,
        })
        const saved = await update(organizationId, runId, {
          purchaseOrderRecordId,
          warnings,
        })
        if (!saved) throw new Error('Failed to persist the invoice purchase order')
      }
    } else if (transcription.purchaseOrderReference?.trim()) {
      const labels = await loadPurchaseOrderLabels(database, organizationId, purchaseOrderRecordId)
      const printed = foldKey(transcription.purchaseOrderReference)
      if (printed && labels.every((label) => foldKey(label) !== printed)) {
        warnings = appendWarning(warnings, {
          code: 'po_reference_mismatch',
          message: `The invoice names purchase order ${transcription.purchaseOrderReference}, which does not match the selected purchase order.`,
        })
        const saved = await update(organizationId, runId, { warnings })
        if (!saved) throw new Error('Failed to persist the purchase order warning')
      }
    }

    const orderCurrency = purchaseOrderRecordId
      ? await loadPurchaseOrderCurrency(database, organizationId, purchaseOrderRecordId)
      : null
    const currency =
      transcription.currency ?? orderCurrency ?? (await getOrgCurrencyCode(organizationId))
    let orderLines: OrderLineFacts[] = []
    if (purchaseOrderRecordId) {
      const orderLinesResult = await loadOrderLineFacts(
        database,
        organizationId,
        purchaseOrderRecordId
      )
      if (orderLinesResult.isErr()) throw orderLinesResult.error
      orderLines = orderLinesResult.value
    }

    const printedLines: BillLineFacts[] = transcription.lines.map((line, index) => ({
      lineId: String(index),
      vendorCode: line.vendorCode,
      customerCode: line.customerCode,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: resolveIntakeUnitPrice(line, line.quantity ?? 0, currency),
    }))
    const matched = assignBillLines(printedLines, orderLines)

    // 73 §7.2: a carrier's or broker's line names the goods bill it is a landed
    // cost of, from the commercial invoice number printed on it. Falls back to a
    // document-level reference when the line prints none of its own.
    const landedResult = await proposeLandedBills(
      database,
      organizationId,
      transcription.lines.map(
        (line) => line.referencedInvoiceNumber ?? transcription.referencedInvoiceNumber
      )
    )
    if (landedResult.isErr()) throw landedResult.error
    const proposals = matched.map((proposal, index) => ({
      ...proposal,
      landedBillRecordId: landedResult.value[index] ?? null,
    }))

    const saved = await update(organizationId, runId, {
      purchaseOrderRecordId,
      proposals,
      warnings,
      error: null,
    })
    if (!saved) throw new Error('Failed to persist invoice line matches')
    run = { ...run, purchaseOrderRecordId, proposals, warnings, error: null }

    // ── Phase 4: bill ──────────────────────────────────────────────────────
    await phase(organizationId, runId, 'bill')
    return await database.transaction(async (lockTx) => {
      // This transaction owns only the lock. The existing create path commits
      // its writes before marking Redis created, so it must keep its own DB handle.
      // Serialize separate uploads of the same invoice, then repeat the lookup.
      const invoiceKey = JSON.stringify([
        'bill-intake',
        organizationId,
        parseRecordId(run.vendorRecordId as RecordId).entityInstanceId,
        foldInvoiceNumber(transcription.invoiceNumber!),
      ])
      await lockTx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invoiceKey}, 0))`)
      const existing = await findExistingBill(database, organizationId, {
        vendorRecordId: run.vendorRecordId as RecordId,
        invoiceNumber: transcription.invoiceNumber!,
      })
      if (existing.isErr()) throw existing.error
      if (existing.value) {
        await fail(
          organizationId,
          runId,
          `Invoice ${transcription.invoiceNumber} is already ${existing.value.internalNumber ?? existing.value.billRecordId}`,
          existing.value.billRecordId
        )
        return skip('duplicate_invoice')
      }
      const created = await createBillFromIntake(database, organizationId, userId, run)
      if (created.isErr()) throw created.error
      return finish('created', {
        created: true,
        vendorBillRecordId: created.value.vendorBillRecordId,
        vendorBillInstanceId: created.value.vendorBillInstanceId,
        lineCount: created.value.vendorBillLineRecordIds.length,
        linkedLineCount: proposals.filter((proposal) => proposal.linkedOrderLineRecordId).length,
      })
    })
  } catch (error) {
    // Keep transient failures in `reading` while BullMQ retries. Only the
    // terminal attempt becomes a user-visible failed run.
    const attempts = ctx.job.opts.attempts ?? 1
    if (ctx.job.attemptsMade + 1 >= attempts && run.status !== 'created') {
      await fail(organizationId, runId, describe(error))
    }
    throw error
  }
}

function hasPrintedTotal(invoice: TranscribedInvoice): boolean {
  return Boolean(invoice.totalText?.trim())
}

function appendWarning(
  warnings: BillIntakeWarning[],
  warning: BillIntakeWarning
): BillIntakeWarning[] {
  return warnings.some((item) => item.code === warning.code && item.message === warning.message)
    ? warnings
    : [...warnings, warning]
}

async function loadPurchaseOrderLabels(
  db: typeof database,
  organizationId: string,
  purchaseOrderRecordId: RecordId
): Promise<string[]> {
  try {
    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['purchase_order_number', 'purchase_order_reference'] as const)
    const fieldIds = [fields.purchase_order_number?.id, fields.purchase_order_reference?.id].filter(
      (id): id is string => Boolean(id)
    )
    if (fieldIds.length === 0) return []
    const { entityInstanceId } = parseRecordId(purchaseOrderRecordId)
    const rows = await db
      .select({ valueText: schema.FieldValue.valueText })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, entityInstanceId),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )
    return rows.map((row) => row.valueText).filter((value): value is string => Boolean(value))
  } catch (error) {
    // A mismatch banner is useful, but cannot justify failing a bill read.
    logger.warn('Could not load selected purchase order labels', {
      organizationId,
      purchaseOrderRecordId,
      error,
    })
    return []
  }
}

async function phase(
  organizationId: string,
  runId: string,
  next: 'document' | 'vendor' | 'lines' | 'bill'
): Promise<void> {
  const result = await setBillIntakeRunPhase(organizationId, runId, next)
  if (result.isErr()) {
    logger.warn('Failed to record bill intake phase', {
      organizationId,
      runId,
      phase: next,
      error: result.error.message,
    })
    throw result.error
  }
}

async function update(
  organizationId: string,
  runId: string,
  patch: Partial<StoredBillIntakeRun>
): Promise<boolean> {
  const result = await updateBillIntakeRun(organizationId, runId, patch)
  if (result.isErr()) {
    logger.error('Failed to update bill intake run', {
      organizationId,
      runId,
      error: result.error.message,
    })
    return false
  }
  return true
}

async function fail(
  organizationId: string,
  runId: string,
  message: string,
  existingBillRecordId?: RecordId | null
): Promise<void> {
  const result = await failBillIntakeRun(organizationId, runId, message, existingBillRecordId)
  if (result.isErr()) {
    logger.error('Failed to mark bill intake run failed', {
      organizationId,
      runId,
      error: result.error.message,
    })
    throw result.error
  }
}

function describe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong reading this invoice.'
}
