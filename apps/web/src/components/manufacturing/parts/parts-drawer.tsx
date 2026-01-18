// apps/web/src/components/manufacturing/parts/parts-drawer.tsx
'use client'

import * as React from 'react'
import { Package, Trash, SquarePen, Expand } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useRecord } from '~/components/resources'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { EntityIcon } from '@auxx/ui/components/icons'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'
import { useRouter } from 'next/navigation'
import { parseRecordId } from '@auxx/lib/resources/client'
import type { RouterOutputs } from '~/trpc/react'
import type { RecordId } from '@auxx/types/resource'

/** Part type from the API */
type Part = NonNullable<RouterOutputs['part']['byId']>

/** Props for PartsDrawer component */
interface PartsDrawerProps {
  /** Whether the drawer is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** RecordId of the part to display */
  recordId: RecordId | null
  /** Handler for delete action */
  onDelete?: (partId: string) => Promise<void> | void
  /** Handler for edit action */
  onEdit?: (part: Part) => void
}

/**
 * PartsDrawer renders the right-side part detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 * Uses BaseEntityDrawer with registry-based configuration.
 */
export function PartsDrawer({ open, onOpenChange, recordId, onDelete, onEdit }: PartsDrawerProps) {
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Extract partId from recordId
  const partId = React.useMemo(
    () => (recordId ? parseRecordId(recordId).entityInstanceId : null),
    [recordId]
  )

  // Get record data for part-specific UI
  const { record } = useRecord({
    recordId: recordId ?? undefined,
    enabled: !!open && !!recordId,
  })
  const part = record as Part | undefined

  /** Handle close button click */
  const handleClose = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  if (!open || !recordId) return null

  return (
    <BaseEntityDrawer
      recordId={recordId}
      open={open}
      onOpenChange={onOpenChange}
      entityType="part"
      isDocked={isDocked}
      dockedWidth={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      onClose={handleClose}
      headerIcon={<EntityIcon iconId="package" color="orange" className="size-6" />}
      headerTitle="Part"
      headerActions={
        <>
          {part && onEdit && (
            <Tooltip content="Edit part">
              <Button variant="ghost" size="icon-xs" onClick={() => onEdit(part as Part)}>
                <SquarePen />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="View full page">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => router.push(`/app/parts?p=${partId}`)}>
              <Expand />
            </Button>
          </Tooltip>
          <Tooltip content="Delete part">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                if (onDelete && partId) {
                  void onDelete(partId)
                }
              }}>
              <Trash className="text-bad-500" />
            </Button>
          </Tooltip>
          <DockToggleButton />
        </>
      }
      cardContent={
        <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
          <div className="size-10 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
            <Package className="size-6 text-neutral-500 dark:text-foreground" />
          </div>
          <div className="flex flex-col align-start w-full">
            <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
              {part ? (
                part.title
              ) : (
                <Skeleton className="h-6 w-80 mb-1" />
              )}
            </div>
            <div className="text-xs text-neutral-500 truncate">
              {part ? (
                <>SKU: {part.sku}</>
              ) : (
                <Skeleton className="h-4 w-40" />
              )}
            </div>
          </div>
        </div>
      }
    />
  )
}
