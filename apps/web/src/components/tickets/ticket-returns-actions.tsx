// apps/web/src/components/tickets/ticket-returns-actions.tsx
'use client'

// The ticket drawer's Returns section actions (plans/money/tasks/54-returns.md §4).
//
// 🔑 The FIRST consumer of `RecordsBlockConfig.actionsComponent`. Every other
// "list with an Add button" in the product is a bespoke `CardBlock`; this one is
// a pure-config `records` block plus this component, named in
// `block-actions-registry.tsx`.
//
// The owner's instruction was "no new buttons": a return arrives as an email or
// a call, both of which already become a ticket, so the ticket drawer is the
// creation door and this is the only surface that opens it - `ticket.returns`
// stays `showInPanel: false` and `return.ticket` stays `showInDialogs: false`.
//
// ⚠️ Deliberately NOT generic. `BlockActionsProps` carries only the host
// `recordId` / `entityInstanceId` so nothing about the block config leaks in,
// which means the target definition, the inverse attribute and the two labels
// are hardcoded here. That is the documented cost of the seam, not an oversight.
//
// Both halves reuse existing machinery, the same pair `relationship-input-field.tsx`
// wires up for a panel relationship row:
//   - create → `RecordEditorDialog`, with the host ticket preset onto
//     `return_ticket` exactly as `computePresetValues()` would have.
//   - link   → `RecordPicker`, writing `return_ticket` on the PICKED return
//     through the same `fieldValue.set` door the Details panel uses.

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Link2, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { BlockActionsProps } from '~/components/drawers/blocks/block-actions-registry'
import { RecordPicker } from '~/components/pickers/record-picker'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { getRecordStoreState } from '~/components/resources/store/record-store'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** Target definition slug. Resolved to the org's own definition id below. */
const RETURN_DEFINITION = 'return'

/** Forward field on the return pointing back at the host ticket. */
const RETURN_TICKET_ATTR = 'return_ticket'

/** The host's inverse mirror, read only to keep the picker from offering a no-op. */
const TICKET_RETURNS_ATTRS = ['ticket_returns'] as const

/**
 * The picker is a link affordance, not a value editor: the linked returns are
 * the rows above it, so it opens empty every time. Module-level because a fresh
 * `[]` per render re-keys the picker's mount snapshot.
 */
const NO_SELECTION: RecordId[] = []

/** Single-select links through `onSelectSingle`; the array form is unused. */
function noopOnChange() {}

/**
 * "Create return" / "Link existing return", rendered below the Returns rows on
 * the ticket drawer.
 *
 * 🔑 Renders after the `EmptyRow` as well as after a populated list, which is
 * the case that matters: a ticket with no return yet is exactly where the
 * warehouse raises one.
 */
export function TicketReturnsActions({ recordId }: BlockActionsProps) {
  const returnDefinitionId = useResourceProperty(RETURN_DEFINITION, 'id')
  const returnTicketField = useSystemField(RETURN_TICKET_ATTR, returnDefinitionId)
  const { canEditEntity } = useAccess()
  const openRecord = useOpenRecord()
  const utils = api.useUtils()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  // Returns already on this ticket, so picking one cannot be a silent no-op.
  // The mirror is the cheap read here (no server round trip of its own); the
  // ROWS above come from the block's `kind: 'query'` source, which is what
  // gives them an order and a bound.
  const { values } = useSystemValues(recordId, TICKET_RETURNS_ATTRS, { autoFetch: true })
  const linkedRecordIds = useMemo(
    () => extractRelationshipRecordIds(values.ticket_returns),
    [values.ticket_returns]
  )

  /**
   * Re-query the return lists after a create or a link.
   *
   * The block's source is `kind: 'query'`, so a new (or newly matching) return
   * only appears once the server list is asked again - the create hook seeds the
   * row's DATA but this component holds no `listKey` to append it to, and the
   * store cache would otherwise serve the stale ids and keep the query disabled.
   * Same two calls the global create surface makes for the same reason.
   */
  const refreshReturnLists = useCallback(() => {
    if (!returnDefinitionId) return
    getRecordStoreState().invalidateLists(returnDefinitionId)
    void utils.record.listFiltered.invalidate()
  }, [returnDefinitionId, utils])

  const { saveFieldValue, isPending } = useSaveFieldValue({ onSuccess: refreshReturnLists })

  /**
   * Drill into the return that was just raised.
   *
   * A return is only half a record until it carries its returned lines, and the
   * generic create dialog cannot write children - so landing in the new record
   * is the difference between the creation route finishing the job and leaving
   * an empty RMA behind. `useOpenRecord` is null outside a record stack (the
   * detail page's sidebar mounts the same blocks), where this is simply a
   * create with no drill.
   */
  const handleCreated = useCallback(
    (instanceId?: string) => {
      refreshReturnLists()
      if (!instanceId || !returnDefinitionId) return
      openRecord?.(toRecordId(returnDefinitionId, instanceId))
    },
    [refreshReturnLists, returnDefinitionId, openRecord]
  )

  /**
   * Link an existing return by writing its OWN `ticket` field.
   *
   * The FK is on the return (`return.ticket` belongs_to → `ticket.returns`), so
   * the write lands on the picked record, never on the ticket. The inverse
   * mirror is maintained server-side and announces its own rewrite.
   *
   * ⚠️ `return.ticket` is belongs_to, so linking a return that already names a
   * different ticket MOVES it. Returns arrive one-per-conversation, and the
   * mirror read above removes this ticket's own returns from the list, so the
   * case is rare; it is not warned about the way `product-variant-link-dialog`
   * warns about moving a part between families.
   */
  const handleLink = useCallback(
    (picked: RecordId) => {
      saveFieldValue(picked, RETURN_TICKET_ATTR, recordId, FieldType.RELATIONSHIP)
      setIsPickerOpen(false)
    },
    [recordId, saveFieldValue]
  )

  /**
   * Seed the new return's `ticket` with the host, keyed by FIELD ID - the shape
   * `EntityInstanceForm` applies. `return_ticket` is `showInDialogs: false`, so
   * the row is not rendered and the preset rides through untouched: presets are
   * merged into the form's values regardless of field visibility, and create
   * posts the whole map to `record.create`.
   *
   * That is also what makes §4.2 fire. `record.create` runs the system pre-hook
   * chain, where `deriveContactFromTicket` is registered under `return_ticket`
   * and fills `return_contact` from the ticket's customer.
   */
  const presetValues = useMemo(
    () => (returnTicketField?.id ? { [returnTicketField.id]: [recordId] } : undefined),
    [returnTicketField?.id, recordId]
  )

  // Both actions write a `return`, so both need write on that definition,
  // never on the ticket. A viewer with read-only returns keeps the list.
  if (!returnDefinitionId || !canEditEntity(returnDefinitionId)) return null

  return (
    <div className='flex items-center gap-1 pt-1'>
      <Button variant='ghost' size='xs' onClick={() => setIsCreateOpen(true)}>
        <Plus />
        Create return
      </Button>

      <RecordPicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        value={NO_SELECTION}
        onChange={noopOnChange}
        onSelectSingle={handleLink}
        multi={false}
        entityDefinitionId={returnDefinitionId}
        excludeIds={linkedRecordIds}
        placeholder='Search returns...'>
        <Button variant='ghost' size='xs' loading={isPending} loadingText='Linking...'>
          <Link2 />
          Link existing return
        </Button>
      </RecordPicker>

      <RecordEditorDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        entityDefinitionId={returnDefinitionId}
        presetValues={presetValues}
        onSaved={handleCreated}
      />
    </div>
  )
}

export default TicketReturnsActions
