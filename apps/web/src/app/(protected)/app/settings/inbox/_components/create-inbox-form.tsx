// /app/settings/inbox/_components/create-inbox-form-with-popover.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Form } from '@auxx/ui/components/form'
import { ArrowLeft } from 'lucide-react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { FormColorTagPicker } from '~/components/pickers/color-tag-picker'
import { MemberGroupFormField } from '~/components/pickers/member-group-form-picker'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import type { InboxStatus } from '@auxx/database/types'

interface CreateInboxFormData {
  name: string
  description: string
  color: string
  status: InboxStatus
  accessType: 'anyone' | 'restricted'
  memberGroupSelection?: {
    memberIds: string[]
    groupIds: string[]
  }
}
export function CreateInboxForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })
  // Use the confirm hook for back navigation confirmation
  const [confirm, ConfirmDialog] = useConfirm()
  // Form setup
  const form = useForm<CreateInboxFormData>({
    defaultValues: {
      name: '',
      description: '',
      color: '#4F46E5',
      status: 'ACTIVE' as InboxStatus,
      accessType: 'anyone',
      memberGroupSelection: { memberIds: [], groupIds: [] },
    },
  })
  // Watch form values
  const colorValue = form.watch('color')
  const accessType = form.watch('accessType')
  const isDirty = form.formState.isDirty
  // Create inbox mutation
  const createInbox = api.inbox.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Inbox created',
        description: 'The inbox has been created successfully',
      })
      router.push('/app/settings/inbox')
    },
    onError: (error) => {
      setIsSubmitting(false)
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })
  // Handle color change from the color picker
  const handleColorChange = (color: string) => {
    form.setValue('color', color)
  }
  // Handle form submission
  const onSubmit = (data: CreateInboxFormData) => {
    setIsSubmitting(true)
    const { memberIds = [], groupIds = [] } = data.memberGroupSelection || {}
    createInbox.mutate({
      name: data.name,
      description: data.description,
      color: data.color,
      status: data.status,
      allowAllMembers: data.accessType === 'anyone',
      enableMemberAccess: data.accessType === 'restricted' && memberIds.length > 0,
      enableGroupAccess: data.accessType === 'restricted' && groupIds.length > 0,
      ...(data.accessType === 'restricted' && { memberIds, groupIds }),
    })
  }
  // Navigate back to inbox list with confirmation if form is dirty
  const handleBack = async () => {
    if (isDirty) {
      const confirmed = await confirm({
        title: 'Discard changes?',
        description: 'You have unsaved changes. Are you sure you want to leave?',
        confirmText: 'Discard',
        cancelText: 'Stay',
        destructive: true,
      })
      if (!confirmed) return
    }
    router.push('/app/settings/inbox')
  }
  return (
    <SettingsPage
      title="Create New Inbox"
      description=""
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Inboxes', href: '/app/settings/inbox' },
        { title: 'Create New Inbox' },
      ]}
      button={
        <Button variant="outline" onClick={handleBack} className="">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inboxes
        </Button>
      }>
      {/* Render the confirmation dialog */}
      <ConfirmDialog />

      <div className="p-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...form.register('name', { required: 'Name is required' })}
                placeholder="Enter inbox name"
                className={form.formState.errors.name ? 'border-red-500' : ''}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...form.register('description')}
                placeholder="Optional description"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <FormColorTagPicker value={colorValue} onChange={handleColorChange} />
            </div>

            {/* <div className='space-y-2'>
          <Label htmlFor='status'>Status</Label>
          <Select
            value={form.watch('status')}
            onValueChange={(value) =>
              form.setValue('status', value as InboxStatus)
            }>
            <SelectTrigger>
              <SelectValue placeholder='Select status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ACTIVE'>Active</SelectItem>
              <SelectItem value='PAUSED'>Paused</SelectItem>
              <SelectItem value='ARCHIVED'>Archived</SelectItem>
            </SelectContent>
          </Select>
        </div> */}

            <div className="space-y-2">
              <Label>Access</Label>
              <RadioGroup
                value={accessType}
                onValueChange={(value) =>
                  form.setValue('accessType', value as 'anyone' | 'restricted')
                }
                className="mt-2 flex flex-col space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="anyone" id="anyone" />
                  <Label htmlFor="anyone" className="cursor-pointer">
                    Anyone in the organization
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="restricted" id="restricted" />
                  <Label htmlFor="restricted" className="cursor-pointer">
                    Restricted
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {accessType === 'restricted' && (
              <div className="pl-6 pt-2">
                <MemberGroupFormField
                  name="memberGroupSelection"
                  control={form.control}
                  label="Select members or groups with access"
                  description="Only selected members and groups will have access to this inbox"
                  disabled={isSubmitting}
                />
              </div>
            )}

            <div className="flex justify-end space-x-4 pt-4">
              <Button variant="outline" onClick={handleBack} type="button" size="sm">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} size="sm" variant="info">
                {isSubmitting ? 'Creating...' : 'Create Inbox'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </SettingsPage>
  )
}
