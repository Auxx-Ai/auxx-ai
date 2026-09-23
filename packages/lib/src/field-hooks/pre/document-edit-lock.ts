// packages/lib/src/field-hooks/pre/document-edit-lock.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import {
  DOCUMENT_EDIT_REFUSED_IN,
  DOCUMENT_OPEN_STATUSES,
  type LockedDocumentFamily,
  readDocumentLockState,
} from '../../accounting/documents/edit-in-place/lock-state'
import { getOrgCache } from '../../cache'
import { readEditStamp } from '../../entity-instances/edit-snapshot'
import { ConflictError } from '../../errors'
import { getAmbientWriteSession } from '../../resources/crud/write-session-als'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type {
  EntityPreCreateHandler,
  EntityPreDeleteHandler,
  FieldPreHookEvent,
  FieldPreHookHandler,
} from '../types'

/**
 * The quote, purchase order and order lock (66 U5/U7): the `invoice-lock.ts` rule
 * — not open AND no edit-snapshot row — for the three families with no ledger.
 * Totals are absent from every list: the totals engine is their only writer.
 */
export const DOCUMENT_EDIT_LOCKS = {
  quote: {
    headerSlug: 'quotes',
    headerAttrs: [
      'quote_contact',
      'quote_valid_until',
      'quote_discount_type',
      'quote_discount_value',
      'quote_tax_name',
      'quote_tax_rate',
      'quote_deposit_type',
      'quote_deposit_value',
    ],
    lineSlug: 'line-items',
    lineParentAttr: 'line_item_quote',
    lineAttrs: [
      'line_item_qty',
      'line_item_unit_price',
      'line_item_taxable',
      'line_item_discount',
      'line_item_optional',
      'line_item_quote',
    ],
  },
  order: {
    headerSlug: 'orders',
    headerAttrs: [
      'order_contact',
      'order_company',
      'order_placed_at',
      'order_currency',
      'order_discount_type',
      'order_discount_value',
      'order_tax_name',
      'order_tax_rate',
    ],
    lineSlug: 'line-items',
    lineParentAttr: 'line_item_order',
    lineAttrs: [
      'line_item_qty',
      'line_item_unit_price',
      'line_item_taxable',
      'line_item_discount',
      'line_item_order',
    ],
  },
  purchase_order: {
    headerSlug: 'purchase-orders',
    headerAttrs: [
      'purchase_order_vendor',
      'purchase_order_currency',
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
    ],
    lineSlug: 'purchase-order-lines',
    lineParentAttr: 'purchase_order_line_purchase_order',
    lineAttrs: [
      'purchase_order_line_part',
      'purchase_order_line_quantity_ordered',
      'purchase_order_line_expected_unit_price',
      'purchase_order_line_purchase_order',
    ],
  },
} as const satisfies Record<
  LockedDocumentFamily,
  {
    headerSlug: string
    headerAttrs: readonly SystemAttribute[]
    lineSlug: string
    lineParentAttr: SystemAttribute
    lineAttrs: readonly SystemAttribute[]
  }
>

const FAMILIES = Object.keys(DOCUMENT_EDIT_LOCKS) as LockedDocumentFamily[]

const NOUN: Record<LockedDocumentFamily, string> = {
  quote: 'Quote',
  purchase_order: 'Purchase order',
  order: 'Order',
}

/** The families whose lines live on one line definition — `line-items` carries two. */
export function familiesForLineSlug(lineSlug: string): LockedDocumentFamily[] {
  return FAMILIES.filter((family) => DOCUMENT_EDIT_LOCKS[family].lineSlug === lineSlug)
}

/**
 * Every field hook of one write shares its `allValues` map, so a create's six
 * guarded fields decide once, not six times.
 */
const decisionsByWrite = new WeakMap<object, Map<string, Promise<void>>>()

/** One header field of a locked document. */
export function guardDocumentFields(family: LockedDocumentFamily): FieldPreHookHandler {
  return async (event) => {
    if (isExemptWrite()) return event.newValue
    const instanceId = parseRecordId(event.recordId).entityInstanceId
    await decideOnce(event, family, instanceId, 'change it')
    return event.newValue
  }
}

/** One line field, through the line's parent: one read covers every family on the def. */
export function guardDocumentLineFields(lineSlug: string): FieldPreHookHandler {
  const families = familiesForLineSlug(lineSlug)
  return async (event) => {
    if (isExemptWrite()) return event.newValue
    const parent = await readLineParent(families, event)
    if (!parent) return event.newValue
    const guarded: readonly string[] = DOCUMENT_EDIT_LOCKS[parent.family].lineAttrs
    if (!guarded.includes(event.systemAttribute)) return event.newValue
    await decideOnce(event, parent.family, parent.instanceId, 'change a line')
    return event.newValue
  }
}

