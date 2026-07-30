// packages/lib/src/money/quickbooks/sync-invoice.ts
//
// Orchestrator CORE for QuickBooks invoice sync (plan 37e-quickbooks-invoice-sync.md §3, P3).
// Mirrors an Auxx invoice into QuickBooks Online: find-or-create the customer + line items,
// then create-or-update the invoice, keyed on the `qboInvoiceId` id-map field so re-runs
// converge instead of duplicating. Never sends the invoice — Auxx owns delivery (decision D3).
//
// This module is invocation-agnostic on purpose: a separate task wires the BullMQ queue, the
// `invoice_status: draft→sent` field-change hook, the worker, and the tRPC "Sync to QuickBooks"
// mutation — all of them just call `syncInvoiceToQuickbooks()`.

import { createScopedLogger } from '@auxx/logger'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { readQuickbooksIdField, writeQuickbooksIdField } from './identity-field'
import { resolveQuickbooksContext } from './invoke-quickbooks-tool'
import { upsertQuickbooksCustomer } from './upsert-customer'
import { upsertQuickbooksItem } from './upsert-item'

const logger = createScopedLogger('quickbooks-sync-invoice')

const QBO_INVOICE_ID_FIELD_KEY = 'qboInvoiceId'

export interface SyncInvoiceToQuickbooksInput {
  organizationId: string
  invoiceInstanceId: string
  /**
   * Actor for entity reads/writes and the app connection's user-scope resolution. Falls back
   * to the org's system user when absent — the actor-less Stripe-webhook `paid` transition is
   * exactly why this is optional (plan §3 "Why code, not a workflow").
   */
  actorUserId?: string
}

export interface SyncInvoiceResult {
  status: 'synced' | 'disabled' | 'not_connected' | 'error'
  qboInvoiceId?: string
  error?: string
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  return Array.isArray(entry) ? entry[0] : entry
}

function stringValue(entry: TypedFieldValue | TypedFieldValue[] | undefined): string | undefined {
  const typed = firstTyped(entry)
  if (!typed) return undefined
  const value = extractValue(typed)
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(entry: TypedFieldValue | TypedFieldValue[] | undefined): number | undefined {
  const typed = firstTyped(entry)
  if (!typed) return undefined
  const value = extractValue(typed)
  return typeof value === 'number' ? value : undefined
}

/**
 * QBO date fields require a bare `YYYY-MM-DD`; Auxx DATE fields extract as a full
 * timestamp string (e.g. `2026-08-10 00:00:00+00`) or a `Date`. Normalise to the
 * calendar date, or return undefined if it isn't a parseable date.
 */
function toQboDate(entry: TypedFieldValue | TypedFieldValue[] | undefined): string | undefined {
  const typed = firstTyped(entry)
  if (!typed) return undefined
  const value = extractValue(typed)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/)
    return match ? match[0] : undefined
  }
  return undefined
}

interface QuickbooksInvoiceLine {
  itemId: string
  amount: number
  quantity?: number
  description?: string
}

/**
 * Mirror an Auxx invoice into QuickBooks Online (money plan 37e-quickbooks-invoice-sync.md §3).
 *
 * Never throws — disabled, not-connected, and every failure mid-chain (missing contact, no
 * billable lines, missing default income account, a QBO tool error) all resolve to a typed
 * `status` instead, so callers (a BullMQ job, a tRPC mutation) can persist the outcome without
 * their own try/catch.
 */
