// apps/web/src/app/(protected)/app/settings/snippets/_components/folder-form-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { X } from 'lucide-react'
import React from 'react'
import type { SnippetFolder } from '~/contexts/snippet-types'

/** Data submitted by the folder form */
export interface FolderFormData {
  name: string
  description: string
  parentId: string | null
}

interface FolderFormPopoverProps {
  /** If provided, popover is in edit mode with these initial values */
  folder?: SnippetFolder
  /** All available folders for parent selection */
  allFolders: SnippetFolder[]
  /** Called when form is submitted. Should throw on error to keep popover open. */
  onSubmit: (data: FolderFormData) => Promise<void>
  /** Whether the submit action is in progress */
  isLoading: boolean
  /** Custom trigger element - will be wrapped with PopoverTrigger */
  trigger: React.ReactNode
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
}

/**
 * Unified popover component for creating and editing snippet folders.
 * Mode is determined by whether a `folder` prop is provided.
 */
export function FolderFormPopover({
  folder,
  allFolders,
  onSubmit,
  isLoading,
  trigger,
  align = 'end',
}: FolderFormPopoverProps) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [parentId, setParentId] = React.useState<string | null>(null)

  const isEditMode = !!folder
  const title = isEditMode ? 'Edit Folder' : 'Create New Folder'
  const submitText = isEditMode ? 'Update' : 'Create'
  const loadingText = isEditMode ? 'Updating...' : 'Creating...'

  // Initialize/reset form when popover opens or folder changes
  React.useEffect(() => {
    if (open) {
      setName(folder?.name ?? '')
      setDescription(folder?.description ?? '')
      setParentId(folder?.parentId ?? null)
    }
  }, [open, folder])

  // Filter folders for parent selection
  const availableParentFolders = React.useMemo(() => {
    if (!isEditMode) return allFolders
    // In edit mode, exclude the current folder (can't be its own parent)
    return allFolders.filter((f) => f.id !== folder.id)
  }, [allFolders, folder, isEditMode])

  /** Handles form submission */
  const handleSubmit = async () => {
    try {
      await onSubmit({ name, description, parentId })
      setOpen(false)
    } catch {
      // Keep popover open on error - error handling done by parent
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className='w-60 p-1.5'
        align={align}
        onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className='mb-1 flex items-center justify-between'>
          <h3 className='ms-2 font-semibold text-sm'>{title}</h3>
          <Button
            variant='ghost'
            size='icon'
            className='size-6 rounded-full'
            onClick={() => setOpen(false)}>
            <X className='size-3' />
          </Button>
        </div>

        <div className='space-y-2'>
          <div className='space-y-2'>
            <label htmlFor='folderName' className='sr-only text-sm font-medium'>
              Folder Name
            </label>
            <Input
              id='folderName'
              placeholder='Enter folder name'
              size='sm'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <label htmlFor='parentFolder' className='sr-only text-sm font-medium'>
              Parent Folder (optional)
            </label>
            <Select
              value={parentId || 'none'}
              onValueChange={(val) => setParentId(val === 'none' ? null : val)}>
              <SelectTrigger id='parentFolder' className='w-full' size='sm'>
                <SelectValue placeholder='None (Root level)' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>None (Root level)</SelectItem>
                {availableParentFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='flex justify-end space-x-0.5 pt-2'>
            <Button variant='ghost' size='xs' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size='xs'
              variant='outline'
              onClick={handleSubmit}
              disabled={!name || isLoading}
              loading={isLoading}
              loadingText={loadingText}>
              {submitText}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
