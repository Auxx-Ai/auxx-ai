// apps/web/src/components/pickers/trigger-source/trigger-source-picker-popover.tsx
// Popover host for the shared trigger picker (unified-trigger-picker §2.2, popover variant).
// Owns the `useTriggerSources` query + the Popover; renders the presentational TriggerSourceList
// inside it. Mirrors apps/ui/connection-picker-popover.tsx. Two anchoring modes:
//   - `trigger`: an interactive element wrapped in PopoverTrigger (Radix manages open on click).
//   - `anchor`:  a positioning element wrapped in PopoverAnchor, with open driven by the caller
//                (e.g. an agent's "Add trigger" dropdown item that has no inline trigger).

'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { type ReactNode, useState } from 'react'
import { WebhookEndpointDialog } from '~/components/webhooks/ui/webhook-endpoint-dialog'
import { TriggerSourceList } from './trigger-source-picker'
import {
  type TriggerSource,
  type TriggerSurface,
  useTriggerSources,
  type WebhookEndpointSummary,
} from './use-trigger-sources'

interface TriggerSourcePickerPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (source: TriggerSource) => void
  surface?: TriggerSurface
  /** Restrict the APP group to one app (data-connector binds its connection's app). */
  appIdFilter?: string
  /** Marks the currently-bound row with a check. The caller owns the selection. */
  isSelected?: (source: TriggerSource) => boolean
  /** Where to link when the org has no endpoints yet (the "create" affordance). */
  manageEndpointsHref?: string
  /** Interactive anchor — wrapped in PopoverTrigger so a click toggles the popover. */
  trigger?: ReactNode
  /** Positioning-only anchor — wrapped in PopoverAnchor; the caller drives `open`. */
  anchor?: ReactNode
  align?: 'start' | 'center' | 'end'
  /** Match the popover width to the trigger (for full-width form fields). */
  matchTriggerWidth?: boolean
}

/**
 * Popover-wrapped {@link TriggerSourceList}. Picking a source fires `onSelect` and closes the
 * popover. Pass exactly one of `trigger` (PopoverTrigger) or `anchor` (PopoverAnchor).
 */
export function TriggerSourcePickerPopover({
  open,
  onOpenChange,
  onSelect,
  surface = 'agent',
  appIdFilter,
  isSelected,
  manageEndpointsHref,
  trigger,
  anchor,
  align = 'start',
  matchTriggerWidth = false,
}: TriggerSourcePickerPopoverProps) {
  const { appSources, endpointSources, isLoading } = useTriggerSources({ surface, appIdFilter })
  // Endpoint Edit (hover action) opens the shared endpoint config dialog — its `update` hook
  // invalidates `webhookEndpoint.list`, so the picker refreshes on save.
  const [editEndpoint, setEditEndpoint] = useState<WebhookEndpointSummary | null>(null)

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        {trigger && <PopoverTrigger asChild>{trigger}</PopoverTrigger>}
        {anchor && <PopoverAnchor asChild>{anchor}</PopoverAnchor>}
        <PopoverContentDialogAware
          className={cn(
            'p-0',
            matchTriggerWidth ? 'w-[var(--radix-popover-trigger-width)]' : 'w-80'
          )}
          align={align}>
          <TriggerSourceList
            appSources={appSources}
            endpointSources={endpointSources}
            isLoading={isLoading}
            isSelected={isSelected}
            manageEndpointsHref={manageEndpointsHref}
            onEditEndpoint={(endpoint) => {
              onOpenChange(false)
              setEditEndpoint(endpoint)
            }}
            onSelect={(s) => {
              onSelect(s)
              onOpenChange(false)
            }}
          />
        </PopoverContentDialogAware>
      </Popover>

      {editEndpoint && (
        <WebhookEndpointDialog
          open={!!editEndpoint}
          endpoint={editEndpoint}
          onClose={() => setEditEndpoint(null)}
        />
      )}
    </>
  )
}
