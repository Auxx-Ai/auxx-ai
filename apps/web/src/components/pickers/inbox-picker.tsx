// apps/web/src/components/pickers/inbox-picker.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { useInbox } from '~/hooks/use-inbox'
import { cn } from '@auxx/ui/lib/utils'
import { MultiSelectPicker } from './multi-select-picker'
import { InboxDialog } from '~/components/inbox/inbox-dialog'
import type { InboxWithRelations } from '@auxx/lib/types'
import type { SelectOption } from '@auxx/types/custom-field'

/** Props for InboxPicker component */
interface InboxPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string[]
  onChange?: (selectedInboxes: string[]) => void
  allowMultiple?: boolean
  selectAll?: boolean
  selectAllLabel?: string
  className?: string
  inboxes?: InboxWithRelations[]
  children?: React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  style?: React.CSSProperties
}

/** Special value for "Select All" option */
export const INBOX_SELECT_ALL_VALUE = '__all__'

/**
 * InboxPicker
 * Popover-based picker for selecting inbox(es) using MultiSelectPicker.
 */
export function InboxPicker({
  open,
  onOpenChange,
  selected = [],
  onChange,
  allowMultiple = false,
  selectAll = false,
  selectAllLabel = 'Select all',
  className,
  inboxes: externalInboxes,
  children,
  ...props
}: InboxPickerProps) {
  // Fetch inboxes if not provided
  const { inboxes: fetchedInboxes } = useInbox()
  const inboxes = externalInboxes || fetchedInboxes || []

  // Dialog state for creating new inbox
  const [dialogOpen, setDialogOpen] = useState(false)

  // Convert inboxes to SelectOption format
  const options: SelectOption[] = useMemo(() => {
    const baseOptions = inboxes.map((inbox) => ({
      value: inbox.id,
      label: inbox.name,
      color: inbox.color || '#4F46E5',
    }))

    // Prepend "Select All" option if enabled
    if (allowMultiple && selectAll) {
      return [{ value: INBOX_SELECT_ALL_VALUE, label: selectAllLabel }, ...baseOptions]
    }

    return baseOptions
  }, [inboxes, allowMultiple, selectAll, selectAllLabel])

  // Handle selection change from MultiSelectPicker
  const handleChange = useCallback(
    (newSelected: string[]) => {
      const hadSelectAll = selected.includes(INBOX_SELECT_ALL_VALUE)
      const hasSelectAll = newSelected.includes(INBOX_SELECT_ALL_VALUE)

      if (hasSelectAll && !hadSelectAll) {
        // User just checked "Select All" - clear other selections
        onChange?.([INBOX_SELECT_ALL_VALUE])
      } else if (!hasSelectAll && hadSelectAll) {
        // User unchecked "Select All"
        onChange?.(newSelected.filter((id) => id !== INBOX_SELECT_ALL_VALUE))
      } else if (hadSelectAll && newSelected.length > 1) {
        // User selected individual item while "Select All" was checked
        onChange?.(newSelected.filter((id) => id !== INBOX_SELECT_ALL_VALUE))
      } else {
        onChange?.(newSelected)
      }
    },
    [selected, onChange]
  )

  // Handle single select (close popover)
  const handleSelectSingle = useCallback(
    (_value: string) => {
      onOpenChange?.(false)
    },
    [onOpenChange]
  )

  // Handle create button click
  const handleCreate = useCallback(() => {
    setDialogOpen(true)
  }, [])

  // Handle dialog success (optionally select the new inbox)
  const handleDialogSuccess = useCallback(
    (inbox: { id: string; name: string }) => {
      if (allowMultiple) {
        onChange?.([...selected.filter((id) => id !== INBOX_SELECT_ALL_VALUE), inbox.id])
      } else {
        onChange?.([inbox.id])
        onOpenChange?.(false)
      }
    },
    [allowMultiple, selected, onChange, onOpenChange]
  )

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          {children || <Button variant="outline">Select Inbox{allowMultiple ? 'es' : ''}</Button>}
        </PopoverTrigger>
        <PopoverContent
          className={cn('w-[300px] p-0 backdrop-blur-sm bg-popover/60', className)}
          {...props}>
          <MultiSelectPicker
            options={options}
            value={selected}
            onChange={handleChange}
            onSelectSingle={allowMultiple ? undefined : handleSelectSingle}
            placeholder="Search inboxes..."
            canManage={false}
            canAdd={false}
            multi={allowMultiple}
            onCreate={handleCreate}
            createLabel="Create inbox"
          />
        </PopoverContent>
      </Popover>

      {/* Inbox creation dialog */}
      {dialogOpen && (
        <InboxDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  )
}
