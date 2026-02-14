// apps/web/src/components/inbox/inbox-settings-tab.tsx
'use client'

import type { Inbox, InboxStatus } from '@auxx/lib/inboxes'
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
import { Separator } from '@auxx/ui/components/separator'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { AlertTriangle, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormColorTagPicker } from '~/components/pickers/color-tag-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Form data shape for inbox settings */
type InboxFormData = {
  name: string
  description: string
  color: string
  status: InboxStatus
}

/** Tab component for managing inbox settings */
export function InboxSettingsTab({ inbox }: { inbox: Inbox }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  // Form setup
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<InboxFormData>({
    defaultValues: {
      name: inbox.name,
      description: inbox.description || '',
      color: inbox.color || '#4F46E5',
      status: inbox.status,
    },
  })

  // Delete inbox mutation
  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Inbox deleted',
        description: 'The inbox has been successfully deleted',
      })
      router.push('/app/settings/inbox')
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
      setIsDeleting(false)
    },
  })

  // Watch the color value to show in the picker
  const colorValue = watch('color')

  // Update inbox mutation
  const updateInbox = api.inbox.update.useMutation({
    onSuccess: () => {
      setIsSubmitting(false)
      toastSuccess({
        title: 'Inbox updated',
        description: 'The inbox settings have been updated successfully',
      })
    },
    onError: (error) => {
      setIsSubmitting(false)
      toastError({ title: 'Error updating inbox', description: error.message })
    },
  })

  /** Handle color change from the color picker */
  const handleColorChange = (color: string) => {
    setValue('color', color)
  }

  /** Handle form submission */
  const onSubmit = (data: InboxFormData) => {
    setIsSubmitting(true)
    updateInbox.mutate({
      inboxId: inbox.id,
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
        status: data.status,
      },
    })
  }

  /** Handle inbox deletion with confirmation */
  const handleDeleteInbox = async () => {
    if (!inbox) return
    const confirmed = await confirm({
      title: 'Delete Inbox',
      description:
        'This action cannot be undone. This will permanently delete the inbox and all associated data.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      setIsDeleting(true)
      await deleteInbox.mutateAsync({ inboxId: inbox.id })
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className='p-6 space-y-6'>
        <div className='space-y-2'>
          <Label htmlFor='name'>Name</Label>
          <Input
            id='name'
            {...register('name', { required: 'Name is required' })}
            placeholder='Inbox name'
            className={errors.name ? 'border-red-500' : ''}
          />
          {errors.name && <p className='text-sm text-red-500'>{errors.name.message}</p>}
        </div>

        <div className='space-y-2'>
          <Label htmlFor='description'>Description</Label>
          <Textarea
            id='description'
            {...register('description')}
            placeholder='Optional description'
            rows={3}
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='color'>Color</Label>
          <FormColorTagPicker value={colorValue} onChange={handleColorChange} />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='status'>Status</Label>
          <Select
            value={watch('status')}
            onValueChange={(value) => setValue('status', value as InboxStatus)}>
            <SelectTrigger>
              <SelectValue placeholder='Select status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ACTIVE'>Active</SelectItem>
              <SelectItem value='PAUSED'>Paused</SelectItem>
              <SelectItem value='ARCHIVED'>Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type='submit' disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
      <Separator />
      <div className='p-6'>
        <div className='space-y-2'>
          <div className='flex items-center gap-2  tracking-tight font-semibold text-foreground text-base'>
            <AlertTriangle className='size-4' /> Danger Zone
          </div>
          <div className='group flex items-center border py-2 px-3 hover:bg-destructive/2 transition-colors duration-200 rounded-2xl border-destructive/50'>
            <div className='flex flex-col justify-between gap-4 w-full md:flex-row md:items-center'>
              <div className='flex items-center gap-3'>
                <div className='size-8 border border-destructive/10 bg-destructive/2 rounded-lg flex items-center justify-center group-hover:bg-destructive/5 transition-colors overflow-hidden shrink-0'>
                  <AlertTriangle className='size-4 text-destructive' />
                </div>
                <div className='flex flex-col'>
                  <span className='text-sm text-destructive'>Delete Inbox</span>
                  <span className='text-xs text-destructive/80'>
                    Deleting this inbox will remove all associated data and cannot be undone.
                  </span>
                </div>
              </div>
              <div className='shrink-0'>
                <Button
                  type='button'
                  variant='destructive'
                  size='sm'
                  onClick={async () => {
                    await handleDeleteInbox()
                  }}
                  disabled={isDeleting}>
                  <Trash />
                  Delete Inbox
                </Button>
              </div>
              <ConfirmDialog />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
