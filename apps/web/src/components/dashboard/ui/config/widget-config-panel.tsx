// apps/web/src/components/dashboard/ui/config/widget-config-panel.tsx
'use client'

// The widget-config drawer (plan 07): a DockableDrawer (docked panel or overlay)
// with a DrawerHeader whose title is an inline-editable Input (base-panel style),
// a 3-dot Duplicate / Delete menu + dock toggle in the header, and a per-kind
// config body. Reads the selected draft widget from the store and writes every
// change back immediately (`updateWidget` / `updateWidgetConfig`) so the grid
// live-previews. Sections in the body sit flush — each owns its padding + border.

import {
  droppedFieldsOnConvert,
  isDataWidget,
  WIDGET_KIND_LABELS,
  type WidgetKind,
} from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Copy, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useConfirm } from '~/hooks/use-confirm'
import { selectWidget, useDashboardStore } from '../../stores/dashboard-draft-store'
import { AddWidgetMenu, WIDGET_KIND_ICONS } from './add-widget-menu'
import { WidgetConfigBody } from './widget-config-bodies'

export function WidgetConfigPanel({
  widgetId,
  open,
  onOpenChange,
  onClose,
  onSelectWidget,
  onAddWidget,
  isDocked,
  dockedWidth,
  onWidthChange,
  minWidth,
  maxWidth,
}: {
  widgetId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  /** Focus another widget (e.g. after Duplicate). */
  onSelectWidget: (id: string) => void
  /** Add a widget from the panel's empty state (mirrors the header's menu). */
  onAddWidget?: (kind: WidgetKind) => void
  isDocked: boolean
  dockedWidth: number
  onWidthChange: (width: number) => void
  minWidth: number
  maxWidth: number
}) {
  const widget = useDashboardStore(selectWidget(widgetId))
  const updateWidget = useDashboardStore((s) => s.updateWidget)
  const updateWidgetConfig = useDashboardStore((s) => s.updateWidgetConfig)
  const changeWidgetType = useDashboardStore((s) => s.changeWidgetType)
  const duplicateWidget = useDashboardStore((s) => s.duplicateWidget)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const [confirm, ConfirmDialog] = useConfirm()

  if (!open) return null

  // Empty state: the panel stays mounted across edit mode (no layout shift when a
  // widget is deselected), so with nothing selected it prompts to pick or add one.
  if (!widget) {
    return (
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={onWidthChange}
        minWidth={minWidth}
        maxWidth={maxWidth}
        title='Widget'>
        <DrawerHeader
          title={<span className='px-1 text-sm font-medium text-muted-foreground'>Widget</span>}
          actions={<DockToggleButton />}
        />
        <div className='flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center'>
          <p className='text-sm text-muted-foreground'>Select a widget to configure it.</p>
          {onAddWidget && (
            <>
              <span className='text-xs text-muted-foreground'>or</span>
              <AddWidgetMenu onAdd={onAddWidget} align='center' />
            </>
          )}
        </div>
      </DockableDrawer>
    )
  }

  const Icon = WIDGET_KIND_ICONS[widget.type]
  const kindLabel = WIDGET_KIND_LABELS[widget.type]

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete widget?',
      description: `"${widget.title}" will be removed.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) {
      removeWidget(widget.id)
      onClose()
    }
  }

  const handleChangeType = async (toKind: WidgetKind) => {
    if (toKind === widget.type) return
    const dropped = droppedFieldsOnConvert(widget.configuration, toKind)
    if (dropped.length > 0) {
      const ok = await confirm({
        title: 'Change widget type?',
        description: `Switching to ${WIDGET_KIND_LABELS[toKind]} will remove: ${dropped.join(', ')}.`,
        confirmText: 'Change',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!ok) return
    }
    changeWidgetType(widget.id, toKind)
  }

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={onWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title={widget.title || kindLabel}>
      <ConfirmDialog />
      <DrawerHeader
        icon={<Icon className='size-4 text-muted-foreground' />}
        title={
          <Input
            variant='transparent'
            value={widget.title}
            onChange={(e) => updateWidget(widget.id, { title: e.target.value })}
            placeholder={kindLabel}
            className='h-7 w-full min-w-0 appearance-none rounded-md border border-transparent px-1 text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus:shadow-xs'
          />
        }
        onClose={onClose}
        actions={
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='rounded-full'
                  aria-label='Widget actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-44'>
                {isDataWidget(widget.configuration) && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <RefreshCw /> Change type
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className='w-64'>
                      <AddWidgetMenu
                        variant='inline'
                        onAdd={handleChangeType}
                        filterKind={(k) => k !== 'richText' && k !== 'iframe'}
                        currentKind={widget.type}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    const id = duplicateWidget(widget.id)
                    if (id) onSelectWidget(id)
                  }}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={handleDelete}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DockToggleButton />
          </>
        }
      />

      <ScrollArea className='min-h-0 flex-1'>
        <WidgetConfigBody
          config={widget.configuration}
          onChange={(config) => updateWidgetConfig(widget.id, config)}
        />
      </ScrollArea>
    </DockableDrawer>
  )
}
