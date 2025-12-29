// apps/web/src/components/manufacturing/parts/parts-drawer.tsx
'use client'

import * as React from 'react'
import { HouseIcon, Layers, Truck, Package, Trash, SquarePen } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { api, type RouterOutputs } from '~/trpc/react'
import { useQueryState } from 'nuqs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { EntityIcon } from '~/components/pickers/icon-picker'
import { PartsDrawerOverview } from './parts-drawer-overview'
import { PartsDrawerSubparts } from './parts-drawer-subparts'
import { PartsDrawerVendors } from './parts-drawer-vendors'

/** Part type from the API */
type Part = NonNullable<RouterOutputs['part']['byId']>

// Memoized tab content components
const MemoPartsDrawerOverview = React.memo(PartsDrawerOverview)
const MemoPartsDrawerSubparts = React.memo(PartsDrawerSubparts)
const MemoPartsDrawerVendors = React.memo(PartsDrawerVendors)

/** Props for PartsDrawer component */
interface PartsDrawerProps {
  /** Whether the drawer is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** ID of the part to display */
  partId: string | null
  /** Handler for delete action */
  onDelete?: (partId: string) => Promise<void> | void
  /** Handler for edit action */
  onEdit?: (part: Part) => void
}

/**
 * PartsDrawer renders the right-side part detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 */
export function PartsDrawer({ open, onOpenChange, partId, onDelete, onEdit }: PartsDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })

  // Fetch part data
  const { data: part, isLoading } = api.part.byId.useQuery(
    { id: partId! },
    { enabled: !!open && !!partId }
  )

  /** Handle close button click */
  const handleClose = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  if (!open || !partId) return null

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      title="Part Details">
      <PartsDrawerContent
        partId={partId}
        part={part}
        isLoading={isLoading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onDelete={onDelete}
        onEdit={onEdit}
        onClose={handleClose}
      />
    </DockableDrawer>
  )
}

/** Props for PartsDrawerContent */
interface PartsDrawerContentProps {
  partId: string
  part: Part | null | undefined
  isLoading: boolean
  activeTab: string
  onTabChange: (tab: string) => void
  onDelete?: (partId: string) => Promise<void> | void
  onEdit?: (part: Part) => void
  onClose: () => void
}

/** Inner content component for PartsDrawer */
function PartsDrawerContent({
  partId,
  part,
  isLoading,
  activeTab,
  onTabChange,
  onDelete,
  onEdit,
  onClose,
}: PartsDrawerContentProps) {
  return (
    <>
      <DrawerHeader
        icon={<EntityIcon iconId="package" color="orange" className="size-6" />}
        title="Part"
        onClose={onClose}
        actions={
          <>
            {part && onEdit && (
              <Tooltip content="Edit part">
                <Button variant="ghost" size="icon-xs" onClick={() => onEdit(part as Part)}>
                  <SquarePen />
                </Button>
              </Tooltip>
            )}
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
      />
      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full h-full">
          <div className="w-full h-full flex gap-0">
            <div className="w-full h-full flex flex-col overflow-auto justify-start">
              <OverflowTabsList
                tabs={[
                  { value: 'overview', label: 'Overview', icon: HouseIcon },
                  { value: 'subparts', label: 'Subparts', icon: Layers },
                  { value: 'vendors', label: 'Vendors', icon: Truck },
                ]}
                value={activeTab}
                onValueChange={onTabChange}
                variant="outline"
              />
              {/* Part Card */}
              <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
                <div className="size-10 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
                  <Package className="size-6 text-neutral-500 dark:text-foreground" />
                </div>
                <div className="flex flex-col align-start w-full">
                  <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
                    {part ? (
                      part.title
                    ) : isLoading ? (
                      <div className="mb-1">
                        <Skeleton className="h-6 w-80" />
                      </div>
                    ) : (
                      'Part not found'
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {part ? (
                      <>SKU: {part.sku}</>
                    ) : isLoading ? (
                      <Skeleton className="h-4 w-40" />
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-1 overflow-hidden">
                <TabsContent value="overview" className="w-full overflow-y-auto">
                  <MemoPartsDrawerOverview partId={partId} part={part} isLoading={isLoading} />
                </TabsContent>
                <TabsContent value="subparts" className="w-full overflow-y-auto">
                  <MemoPartsDrawerSubparts partId={partId} part={part} isLoading={isLoading} />
                </TabsContent>
                <TabsContent value="vendors" className="w-full overflow-y-auto">
                  <MemoPartsDrawerVendors partId={partId} part={part} isLoading={isLoading} />
                </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </>
  )
}
