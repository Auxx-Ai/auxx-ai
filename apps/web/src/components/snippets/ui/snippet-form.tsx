// apps/web/src/components/snippets/ui/snippet-form.tsx
'use client'
import { toRecordId } from '@auxx/types/resource'
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
import { FolderIcon, Save, Share2 } from 'lucide-react'
import React from 'react'
import { useForm } from 'react-hook-form'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'
import { useSnippetAccess } from '../hooks/use-snippet-access'
import { SnippetEditor } from './snippet-editor'

interface FormValues {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
}

interface SnippetFormProps {
  snippetId?: string
  initialValues?: Partial<FormValues>
  onSuccess?: () => void
  onCancel?: () => void
}

/**
 * Create/edit form for one snippet.
 *
 * **Sharing is not a field on this form.** Plan 36 deleted `Snippet.sharingType`
 * and the bespoke `SnippetSharing` dialog it drove; a snippet's audience lives in
 * `ResourceAccess` and is edited through the shared {@link InstanceShareDialog} —
 * the same surface datasets, workflows, KBs and agents use, which funnels every
 * write through `resourceAccess.grantInstance`. The trigger AND the dialog are
 * both behind `canAdmin`: rendering the dialog unconditionally and only hiding
 * the button would still mount a share surface for a member who cannot re-share
 * (the #1355 gating rule).
 *
 * At `view` (no `edit`) the form renders READ-ONLY rather than disappearing — a
 * snippet shared with you is worth reading.
 */
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
    },
  })
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const [isShareDialogOpen, setIsShareDialogOpen] = React.useState(false)
  const { canEdit, canAdmin, canManage } = useSnippetAccess(snippetId)
  // Creating gates on the coarse `snippets.manage` rung (there is no instance to
  // key on); editing gates on `edit` for THIS snippet.
  const isReadOnly = snippetId ? !canEdit : !canManage
  // Register content/contentHtml with react-hook-form so validation + isDirty
  // work without the tiptap editor being a direct <input>.
  register('content', { required: 'Content is required' })
  register('contentHtml')
  // Get folders
  const { data: folderData } = api.snippet.getFolders.useQuery()
  const createMutation = api.snippet.create.useMutation()
  const updateMutation = api.snippet.update.useMutation()

  const isSubmitting = createMutation.isPending || updateMutation.isPending

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

    try {
      await createMutation.mutateAsync(data)
    } catch (error) {
      toastError({
        title: 'Error creating snippet',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return
    }

    posthog?.capture('snippet_created')
    toastSuccess({
      title: 'Snippet created',
      description: 'Your snippet has been created successfully',
    })
    utils.snippet.all.invalidate()
    utils.snippet.getFolders.invalidate()
    if (onSuccess) onSuccess()
  }

  const handleEditorChange = React.useCallback(
    (html: string, text: string) => {
      setValue('contentHtml', html, { shouldDirty: true })
      setValue('content', text, { shouldDirty: true, shouldValidate: true })
    },
    [setValue]
  )

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
              readOnly={isReadOnly}
              {...register('title', { required: 'Title is required' })}
            />
            <InputGroupAddon align='inline-end'>
              <Select
                value={watch('folderId') ?? 'none'}
                disabled={isReadOnly}
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
            editable={!isReadOnly}
            placeholder='Type { to insert a placeholder...'
            wrapperClassName={cn(errors.content && 'border-red-500')}
          />
        </div>
      </div>

      <div className='flex items-center justify-end space-x-2'>
        {snippetId && canAdmin && (
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='mr-auto'
            onClick={() => setIsShareDialogOpen(true)}>
            <Share2 />
            Share
          </Button>
        )}
        {onCancel && (
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            {isReadOnly ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
        )}
        {!isReadOnly && (
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
        )}
      </div>

      {snippetId && canAdmin && (
        <InstanceShareDialog
          recordId={toRecordId('snippet', snippetId)}
          open={isShareDialogOpen}
          onOpenChange={setIsShareDialogOpen}
        />
      )}
    </form>
  )
}
