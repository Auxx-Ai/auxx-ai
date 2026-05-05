// apps/web/src/components/editor/kb-article/tab-edit-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Field } from '@auxx/ui/components/field'
import { InputGroup, InputGroupInput } from '@auxx/ui/components/input-group'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { useEffect, useState } from 'react'

interface TabEditPopoverProps {
  initialLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (label: string) => void
  onDelete?: () => void
  /** The element the popover anchors to — typically the tab button. */
  children: React.ReactNode
}

export function TabEditPopover({
  initialLabel,
  open,
  onOpenChange,
  onChange,
  onDelete,
  children,
}: TabEditPopoverProps) {
  const [label, setLabel] = useState(initialLabel)

  useEffect(() => {
    if (open) setLabel(initialLabel)
  }, [open, initialLabel])

  const persistAndClose = () => {
    const next = label.trim()
    if (next !== initialLabel) onChange(next)
    onOpenChange(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) persistAndClose()
        else onOpenChange(true)
      }}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align='start'
        sideOffset={8}
        className='w-72 space-y-3 p-3'
        onOpenAutoFocus={(e) => {
          // Prevent shifting focus to the popover root; we autofocus the input directly.
          e.preventDefault()
          requestAnimationFrame(() => {
            const input = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
              'input[data-tab-label-input]'
            )
            input?.focus()
            input?.select()
          })
        }}>
        <Field>
          <InputGroup>
            <InputGroupInput
              data-tab-label-input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  persistAndClose()
                }
              }}
              placeholder='Tab title'
            />
          </InputGroup>
        </Field>

        <div className='flex justify-between gap-2 pt-1'>
          {onDelete ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                onOpenChange(false)
                onDelete()
              }}
              className='text-destructive hover:text-destructive'>
              Delete tab
            </Button>
          ) : (
            <span />
          )}
          <Button type='button' variant='outline' size='sm' onClick={persistAndClose}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