export async function syncInvoiceToQuickbooks(
  input: SyncInvoiceToQuickbooksInput
): Promise<SyncInvoiceResult> {
  const { organizationId, invoiceInstanceId, actorUserId } = input

  try {
    const syncEnabled = await getOrganizationSetting({
      organizationId,
      key: 'quickbooks.syncInvoices',
    })
    if (!syncEnabled) return { status: 'disabled' }

    const resolved = await resolveQuickbooksContext({ organizationId, actorUserId })
    if (!resolved.connected) return { status: 'not_connected' }
    const ctx = resolved.context

    const handler = new UnifiedCrudHandler(organizationId, ctx.userId)
    const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
    const cache = getOrgCache()

    // ── 1. Invoice's own fields ──────────────────────────────────────────
    const invoiceCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['invoice_number', 'invoice_due_date', 'invoice_contact'] as const)

    const invoiceFieldIds = [
      invoiceCf.invoice_number,
      invoiceCf.invoice_due_date,
      invoiceCf.invoice_contact,
    ]
      .filter(Boolean)
      .map((f) => f!.id)
    const invoiceValues = await handler.getFieldValues(invoiceRecordId, invoiceFieldIds)

    const invoiceNumber = invoiceCf.invoice_number
      ? stringValue(invoiceValues.get(invoiceCf.invoice_number.id))
      : undefined
    const dueDate = invoiceCf.invoice_due_date
      ? toQboDate(invoiceValues.get(invoiceCf.invoice_due_date.id))
      : undefined
    const contactRecordIdStr = invoiceCf.invoice_contact
      ? stringValue(invoiceValues.get(invoiceCf.invoice_contact.id))
      : undefined

    if (!contactRecordIdStr) {
      throw new Error(`Invoice ${invoiceInstanceId} has no contact — cannot sync to QuickBooks`)
    }
    const { entityInstanceId: contactInstanceId } = parseRecordId(contactRecordIdStr as RecordId)
    const contactRecordId = toRecordId('contact', contactInstanceId)

    // ── 2. Contact's fields → customer upsert ────────────────────────────
    const contactCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['first_name', 'last_name', 'primary_email'] as const)
    const contactFieldIds = [contactCf.first_name, contactCf.last_name, contactCf.primary_email]
      .filter(Boolean)
      .map((f) => f!.id)
    const contactValues = await handler.getFieldValues(contactRecordId, contactFieldIds)

    const contactFields = {
      firstName: contactCf.first_name
        ? stringValue(contactValues.get(contactCf.first_name.id))
        : undefined,
      lastName: contactCf.last_name
        ? stringValue(contactValues.get(contactCf.last_name.id))
        : undefined,
      primaryEmail: contactCf.primary_email
        ? stringValue(contactValues.get(contactCf.primary_email.id))
        : undefined,
    }

    const qboCustomerId = await upsertQuickbooksCustomer(ctx, {
      organizationId,
      contactInstanceId,
      contactFields,
      handler,
    })

    // ── 3. Lines → item upserts (skip $0 lines entirely) ─────────────────
    const defaultIncomeAccountId = (await getOrganizationSetting({
      organizationId,
      key: 'quickbooks.defaultIncomeAccountId',
    })) as string | null

    const lineCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'line_item_line_total',
        'line_item_qty',
        'line_item_name',
        'line_item_catalog_item',
      ] as const)

    const { ids: lineInstanceIds } = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'invoice-lines',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'invoice-lines-invoice',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: invoiceRecordId,
            },
            {
              id: 'invoice-lines-workorder',
              fieldId: 'line_item:workOrder',
              operator: 'empty',
              value: null,
            },
          ],
        },
      ],
      limit: 1000,
    })

    const qboLines: QuickbooksInvoiceLine[] = []

    if (lineCf.line_item_line_total) {
      const lineFieldIds = [
        lineCf.line_item_line_total,
        lineCf.line_item_qty,
        lineCf.line_item_name,
        lineCf.line_item_catalog_item,
      ]
        .filter(Boolean)
        .map((f) => f!.id)

      for (const lineInstanceId of lineInstanceIds) {
        const lineRecordId = toRecordId('line_item', lineInstanceId)
        const lineValues = await handler.getFieldValues(lineRecordId, lineFieldIds)

        const lineTotalCents = numberValue(lineValues.get(lineCf.line_item_line_total.id))
        if (!lineTotalCents || lineTotalCents <= 0) continue // §3: $0 lines skipped entirely

        const qty = lineCf.line_item_qty
          ? numberValue(lineValues.get(lineCf.line_item_qty.id))
          : undefined
        const lineName = lineCf.line_item_name
          ? stringValue(lineValues.get(lineCf.line_item_name.id))
          : undefined
        const catalogItemRecordIdStr = lineCf.line_item_catalog_item
          ? stringValue(lineValues.get(lineCf.line_item_catalog_item.id))
          : undefined
        const catalogItemInstanceId = catalogItemRecordIdStr
          ? parseRecordId(catalogItemRecordIdStr as RecordId).entityInstanceId
          : undefined

        const itemName = lineName || 'Item'
        const qboItemId = await upsertQuickbooksItem(ctx, {
          organizationId,
          itemName,
          catalogItemInstanceId,
          defaultIncomeAccountId,
          handler,
        })

        qboLines.push({
          itemId: qboItemId,
          amount: lineTotalCents / 100,
          quantity: qty ?? 1,
          description: itemName,
        })
      }
    }

    if (qboLines.length === 0) {
      throw new Error(`Invoice ${invoiceInstanceId} has no billable lines to sync to QuickBooks`)
    }

    // ── 4. Create-or-update the invoice (idempotency guarantee) ──────────
    const storedQboInvoiceId = await readQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_INVOICE_ID_FIELD_KEY,
      recordId: invoiceRecordId,
      handler,
    })

    const sharedFields = {
      ...(invoiceNumber ? { docNumber: invoiceNumber } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(contactFields.primaryEmail ? { billEmail: contactFields.primaryEmail } : {}),
    }

    let qboInvoiceId: string
    if (storedQboInvoiceId) {
      const updated = await ctx.callTool('update_quickbooks_invoice', {
        invoiceId: storedQboInvoiceId,
        lines: qboLines,
        ...sharedFields,
      })
      qboInvoiceId = String(updated.invoiceId)
    } else {
      const created = await ctx.callTool('create_quickbooks_invoice', {
        customerId: qboCustomerId,
        lines: qboLines,
        ...sharedFields,
      })
      qboInvoiceId = String(created.invoiceId)
    }

    await writeQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_INVOICE_ID_FIELD_KEY,
      entityType: 'invoice',
      entityInstanceId: invoiceInstanceId,
      externalId: qboInvoiceId,
      userId: ctx.userId,
    })

    return { status: 'synced', qboInvoiceId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('QuickBooks invoice sync failed', {
      organizationId,
      invoiceInstanceId,
      error: message,
    })
    return { status: 'error', error: message }
  }
}
