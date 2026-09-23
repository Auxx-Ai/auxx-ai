// packages/lib/src/accounting/sales/credit-memos/input-complete.ts
//
// Whether a channel memo holds all of its own payload yet (101 E9): derived from the
// connector's `pendingRelations` and the memo's `credit_memo_money_pending`, never stored.

import type { Database } from '@auxx/database'
import { listPendingItemsAround } from '../../../data-connectors/pending-items'
import { UnprocessableEntityError } from '../../../errors'
import { readSystemRecords, systemDefId, systemFields } from '../../../resources/system-records'
import { withWorkItemCode } from '../../work-items/refusal'
import type { CreditMemoRecord } from './reads'

/** One unresolved edge, named for the work item's `detail`. */
export interface MemoPendingRelation {
  recordId: string
  fieldKey: string
  targetExternalId: string | null
}

export interface MemoInputState {
  ready: boolean
  pendingRelations: MemoPendingRelation[]
  moneyPending: boolean
  connectorName: string | null
}

const READY: MemoInputState = {
  ready: true,
  pendingRelations: [],
  moneyPending: false,
  connectorName: null,
}

async function readMoneyPending(db: Database, organizationId: string, memoId: string) {
  const ctx = await systemFields(db, organizationId, 'credit_memo', [
    'credit_memo_money_pending',
  ] as const)
  if (!ctx?.fields.credit_memo_money_pending) return false
  const [memo] = await readSystemRecords(db, organizationId, ctx, { ids: [memoId] })
  return memo?.boolean('credit_memo_money_pending') === true
}

async function readOrderLineItems(
  db: Database,
  organizationId: string,
  orderInstanceId: string | null
): Promise<{ ids: string[]; defId: string | null }> {
  const ctx = await systemFields(db, organizationId, 'line_item', ['line_item_order'] as const)
  if (!ctx) return { ids: [], defId: null }
  if (!orderInstanceId || !ctx.fields.line_item_order) return { ids: [], defId: ctx.defId }
  const rows = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'line_item_order', in: [orderInstanceId] },
    cells: false,
  })
  return { ids: rows.map((row) => row.id), defId: ctx.defId }
}

/**
 * A `channel` memo is ready when no connector item bound to it, its lines, its order
 * or the order's line items (or pointing at one of them from those defs) has pending
 * relations, and its money is not pending. A native memo is always ready.
 */
export async function readMemoInputState(
  db: Database,
  organizationId: string,
  memo: Pick<CreditMemoRecord, 'id' | 'source' | 'lineIds' | 'orderInstanceId'>
): Promise<MemoInputState> {
  if (memo.source !== 'channel') return READY

  const [moneyPending, orderLines, memoLineDefId, memoDefId] = await Promise.all([
    readMoneyPending(db, organizationId, memo.id),
    readOrderLineItems(db, organizationId, memo.orderInstanceId),
    systemDefId(db, organizationId, 'credit_memo_line'),
    systemDefId(db, organizationId, 'credit_memo'),
  ])
  const items = await listPendingItemsAround(db, organizationId, {
    instanceIds: [
      memo.id,
      ...memo.lineIds,
      ...(memo.orderInstanceId ? [memo.orderInstanceId] : []),
      ...orderLines.ids,
    ],
    pointingFromDefIds: [memoDefId, memoLineDefId, orderLines.defId].filter(
      (id): id is string => !!id
    ),
  })

  const pendingRelations = items.flatMap((item) =>
    item.pendingRelations.map((rel) => ({
      recordId: item.entityInstanceId,
      fieldKey: rel.fieldKey,
      targetExternalId: rel.targetExternalId,
    }))
  )
  return {
    ready: pendingRelations.length === 0 && !moneyPending,
    pendingRelations,
    moneyPending,
    connectorName: items[0]?.connectorName ?? null,
  }
}

/** Refuse a channel memo whose payload is not complete, as the `MEMO_INPUT_INCOMPLETE` work item. */
export async function assertMemoInputComplete(
  db: Database,
  organizationId: string,
  memo: Pick<CreditMemoRecord, 'id' | 'source' | 'lineIds' | 'orderInstanceId'>
): Promise<void> {
  const state = await readMemoInputState(db, organizationId, memo)
  if (state.ready) return
  const from = state.connectorName ?? 'the connector'
  throw new UnprocessableEntityError(
    state.pendingRelations.length > 0
      ? `Its data from ${from} is not complete yet. It issues when the sync links it.`
      : `Its refund is still pending at ${from}. It issues once the money settles.`,
    withWorkItemCode('MEMO_INPUT_INCOMPLETE', {
      detail: {
        ...(state.connectorName ? { connector: state.connectorName } : {}),
        ...(state.pendingRelations.length > 0 ? { pendingRelations: state.pendingRelations } : {}),
        ...(state.moneyPending ? { moneyPending: true } : {}),
      },
    })
  )
}
