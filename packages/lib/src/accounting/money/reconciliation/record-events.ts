// packages/lib/src/accounting/money/reconciliation/record-events.ts
import type { Database } from '@auxx/database'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { registerNativeRuleHandler } from '../../../record-rules/actions'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'
import { declareSystemRules } from '../../../record-rules/system-rules'
import { CUSTOMER_TRANSACTION_FIELDS } from '../../../resources/registry/resources/customer-transaction-fields'
import { PAYOUT_SOURCE_FIELDS } from '../../../resources/registry/resources/payout-source-fields'
import { PROCESSOR_BALANCE_ENTRY_FIELDS } from '../../../resources/registry/resources/processor-balance-entry-fields'

const HANDLER = 'money.reconcile-financial-records'
const FINANCIAL_RECORDS = [
  { defSlug: 'payout', evidenceAttribute: 'payout_source_membership' },
  { defSlug: 'processor_balance_entry', evidenceAttribute: 'processor_balance_acquisition_id' },
  { defSlug: 'order', evidenceAttribute: 'order_payment_source_complete' },
  { defSlug: 'customer_transaction', evidenceAttribute: 'customer_transaction_order' },
  { defSlug: 'line_item', evidenceAttribute: 'line_item_order' },
] as const

/** Register shared financial behavior for ordinary writes; bulk replay finalizes later. */
export function registerFinancialRecordRules(): void {
  registerNativeRuleHandler(HANDLER, async (event) => {
    if (event.source === 'sync') return
    const { database } = await import('@auxx/database')
    const { reconcileFinancialRecords } = await import('./reconcile-records')
    const previousOrderIds: string[] = []
    if (event.previousValuesByRecordId && Object.keys(event.previousValuesByRecordId).length) {
      const { getCachedResources } = await import('../../../cache')
      const resources = await getCachedResources(event.organizationId)
      const lineDefinitions = new Set(
        resources
          .filter((resource) => resource.entityType === 'line_item')
          .map((resource) => resource.id)
      )
      for (const [recordId, old] of Object.entries(event.previousValuesByRecordId)) {
        if (!lineDefinitions.has(parseRecordId(recordId as RecordId).entityDefinitionId)) continue
        if (typeof old === 'string')
          previousOrderIds.push(
            old.includes(':') ? parseRecordId(old as RecordId).entityInstanceId : old
          )
        else if (
          old &&
          typeof old === 'object' &&
          'recordId' in old &&
          typeof old.recordId === 'string'
        ) {
          previousOrderIds.push(parseRecordId(old.recordId as RecordId).entityInstanceId)
        }
      }
    }
    await reconcileFinancialRecords(database, {
      organizationId: event.organizationId,
      recordIds: event.recordIds,
      cause: 'record-change',
      ...(previousOrderIds.length ? { previousOrderIds } : {}),
    })
  })
  declareSystemRules(
    FINANCIAL_RECORDS.flatMap(({ defSlug, evidenceAttribute }) => [
      {
        key: `money-${defSlug}-created`,
        name: 'Assess financial record',
        defSlug,
        on: 'created' as const,
        actions: [{ type: 'native' as const, handler: HANDLER }],
      },
      {
        key: `money-${defSlug}-evidence-changed`,
        name: 'Assess changed financial evidence',
        defSlug,
        fieldRef: { systemAttribute: evidenceAttribute },
        on: 'changed' as const,
        skipOnCreate: true,
        actions: [{ type: 'native' as const, handler: HANDLER }],
      },
    ])
  )
  for (const [defSlug, fields] of [
    ['payout', PAYOUT_SOURCE_FIELDS],
    ['processor_balance_entry', PROCESSOR_BALANCE_ENTRY_FIELDS],
    ['customer_transaction', CUSTOMER_TRANSACTION_FIELDS],
  ] as const) {
    declareSystemRules(
      Object.values(fields)
        .filter(
          (field) =>
            field.systemAttribute &&
            !FINANCIAL_RECORDS.some(
              (record) =>
                record.defSlug === defSlug && record.evidenceAttribute === field.systemAttribute
            )
        )
        .map((field) => ({
          key: `money-${field.systemAttribute}-changed`,
          name: 'Assess changed financial record',
          defSlug,
          fieldRef: { systemAttribute: field.systemAttribute! },
          on: 'changed' as const,
          skipOnCreate: true,
          actions: [{ type: 'native' as const, handler: HANDLER }],
        }))
    )
  }
  declareSystemRules(
    ['order_total', 'order_contact', 'order_currency', 'order_line_items'].map((attribute) => ({
      key: `money-${attribute}-changed`,
      name: 'Revisit payment prerequisites',
      defSlug: 'order',
      fieldRef: { systemAttribute: attribute },
      on: 'changed',
      skipOnCreate: true,
      actions: [{ type: 'native', handler: HANDLER }],
    }))
  )
}

/** Collect canonical record identities once after bulk relationships and totals settle. */
export async function reconcileFinancialRecordsAfterBulk(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: (id: string) => Promise<{ entityType: string | null } | null | undefined>
): Promise<void> {
  const candidates = new Set<RecordId>([
    ...(manifest.createdRecordIds ?? []),
    ...(manifest.archivedRecordIds ?? []),
    ...(Object.keys(manifest.touched) as RecordId[]),
  ])
  const definitions = new Map<string, boolean>()
  const recordIds: RecordId[] = []
  for (const recordId of candidates) {
    const { entityDefinitionId } = parseRecordId(recordId)
    let relevant = definitions.get(entityDefinitionId)
    if (relevant === undefined) {
      const definition = await resolveDef(entityDefinitionId)
      relevant = FINANCIAL_RECORDS.some((record) => record.defSlug === definition?.entityType)
      definitions.set(entityDefinitionId, relevant)
    }
    if (relevant) recordIds.push(recordId)
  }
  if (recordIds.length === 0) return
  const { reconcileFinancialRecords } = await import('./reconcile-records')
  const previousOrderIds = Object.values(manifest.deltas ?? {}).flatMap((fields) => {
    const old = fields.line_item_order?.o
    if (typeof old === 'string')
      return [old.includes(':') ? parseRecordId(old as RecordId).entityInstanceId : old]
    if (old && typeof old === 'object' && 'recordId' in old && typeof old.recordId === 'string') {
      return [parseRecordId(old.recordId as RecordId).entityInstanceId]
    }
    return []
  })
  await reconcileFinancialRecords(db, {
    organizationId,
    recordIds,
    cause: 'bulk-complete',
    ...(previousOrderIds.length ? { previousOrderIds } : {}),
  })
}
