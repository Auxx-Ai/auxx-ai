// apps/web/src/app/(protected)/app/workflows/_components/credentials/edit-credential-dialog.tsx
'use client'

import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Badge } from '@auxx/ui/components/badge'
import { Separator } from '@auxx/ui/components/separator'
import { api } from '~/trpc/react'
import { useCredentials } from './credentials-provider'
import { CredentialFormBuilder } from './credential-form-builder'
import { getCredentialType } from './credential-registry'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { validateCredentialData } from './validation-utils'
import { filterCredentialDataForEdit, hasSensitiveFieldChanges } from './credential-data-utils'

interface EditCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  credentialId: string | null
}

interface CredentialFormData {
  name: string
  [key: string]: any
}

interface CredentialInfo {
  id: string
  name: string
  type: string
  createdBy: { name: string | null }
  createdAt: Date
  updatedAt: Date
}

/**
 * Edit credential dialog component
 */
export function EditCredentialDialog({
  open,
  onOpenChange,
  credentialId,
}: EditCredentialDialogProps) {
  const { updateCredential, refetchCredentials } = useCredentials()
  const [isSaving, setIsSaving] = useState(false)

  // Use tRPC query hook for credential data
  const {
    data: credentialData,
    isLoading,
    error,
  } = api.credentials.getNonSensitiveData.useQuery(
    { id: credentialId! },
    { enabled: open && !!credentialId, refetchOnWindowFocus: false }
  )

  const form = useForm<CredentialFormData>({ defaultValues: { name: '' } })

  // Update form when credential data loads
  useEffect(() => {
    if (credentialData && open) {
      console.log('Setting form with credential data:', credentialData)
      const defaultValues: Record<string, any> = {
        name: credentialData.info.name,
        ...credentialData.nonSensitiveData,
      }
      form.reset(defaultValues)
    } else if (!open) {
      // Reset form when dialog closes
      form.reset({ name: '' })
    }
  }, [credentialData, open, form])

  // Handle loading error
  useEffect(() => {
    if (error && open) {
      console.error('Failed to load credential data:', error)
      toastError({ title: 'Failed to load credential', description: error.message })
      onOpenChange(false)
    }
  }, [error, open, onOpenChange])

  const handleSave = async () => {
    if (!credentialId || !credentialData) return

    // Validate form before submission
    const isFormValid = await form.trigger()
    if (!isFormValid) {
      toastError({
        title: 'Validation Error',
        description: 'Please fix the errors in the form before saving',
      })
      return
    }

    setIsSaving(true)
    try {
      const formData = form.getValues()
      const { name, ...rawCredentialData } = formData

      // Get credential type for validation and filtering
      const credentialType = getCredentialType(credentialData.info.type)
      if (!credentialType) {
        throw new Error('Unknown credential type')
      }

      // Filter out empty sensitive fields to preserve existing values
      const filteredCredentialData = filterCredentialDataForEdit(
        rawCredentialData,
        credentialType.credentialType.properties
      )

      // Additional client-side validation (use raw data for validation to catch empty required fields)
      const validationResult = validateCredentialData(
        rawCredentialData,
        credentialType.credentialType.properties,
        true // editMode = true
      )

      if (!validationResult.isValid) {
        const errorMessage = Object.values(validationResult.errors).join(', ')
        toastError({ title: 'Validation Error', description: errorMessage })
        return
      }

      // Check if we're making any changes
      const hasChanges =
        name !== credentialData.info.name ||
        Object.keys(filteredCredentialData).length > 0 ||
        hasSensitiveFieldChanges(rawCredentialData, credentialType.credentialType.properties)

      if (!hasChanges) {
        toastError({ title: 'No Changes', description: 'No changes detected to save' })
        return
      }

      await updateCredential(credentialId, { name, data: filteredCredentialData })

      toastSuccess({
        title: 'Credential updated',
        description: `${name} has been updated successfully`,
      })

      await refetchCredentials()
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Failed to update credential',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const credentialType = credentialData ? getCredentialType(credentialData.info.type) : null


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-0 pb-0">
          <DialogTitle>Edit Credential</DialogTitle>
          <DialogDescription>
            Update your credential settings. Sensitive fields must be re-entered for security.
          </DialogDescription>

          {credentialData && credentialType && (
            <>
              <div className="flex items-center gap-3 mt-3 mb-4">
                <credentialType.icon className="size-5" />
                <span className="text-sm">{credentialType.displayName}</span>
              </div>
            </>
          )}
        </DialogHeader>

        <div className="flex-1 p-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading credential data...</span>
            </div>
          ) : credentialData && credentialType ? (
            <Form {...form}>
              <div className="space-y-6">
                {/* Credential Name Field */}
                <FormField
                  control={form.control}
                  name="name"
                  rules={{ required: 'Credential name is required' }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="after:content-['*'] after:ml-0.5 after:text-red-500">
                        Credential Name
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter a name for this credential"
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                {/* Dynamic Form Fields */}
                <CredentialFormBuilder
                  properties={credentialType.credentialType.properties}
                  form={form}
                  editMode={true}
                  nonSensitiveValues={credentialData.nonSensitiveData}
                />
              </div>
            </Form>
          ) : null}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!form.formState.isValid || isSaving || isLoading}
            loading={isSaving}
            loadingText="Saving..."
            data-dialog-submit>
            Save Changes <KbdSubmit variant="default" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