/** A locked document gains no lines. */
export function guardDocumentLineCreate(lineSlug: string): EntityPreCreateHandler {
  const families = familiesForLineSlug(lineSlug)
  return async (event) => {
    if (isExemptWrite()) return
    // Keyed by system attribute, as `invoice-lock.ts` reads it; a field-id keyed
    // parent still meets the field hook on the link itself.
    for (const family of families) {
      const parentId = unwrapRelationId(event.values[DOCUMENT_EDIT_LOCKS[family].lineParentAttr])
      if (parentId) await refuseWhenLocked(family, event.organizationId, parentId, 'add a line')
    }
  }
}

/** And loses none — unless the document itself is being deleted, which its own guard decides. */
export function guardDocumentLineDelete(lineSlug: string): EntityPreDeleteHandler {
  const families = familiesForLineSlug(lineSlug)
  return async (event) => {
    if (event.cascaded || isExemptWrite()) return
    for (const family of families) {
      const parentId = unwrapRelationId(event.values[DOCUMENT_EDIT_LOCKS[family].lineParentAttr])
      if (parentId) await refuseWhenLocked(family, event.organizationId, parentId, 'remove a line')
    }
  }
}

/**
 * Only a person is refused: a sync, an automation and a seed pass, as in
 * `field-values/write-guard.ts` — Shopify is the author of a synced order.
 * Checked before any query, so a sync pays nothing.
 */
function isExemptWrite(): boolean {
  const origin = getAmbientWriteSession()?.origin.kind
  return origin === 'sync' || origin === 'automation' || origin === 'seed'
}

function decideOnce(
  event: FieldPreHookEvent,
  family: LockedDocumentFamily,
  instanceId: string,
  what: string
): Promise<void> {
  let decisions = decisionsByWrite.get(event.allValues)
  if (!decisions) {
    decisions = new Map()
    decisionsByWrite.set(event.allValues, decisions)
  }
  const key = `${family}:${instanceId}`
  let decision = decisions.get(key)
  if (!decision) {
    decision = refuseWhenLocked(family, event.organizationId, instanceId, what)
    decisions.set(key, decision)
  }
  return decision
}

async function refuseWhenLocked(
  family: LockedDocumentFamily,
  organizationId: string,
  instanceId: string,
  what: string
): Promise<void> {
  const state = await readDocumentLockState(database, organizationId, family, instanceId)
  if (!state || DOCUMENT_OPEN_STATUSES[family].includes(state.status)) return
  if (await readEditStamp(database, organizationId, instanceId)) return

  const noun = state.label ? `${NOUN[family]} ${state.label}` : NOUN[family]
  const message =
    state.status === 'synced'
      ? `${noun} is managed by its sales channel, so you cannot ${what} here. Edit it in the ` +
        'channel and the next sync brings the change in.'
      : `${noun} is ${state.status.replace(/_/g, ' ')}, so you cannot ${what}.` +
        (DOCUMENT_EDIT_REFUSED_IN[family].includes(state.status)
          ? ''
          : ' Press Edit to unlock it, then Save.')
  throw new ConflictError(message, { family, instanceId, status: state.status })
}

/**
 * The locked document a line belongs to. A create carries its parent in the
 * write itself; an update reads every family's parent link in one query.
 */
async function readLineParent(
  families: readonly LockedDocumentFamily[],
  event: FieldPreHookEvent
): Promise<{ family: LockedDocumentFamily; instanceId: string } | undefined> {
  const parentAttrs = families.map((family) => DOCUMENT_EDIT_LOCKS[family].lineParentAttr)
  const fields = await getOrgCache()
    .from(event.organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>(parentAttrs)
  const familyByFieldId = new Map<string, LockedDocumentFamily>()
  for (const family of families) {
    const id = fields[DOCUMENT_EDIT_LOCKS[family].lineParentAttr]?.id
    if (id) familyByFieldId.set(id, family)
  }
  if (familyByFieldId.size === 0) return undefined

  for (const [fieldId, family] of familyByFieldId) {
    const inWrite = unwrapRelationId(event.allValues.get(fieldId))
    if (inWrite) return { family, instanceId: inWrite }
  }

  const lineId = parseRecordId(event.recordId).entityInstanceId
  const [row] = await database
    .select({
      fieldId: schema.FieldValue.fieldId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, event.organizationId),
        eq(schema.FieldValue.entityId, lineId),
        inArray(schema.FieldValue.fieldId, [...familyByFieldId.keys()])
      )
    )
    .limit(1)
  const family = row && familyByFieldId.get(row.fieldId)
  return family && row.relatedEntityId ? { family, instanceId: row.relatedEntityId } : undefined
}
