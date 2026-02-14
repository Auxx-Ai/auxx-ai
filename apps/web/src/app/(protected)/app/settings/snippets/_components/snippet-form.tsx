'use client'
import { SnippetSharingType as SnippetSharingTypeEnum } from '@auxx/database/enums'
import type { SnippetSharingType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { FolderIcon, Save, ShareIcon, UserIcon, UsersIcon } from 'lucide-react'
import React from 'react'
import { useForm } from 'react-hook-form'
import { api } from '~/trpc/react'
// Import the SnippetPlaceholder component
import { SnippetPlaceholder } from './snippet-placeholder'
import { SnippetSharing } from './snippet-sharing'

interface FormValues {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType: SnippetSharingType
}
interface SnippetFormProps {
  snippetId?: string
  initialValues?: Partial<FormValues>
  onSuccess?: () => void
  onCancel?: () => void
}
export function SnippetForm({ snippetId, initialValues, onSuccess, onCancel }: SnippetFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
  } = useForm<FormValues>({
    defaultValues: {
      title: initialValues?.title || '',
      content: initialValues?.content || '',
      contentHtml: initialValues?.contentHtml || '',
      description: initialValues?.description || '',
      folderId: initialValues?.folderId || null,
      sharingType: initialValues?.sharingType || SnippetSharingTypeEnum.PRIVATE,
    },
  })
  const utils = api.useUtils()
  const [isContentFocused, setIsContentFocused] = React.useState(false)
  const [isSharingDialogOpen, setIsSharingDialogOpen] = React.useState(false)
  // Get form values for sharing dialog
  const sharingType = watch('sharingType')
  // Get folders
  const { data: folderData } = api.snippet.getFolders.useQuery()
  // Create snippet mutation
  const createMutation = api.snippet.create.useMutation({
    onSuccess: (data) => {
      toastSuccess({
        title: 'Snippet created',
        description: 'Your snippet has been created successfully',
      })
      // Ensure snippet table and folder counts refresh
      utils.snippet.all.invalidate()
      utils.snippet.getFolders.invalidate()
      if (onSuccess) onSuccess()
    },
    onError: (error) => {
      toastError({ title: 'Error creating snippet', description: error.message })
    },
  })
  // Update snippet mutation
  const updateMutation = api.snippet.update.useMutation({
    onSuccess: (data) => {
      toastSuccess({
        title: 'Snippet updated',
        description: 'Your snippet has been updated successfully',
      })
      // Ensure snippet table and folder counts refresh
      utils.snippet.all.invalidate()
      utils.snippet.getFolders.invalidate()
      if (onSuccess) onSuccess()
    },
    onError: (error) => {
      toastError({ title: 'Error updating snippet', description: error.message })
    },
  })
  // Handle form submission
  const onSubmit = (data: FormValues) => {
    // Normalize folder selection: treat "None" as no folder
    if (data.folderId === 'none' || data.folderId === '') {
      data.folderId = null
    }
    if (snippetId) {
      updateMutation.mutate({ id: snippetId, ...data })
    } else {
      createMutation.mutate(data)
    }
  }
  // Handle placeholder insertion
  const handleInsertPlaceholder = (placeholder: string) => {
    const contentField = document.getElementById('content') as HTMLTextAreaElement
    if (!contentField) return
    const start = contentField.selectionStart
    const end = contentField.selectionEnd
    const currentContent = contentField.value
    const newContent =
      currentContent.substring(0, start) + placeholder + currentContent.substring(end)
    setValue('content', newContent, { shouldDirty: true })
    // Set cursor position after the inserted placeholder
    setTimeout(() => {
      contentField.focus()
      contentField.setSelectionRange(start + placeholder.length, start + placeholder.length)
    }, 0)
  }
  // Handle content changes (e.g., from rich text editor if implemented)
  const handleContentChange = (content: string, html?: string) => {
    setValue('content', content, { shouldDirty: true })
    if (html) setValue('contentHtml', html, { shouldDirty: true })
  }
  const share = api.snippet.share.useMutation()
  // Handle sharing dialog
  const handleShareSettings = (
    type: SnippetSharingType,
    shares?: {
      groupId?: string
      memberId?: string
      permission: 'VIEW' | 'EDIT'
    }[]
  ) => {
    setValue('sharingType', type, { shouldDirty: true })
    if (snippetId) {
      // If editing existing snippet, update sharing settings
      share.mutate(
        { snippetId, sharingType: type, shares: shares },
        {
          onSuccess: () => {
            toastSuccess({
              title: 'Sharing updated',
              description: 'Sharing settings have been updated',
            })
            setIsSharingDialogOpen(false)
            utils.snippet.all.invalidate()
          },
          onError: (error) => {
            toastError({ title: 'Error updating sharing', description: error.message })
          },
        }
      )
    } else {
      // Just update the form value if creating new snippet
      setIsSharingDialogOpen(false)
    }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
      <div className='space-y-4'>
        <div className='flex flex-col space-y-2'>
          <Label htmlFor='title'>Title</Label>
          <Input
            id='title'
            {...register('title', { required: 'Title is required' })}
            className={cn(errors.title && 'border-red-500')}
          />
          {errors.title && <p className='mt-1 text-sm text-red-500'>{errors.title.message}</p>}
        </div>

        {/* <div>
          <Label htmlFor='description'>Description (optional)</Label>
          <Input id='description' {...register('description')} />
        </div> */}

        <div className='flex flex-col space-y-2'>
          <Label htmlFor='folder'>Folder (optional)</Label>
          <Select
            defaultValue={watch('folderId') || ''}
            onValueChange={(value) =>
              setValue('folderId', value === 'none' || value === '' ? null : value, {
                shouldDirty: true,
              })
            }>
            <SelectTrigger>
              <SelectValue placeholder='Select a folder' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>None</SelectItem>
              {folderData?.folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  <div className='flex items-center'>
                    <FolderIcon size={14} className='mr-2' />
                    {folder.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='relative flex flex-col space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='content'>Content</Label>
            {/* {isContentFocused && ( */}
            <div className='absolute right-2 bottom-2'>
              <SnippetPlaceholder onInsert={handleInsertPlaceholder} />
            </div>
            {/* )} */}
          </div>
          <Textarea
            id='content'
            {...register('content', { required: 'Content is required' })}
            className={cn('h-60 font-mono text-sm', errors.content && 'border-red-500')}
            onFocus={() => setIsContentFocused(true)}
            onBlur={() => setIsContentFocused(false)}
          />
          {errors.content && <p className='mt-1 text-sm text-red-500'>{errors.content.message}</p>}
        </div>

        <div>
          <Label htmlFor='sharing'>Sharing</Label>
          <div className='mt-2 flex items-center space-x-2'>
            <Button
              variant='outline'
              type='button'
              size='sm'
              className={cn(
                sharingType === 'PRIVATE'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 hover:border-gray-400'
              )}
              onClick={() =>
                setValue('sharingType', SnippetSharingTypeEnum.PRIVATE, { shouldDirty: true })
              }>
              <UserIcon />
              Private
            </Button>
            <Button
              variant='outline'
              type='button'
              size='sm'
              className={cn(
                sharingType === 'ORGANIZATION'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 hover:border-gray-400'
              )}
              onClick={() =>
                setValue('sharingType', SnippetSharingTypeEnum.ORGANIZATION, { shouldDirty: true })
              }>
              <UsersIcon />
              Organization
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setIsSharingDialogOpen(true)}>
              <ShareIcon />
              Advanced Sharing
            </Button>
          </div>
        </div>
      </div>

      <div className='flex justify-end space-x-2'>
        {onCancel && (
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type='submit'
          variant='outline'
          size='sm'
          disabled={!isDirty || createMutation.isPending || updateMutation.isPending}
          loading={createMutation.isPending || updateMutation.isPending}
          loadingText={snippetId ? 'Updating...' : 'Creating...'}>
          <Save className='' />
          {snippetId ? 'Update' : 'Create'}
        </Button>
      </div>

      {/* Sharing Dialog */}
      {isSharingDialogOpen && (
        <SnippetSharing
          open={isSharingDialogOpen}
          onOpenChange={setIsSharingDialogOpen}
          snippetId={snippetId}
          initialSharingType={sharingType}
          onSave={handleShareSettings}
        />
      )}
    </form>
  )
}
