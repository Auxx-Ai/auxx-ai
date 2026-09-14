// apps/web/src/components/contacts/contact-orders-actions.tsx
'use client'

// The contact drawer's Orders section action.
//
// The second consumer of `RecordsBlockConfig.actionsComponent` after
// `ticket-returns-actions.tsx`, and deliberately the thinner half of it: an
// order is created, never linked. `order.contact` is required, so an existing
// order already names its buyer and "link" would only ever MOVE one off another
// customer — a data-repair operation, not a support one, and the record's own
// Contact row already does it with the correction visible.
//
// ⚠️ Like the returns seam, this is NOT generic. `BlockActionsProps` carries
// only the host `recordId` / `entityInstanceId` so nothing about the block
// config leaks in, which means the target definition and the preset attribute
// are hardcoded here. That is the documented cost of the seam.

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { BlockActionsProps } from '~/components/drawers/blocks/block-actions-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { getRecordStoreState } from '~/components/resources/store/record-store'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** Target definition slug. Resolved to the org's own definition id below. */
const ORDER_DEFINITION = 'order'

/** Forward field on the order pointing back at the host contact. */
const ORDER_CONTACT_ATTR = 'order_contact'

/** "Create order", rendered below the Orders rows on the contact drawer. */
export function ContactOrdersActions({ recordId }: BlockActionsProps) {
  const orderDefinitionId = useResourceProperty(ORDER_DEFINITION, 'id')
  const orderContactField = useSystemField(ORDER_CONTACT_ATTR, orderDefinitionId)
  const { canEditEntity } = useAccess()
  const openRecord = useOpenRecord()
  const utils = api.useUtils()

  const [isCreateOpen, setIsCreateOpen] = useState(false)

  /**
   * Re-query the order lists after a create.
   *
   * The block's source is `kind: 'query'`, so a new order only appears once the
   * server list is asked again — the create hook seeds the row's DATA but this
   * component holds no `listKey` to append it to, and the store cache would
   * otherwise serve the stale ids and keep the query disabled.
   */
  const refreshOrderLists = useCallback(() => {
    if (!orderDefinitionId) return
    getRecordStoreState().invalidateLists(orderDefinitionId)
    void utils.record.listFiltered.invalidate()
  }, [orderDefinitionId, utils])

  /**
   * Drill into the order that was just raised.
   *
   * An order with no line items is half a record and the generic create dialog
   * cannot write children, so landing in it is the difference between finishing
   * the job and leaving an empty order behind. `useOpenRecord` is null outside a
   * record stack, where this is simply a create with no drill.
   */
  const handleCreated = useCallback(
    (instanceId?: string) => {
      refreshOrderLists()
      if (!instanceId || !orderDefinitionId) return
      openRecord?.(toRecordId(orderDefinitionId, instanceId))
    },
    [refreshOrderLists, orderDefinitionId, openRecord]
  )

  /**
   * Seed the new order's `contact` with the host, keyed by FIELD ID and wrapped
   * in an array — the shape `EntityInstanceForm` applies. `order.contact` is
   * required, so an unseeded dialog would open with a validation error on a
   * field the user already answered by opening it from this contact.
   *
   * Keyed by `systemAttribute` instead, the form would accept it and
   * `record.create` would drop it, which is worse than no preset at all.
   */
  const presetValues = useMemo(
    () => (orderContactField?.id ? { [orderContactField.id]: [recordId] } : undefined),
    [orderContactField?.id, recordId]
  )

  // The action writes an `order`, so it needs write on that definition, never on
  // the contact. A viewer with read-only orders keeps the list.
  if (!orderDefinitionId || !canEditEntity(orderDefinitionId)) return null

  return (
    <div className='flex items-center gap-1 pt-1'>
      <Button variant='ghost' size='xs' onClick={() => setIsCreateOpen(true)}>
        <Plus />
        Create order
      </Button>

      <RecordEditorDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        entityDefinitionId={orderDefinitionId}
        presetValues={presetValues}
        onSaved={handleCreated}
      />
    </div>
  )
}

export default ContactOrdersActions
