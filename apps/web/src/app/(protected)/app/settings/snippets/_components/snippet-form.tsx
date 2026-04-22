'use client'
import { SnippetSharingType as SnippetSharingTypeEnum } from '@auxx/database/enums'
import type { SnippetSharingType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { FolderIcon, Save, ShareIcon, UserIcon, UsersIcon } from 'lucide-react'
import React from 'react'
import { useForm } from 'react-hook-form'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'
import { SnippetEditor } from './snippet-editor'
import { SnippetSharing } from './snippet-sharing'

interface FormValues {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType: SnippetSharingType
}

type ShareInput = {
  granteeType: 'group' | 'user'
  granteeId: string
  permission: 'VIEW' | 'EDIT'
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
  const posthog = useAnalytics()
  const [isSharingDialogOpen, setIsSharingDialogOpen] = React.useState(false)
  // Shares staged by the Advanced Sharing dialog while creating a new snippet.
  // For existing snippets, sharing is persisted immediately via share.mutate.
  const [pendingShares, setPendingShares] = React.useState<ShareInput[] | undefined>(undefined)
  // Register content/contentHtml with react-hook-form so validation + isDirty
  // work without the tiptap editor being a direct <input>.
  register('content', { required: 'Content is required' })
  register('contentHtml')
  // Get form values for sharing dialog
  const sharingType = watch('sharingType')
  // Get folders
  const { data: folderData } = api.snippet.getFolders.useQuery()
  const createMutation = api.snippet.create.useMutation()
  const updateMutation = api.snippet.update.useMutation()
  const share = api.snippet.share.useMutation()

  const isSubmitting = createMutation.isPending || updateMutation.isPending || share.isPending

  const onSubmit = async (data: FormValues) => {
    // Normalize folder selection: treat "None" as no folder
    if (data.folderId === 'none' || data.folderId === '') {
      data.folderId = null
    }

    if (snippetId) {
      try {
        await updateMutation.mutateAsync({ id: snippetId, ...data })
        toastSuccess({
          title: 'Snippet updated',
          description: 'Your snippet has been updated successfully',
        })
        utils.snippet.all.invalidate()
        utils.snippet.byId.invalidate({ id: snippetId })
        utils.snippet.getFolders.invalidate()
        if (onSuccess) onSuccess()
      } catch (error) {
        toastError({
          title: 'Error updating snippet',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return
    }

    // Create flow: create snippet, then apply any shares staged from Advanced Sharing
    let newSnippetId: string | undefined
    try {
      const result = await createMutation.mutateAsync(data)
      newSnippetId = result.snippet?.id
    } catch (error) {
      toastError({
        title: 'Error creating snippet',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return
    }

    if (
      newSnippetId &&
      data.sharingType === SnippetSharingTypeEnum.GROUPS &&
      pendingShares &&
      pendingShares.length > 0
    ) {
      try {
        await share.mutateAsync({
          snippetId: newSnippetId,
          sharingType: data.sharingType,
          shares: pendingShares,
        })
      } catch (error) {
        toastError({
          title: 'Snippet created but sharing failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        utils.snippet.all.invalidate()
        utils.snippet.getFolders.invalidate()
        setPendingShares(undefined)
        if (onSuccess) onSuccess()
        return
      }
    }

    posthog?.capture('snippet_created')
    toastSuccess({
      title: 'Snippet created',
      description: 'Your snippet has been created successfully',
    })
    utils.snippet.all.invalidate()
    utils.snippet.getFolders.invalidate()
    setPendingShares(undefined)
    if (onSuccess) onSuccess()
  }

  const handleEditorChange = React.useCallback(
    (html: string, text: string) => {
      setValue('contentHtml', html, { shouldDirty: true })
      setValue('content', text, { shouldDirty: true, shouldValidate: true })
    },
    [setValue]
  )

  const handleShareSettings = (type: SnippetSharingType, shares?: ShareInput[]) => {
    setValue('sharingType', type, { shouldDirty: true })
    if (snippetId) {
      // Existing snippet: persist sharing immediately
      share.mutate(
        { snippetId, sharingType: type, shares },
        {
          onSuccess: () => {
            toastSuccess({
              title: 'Sharing updated',
              description: 'Sharing settings have been updated',
            })
            setIsSharingDialogOpen(false)
            utils.snippet.all.invalidate()
            utils.snippet.byId.invalidate({ id: snippetId })
          },
          onError: (error) => {
            toastError({ title: 'Error updating sharing', description: error.message })
          },
        }
      )
    } else {
      // New snippet: stage shares; they'll be applied on create submit
      setPendingShares(type === SnippetSharingTypeEnum.GROUPS ? shares : undefined)
      setIsSharingDialogOpen(false)
    }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
      <div className='space-y-4'>
        <div className='flex flex-col space-y-2'>
          <Label htmlFor='title'>Title</Label>
          <InputGroup>
            <InputGroupInput
              id='title'
              placeholder='Snippet title'
              aria-invalid={!!errors.title}
              {...register('title', { required: 'Title is required' })}
            />
            <InputGroupAddon align='inline-end'>
              <Select
                value={watch('folderId') ?? 'none'}
                onValueChange={(value) =>
                  setValue('folderId', value === 'none' ? null : value, {
                    shouldDirty: true,
                  })
                }>
                <SelectTrigger
                  variant='ghost'
                  size='xs'
                  className='mr-0.5 gap-1 text-muted-foreground'>
                  <FolderIcon className='size-3.5' />
                  <SelectValue placeholder='Folder' />
                </SelectTrigger>
                <SelectContent align='end'>
                  <SelectItem value='none'>None</SelectItem>
                  {folderData?.folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.title && <TooltipError text={errors.title.message ?? ''} />}
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className='relative flex flex-col space-y-2'>
          <div className='flex h-5 items-center gap-2'>
            <Label htmlFor='content'>Content</Label>
            {errors.content && <TooltipError text={errors.content.message ?? ''} />}
          </div>
          <SnippetEditor
            contentHtml={initialValues?.contentHtml || initialValues?.content || ''}
            onChange={handleEditorChange}
            placeholder='Type { to insert a placeholder...'
            wrapperClassName={cn(errors.content && 'border-red-500')}
          />
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
              className={cn(
                sharingType === 'GROUPS'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 hover:border-gray-400'
              )}
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
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
        )}
        <Button
          type='submit'
          variant='outline'
          size='sm'
          disabled={!isDirty || isSubmitting}
          loading={isSubmitting}
          loadingText={snippetId ? 'Updating...' : 'Creating...'}
          data-dialog-submit>
          <Save />
          {snippetId ? 'Update' : 'Create'} <KbdSubmit variant='outline' size='sm' />
        </Button>
      </div>

      {/* Sharing Dialog */}
      {isSharingDialogOpen && (
        <SnippetSharing
          open={isSharingDialogOpen}
          onOpenChange={setIsSharingDialogOpen}
          snippetId={snippetId}
          initialSharingType={sharingType}
          initialShares={!snippetId ? pendingShares : undefined}
          onSave={handleShareSettings}
        />
      )}
    </form>
  )
}
