// packages/lib/src/accounting/money/customer-money/record-events.ts

/**
 * The record-rule declarations that keep financial evidence current, and the two
 * doors that turn a fired rule into a mark.
 *
 * A fired rule marks; the two reconcilers rebuild once per parent after commit
 * (LIB-LAYOUT §3f).
 *
 * 🛑 The per-field `changed` rules are not collapsible into one def-wide rule:
 * `assertSystemRuleShape` rejects a non-lifecycle declaration without a
 * `fieldRef`, and `ruleMatchesBatchEvent` only matches a field event when
 * `rule.fieldId === event.fieldId` — a null-fieldId rule is a lifecycle rule by
 * construction. Making `changed` def-wide is an engine change, not a
 * declaration change.
 */

import type { Database } from '@auxx/database'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { getCachedEntityDefId } from '../../../cache'
import { relationshipInstanceIds } from '../../../field-values/relationship-field'
import { registerNativeRuleHandler } from '../../../record-rules/actions'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'
import { declareSystemRules } from '../../../record-rules/system-rules'
import { CUSTOMER_TRANSACTION_FIELDS } from '../../../resources/registry/resources/customer-transaction-fields'
import { PAYOUT_SOURCE_FIELDS } from '../../../resources/registry/resources/payout-source-fields'
import { PROCESSOR_BALANCE_ENTRY_FIELDS } from '../../../resources/registry/resources/processor-balance-entry-fields'
import { assessPayouts } from '../payouts/assess-payouts'
import { markPayoutForAssessment, registerPayoutReconciler } from '../payouts/payout-reconciler'
import {
  markOrderEvidence,
  type OrderEvidenceKind,
  reconcileOrderEvidenceFromSync,
  registerOrderEvidenceReconciler,
} from './order-evidence-reconciler'

const HANDLER = 'money.reconcile-financial-records'
const FINANCIAL_RECORDS = [
  { defSlug: 'payout', evidenceAttribute: 'payout_source_membership' },
  { defSlug: 'processor_balance_entry', evidenceAttribute: 'processor_balance_acquisition_id' },
  { defSlug: 'order', evidenceAttribute: 'order_payment_source_complete' },
  { defSlug: 'customer_transaction', evidenceAttribute: 'customer_transaction_order' },
  { defSlug: 'line_item', evidenceAttribute: 'line_item_order' },
] as const

type FinancialKind = (typeof FINANCIAL_RECORDS)[number]['defSlug']

/** Which of the five financial defs this org's definition ids belong to. */
async function financialKindByDefId(organizationId: string): Promise<Map<string, FinancialKind>> {
  const kinds = new Map<string, FinancialKind>()
  for (const { defSlug } of FINANCIAL_RECORDS) {
    const defId = await getCachedEntityDefId(organizationId, defSlug)
    if (defId) kinds.set(defId, defSlug)
  }
  return kinds
}

/** The payout lane owns two of the five defs; the other three are order evidence. */
const isPayoutOwner = (kind: FinancialKind): kind is 'payout' | 'processor_balance_entry' =>
  kind === 'payout' || kind === 'processor_balance_entry'

/** Register shared financial behavior for ordinary writes; bulk replay finalizes later. */
export function registerFinancialRecordRules(): void {
  registerOrderEvidenceReconciler()
  registerPayoutReconciler()
  registerNativeRuleHandler(HANDLER, async (event) => {
    if (event.source === 'sync') return
    const kinds = await financialKindByDefId(event.organizationId)
    const userId = event.userId ?? ''
    for (const recordId of new Set(event.recordIds)) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const kind = kinds.get(entityDefinitionId)
      if (!kind) continue
      if (isPayoutOwner(kind))
        await markPayoutForAssessment(event.organizationId, userId, entityInstanceId)
      else await markOrderEvidence(event.organizationId, userId, kind, entityInstanceId)
    }
    // A reparented line leaves its old order's evidence stale, and the old order
    // is only knowable from the event's previous value.
    for (const [recordId, old] of Object.entries(event.previousValuesByRecordId ?? {})) {
      const { entityDefinitionId } = parseRecordId(recordId as RecordId)
      if (kinds.get(entityDefinitionId) !== 'line_item') continue
      for (const orderInstanceId of relationshipInstanceIds(old))
        await markOrderEvidence(event.organizationId, userId, 'order', orderInstanceId)
    }
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

/**
 * Collect canonical record identities once after bulk relationships and totals settle.
 *
 * The same classification as the rule handler, but it rebuilds directly instead of
 * marking: nothing opens a dirty-parent scope at sync finalize, so a mark per record
 * would run one assessment per record. The batch is what the reconcilers' drains
 * would have been handed.
 */
export async function reconcileFinancialRecordsAfterBulk(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest
): Promise<void> {
  const kinds = await financialKindByDefId(organizationId)
  const orderMarks: string[] = []
  const payoutInstanceIds: string[] = []
  const candidates = new Set<RecordId>([
    ...(manifest.createdRecordIds ?? []),
    ...(manifest.archivedRecordIds ?? []),
    ...(Object.keys(manifest.touched) as RecordId[]),
  ])
  for (const recordId of candidates) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const kind = kinds.get(entityDefinitionId)
    if (!kind) continue
    if (isPayoutOwner(kind)) {
      payoutInstanceIds.push(entityInstanceId)
      continue
    }
    const orderKind: OrderEvidenceKind = kind
    orderMarks.push(`${orderKind}:${entityInstanceId}`)
  }
  for (const fields of Object.values(manifest.deltas ?? {})) {
    for (const orderInstanceId of relationshipInstanceIds(fields.line_item_order?.o))
      orderMarks.push(`order:${orderInstanceId}`)
  }
  if (orderMarks.length) await reconcileOrderEvidenceFromSync(db, organizationId, orderMarks)
  if (payoutInstanceIds.length) await assessPayouts(db, organizationId, payoutInstanceIds)
}
