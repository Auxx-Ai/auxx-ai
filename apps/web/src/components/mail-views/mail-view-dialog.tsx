// apps/web/src/components/mail-views/mail-view-dialog.tsx
'use client'

import { useState, useEffect } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import * as z from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { FileText, Filter, Sliders, Trash2 } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { MailViewDetailsForm } from './mail-view-details-form'
import { MailViewFilterBuilder } from './mail-view-filter-builder'
import { MailViewSortOptions } from './mail-view-sort-options'
import { MailViewSharingOptions } from './mail-view-sharing-options'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import type { ConditionGroup } from '~/components/conditions'

// Define the form schema using zod
const mailViewFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  isDefault: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  isShared: z.boolean().default(false),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  filterGroups: z.any(), // ConditionGroup[] - complex nested structure handled separately
})

export type MailViewFormValues = z.infer<typeof mailViewFormSchema>

interface MailViewDialogProps {
  isOpen: boolean
  onClose: () => void
  mailViewId?: string // If provided, we're editing an existing view
}

export function MailViewDialog({ isOpen, onClose, mailViewId }: MailViewDialogProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'filters' | 'options'>('details')
  const [confirm, DeleteConfirmDialog] = useConfirm()

  // Setup form
  const methods = useForm<MailViewFormValues>({
    resolver: standardSchemaResolver(mailViewFormSchema),
    defaultValues: {
      name: '',
      description: '',
      isDefault: false,
      isPinned: false,
      isShared: false,
      sortField: 'lastMessageAt',
      sortDirection: 'desc',
      filterGroups: [] as ConditionGroup[],
    },
  })

  // Guard against accidental close with unsaved changes
  const { guardProps, guardedClose, ConfirmDialog: UnsavedChangesDialog } = useUnsavedChangesGuard({
    isDirty: methods.formState.isDirty,
    onConfirmedClose: onClose,
    confirmOptions: {
      title: 'Discard changes?',
      description: 'You have unsaved changes. Are you sure you want to discard them?',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
    },
  })

  // Get mail view for editing
  const { data: mailView, isLoading: isLoadingMailView } = api.mailView.getById.useQuery(
    { id: mailViewId! },
    { enabled: !!mailViewId, refetchOnWindowFocus: false }
  )

  // Create and update mutations
  const createMailView = api.mailView.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'View created',
        description: 'Your mail view has been created successfully',
      })
      onClose()
      // Invalidate queries to refresh the list
      utils.mailView.getUserMailViews.invalidate()
      utils.mailView.getAllAccessibleMailViews.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error creating view', description: error.message })
    },
  })

  const updateMailView = api.mailView.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'View updated',
        description: 'Your mail view has been updated successfully',
      })
      onClose()
      // Invalidate queries to refresh the list
      utils.mailView.getUserMailViews.invalidate()
      utils.mailView.getAllAccessibleMailViews.invalidate()
      if (mailViewId) {
        utils.mailView.getById.invalidate({ id: mailViewId })
      }
      if (methods.getValues('isShared')) {
        utils.mailView.getSharedMailViews.invalidate()
      }
    },
    onError: (error) => {
      toastError({ title: 'Error updating view', description: error.message })
    },
  })

  const deleteMailView = api.mailView.delete.useMutation({
    onSuccess: () => {
      onClose()
      utils.mailView.getUserMailViews.invalidate()
      utils.mailView.getAllAccessibleMailViews.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting view', description: error.message })
    },
  })

  const utils = api.useUtils()

  // Load mail view data when editing
  useEffect(() => {
    if (mailView) {
      methods.reset({
        name: mailView.name,
        description: mailView.description || '',
        isDefault: mailView.isDefault,
        isPinned: mailView.isPinned,
        isShared: mailView.isShared,
        sortField: mailView.sortField || 'lastMessageAt',
        sortDirection: (mailView.sortDirection as 'asc' | 'desc') || 'desc',
        // Database stores filterGroups in 'filters' column (backwards compatible)
        filterGroups: (mailView.filters as ConditionGroup[]) || [],
      })
    }
  }, [mailView, methods])

  /** Handles the delete action with confirmation */
  const handleDelete = async () => {
    if (!mailViewId) return

    const confirmed = await confirm({
      title: 'Delete this view?',
      description: 'This action cannot be undone. The view will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteMailView.mutate({ id: mailViewId })
    }
  }

  const onSubmit = (data: MailViewFormValues) => {
    if (mailViewId) {
      updateMailView.mutate({
        id: mailViewId,
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault,
          isPinned: data.isPinned,
          isShared: data.isShared,
          sortField: data.sortField,
          sortDirection: data.sortDirection,
          filterGroups: data.filterGroups,
        },
      })
    } else {
      createMailView.mutate({
        name: data.name,
        description: data.description,
        isDefault: data.isDefault,
        isPinned: data.isPinned,
        isShared: data.isShared,
        sortField: data.sortField,
        sortDirection: data.sortDirection,
        filterGroups: data.filterGroups,
      })
    }
  }

  // Compute disabled state for submit
  const isSubmitDisabled =
    isLoadingMailView || createMailView.isPending || updateMailView.isPending

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && guardedClose()}>
      <DialogContent size="xl" variant="default" position="tc" {...guardProps}>
        <DialogHeader>
          <DialogTitle>{mailViewId ? 'Edit Mail View' : 'Create Mail View'}</DialogTitle>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)}>
            <RadioTab
              value={activeTab}
              onValueChange={setActiveTab}
              size="sm"
              radioGroupClassName="grid w-full"
              className="border border-primary-200 flex flex-1 w-full mb-4">
              <RadioTabItem value="details" size="sm">
                <FileText />
                Details
              </RadioTabItem>
              <RadioTabItem value="filters" size="sm">
                <Filter />
                Filters
              </RadioTabItem>
              <RadioTabItem value="options" size="sm">
                <Sliders />
                Options
              </RadioTabItem>
            </RadioTab>

            {activeTab === 'details' && (
              <div className="space-y-4 ">
                <MailViewDetailsForm />
              </div>
            )}

            {activeTab === 'filters' && <MailViewFilterBuilder />}

            {activeTab === 'options' && (
              <div className="space-y-4">
                <MailViewSortOptions />
                <MailViewSharingOptions />
              </div>
            )}

            <DialogFooter className="mt-0">
              {mailViewId && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-hover"
                  onClick={handleDelete}
                  loading={deleteMailView.isPending}
                  loadingText="Deleting..."
                  className="mr-auto">
                  <Trash2 />
                  Delete View
                </Button>
              )}
              <Button size="sm" variant="ghost" type="button" onClick={guardedClose}>
                Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                loadingText="Saving..."
                loading={isLoadingMailView || createMailView.isPending || updateMailView.isPending}>
                {mailViewId ? 'Update View' : 'Create View'} <KbdSubmit variant="outline" size="sm" />
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
      <DeleteConfirmDialog />
      <UnsavedChangesDialog />
    </Dialog>
  )
}
