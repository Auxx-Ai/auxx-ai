// apps/web/src/components/inventory-bridge/ui/part-inventory-link-rows.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import { toastError } from '@auxx/ui/components/toast'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { parseRecordId } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface PartInventoryLinkRowsProps {
  /** The part's entityInstanceId (edit mode only — a link needs an existing part). */
  partId: string
  disabled?: boolean
}

/**
 * One FieldPanelRow per configured inventory source, valued from the part's
 * InventoryBridgeLinks: a standard relationship input scoped to the source def via the
 * provisioned source→part edge. Selecting a record links it (edge + watermark baselined to
 * the current level, mode `confirm`); deselecting unlinks. The auto/confirm toggle and
 * pending-delta Apply stay on the part console card — this row manages the link config only.
 * Renders nothing when the org has no configured source (provisioning lives in settings).
 */
export function PartInventoryLinkRows({ partId, disabled }: PartInventoryLinkRowsProps) {
  const { data: sources } = api.inventoryBridge.sources.useQuery()
  const { data: links } = api.inventoryBridge.linksForPart.useQuery(
    { partInstanceId: partId },
    { enabled: !!sources?.length }
  )
  const utils = api.useUtils()
  const invalidate = () =>
    void utils.inventoryBridge.linksForPart.invalidate({ partInstanceId: partId })

  const link = api.inventoryBridge.link.useMutation({
    onError: (e) =>
      toastError({ title: 'Failed to link inventory source', description: e.message }),
    onSuccess: invalidate,
  })
  const unlink = api.inventoryBridge.unlink.useMutation({
    onError: (e) =>
      toastError({ title: 'Failed to unlink inventory source', description: e.message }),
    onSuccess: invalidate,
  })

  if (!sources?.length) return null

  /** Diff the picker's next selection against the current links → link/unlink mutations. */
  const handleChange = (sourceDefId: string, current: RecordId[], next: unknown) => {
    const nextIds = Array.isArray(next) ? (next as RecordId[]) : next ? [next as RecordId] : []
    const currentSet = new Set(current)
    const nextSet = new Set(nextIds)
    for (const recordId of nextIds) {
      if (!currentSet.has(recordId)) {
        link.mutate({
          partInstanceId: partId,
          variantInstanceId: parseRecordId(recordId).entityInstanceId,
          sourceDefId,
          mode: 'confirm',
        })
      }
    }
    for (const recordId of current) {
      if (!nextSet.has(recordId)) {
        unlink.mutate({
          variantInstanceId: parseRecordId(recordId).entityInstanceId,
          sourceDefId,
        })
      }
    }
  }

  const busy = disabled || link.isPending || unlink.isPending

  return (
    <>
      {sources.map((source) => {
        const value = (links ?? [])
          .filter((l) => l.sourceDefId === source.sourceDefId)
          .map((l) => toRecordId(source.sourceDefId, l.variantInstanceId))
        return (
          <FieldPanelRow
            key={source.sourceDefId}
            title={source.defLabel}
            description={`Linked records deduct this part when ${source.fieldLabel} decreases`}
            type={BaseType.RELATION}
            showIcon>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={value}
              // The trigger's clear (X) fires onChange([]) → the diff below unlinks everything.
              triggerProps={{ className: 'ps-0 w-full pe-1', showClear: true }}
              onChange={(next) => handleChange(source.sourceDefId, value, next)}
              placeholder='Link a record'
              disabled={busy}
              fieldOptions={{
                // Synthetic part-side view of the provisioned source→part edge: the
                // inverse ref points at the source def, so the picker scopes to it.
                relationship: {
                  inverseResourceFieldId: toResourceFieldId(
                    source.sourceDefId,
                    source.relationshipFieldId
                  ),
                  relationshipType: 'has_many',
                  isInverse: true,
                },
              }}
            />
          </FieldPanelRow>
        )
      })}
    </>
  )
}
