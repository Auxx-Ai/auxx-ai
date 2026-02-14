// apps/web/src/app/(protected)/app/workflows/_components/credentials/create-credential-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Separator } from '@auxx/ui/components/separator'
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@auxx/ui/components/stepper'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { CredentialFormBuilder } from './credential-form-builder'
import { type CredentialTypeMetadata, getCredentialType } from './credential-registry'
import { CredentialTypeSelector } from './credential-type-selector'
import { useCredentials } from './credentials-provider'
import { validateCredentialData } from './validation-utils'

interface CreateCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialType?: string
}

type CreateCredentialStep = 'select-type' | 'configure' | 'test-save'

interface CredentialFormData {
  name: string
  [key: string]: any
}

/**
 * Get steps configuration based on whether initialType is provided
 */
const getStepsForMode = (hasInitialType: boolean) => {
  if (hasInitialType) {
    // When credential type is pre-selected, skip type selection
    return [
      { step: 1, title: 'Configure', key: 'configure' as const },
      { step: 2, title: 'Test & Save', key: 'test-save' as const },
    ]
  }
  // Default flow with all steps
  return [
    { step: 1, title: 'Select Type', key: 'select-type' as const },
    { step: 2, title: 'Configure', key: 'configure' as const },
    { step: 3, title: 'Test & Save', key: 'test-save' as const },
  ]
}

/**
 * Create credential dialog component
 */
export function CreateCredentialDialog({
  open,
  onOpenChange,
  initialType,
}: CreateCredentialDialogProps) {
  const [currentStep, setCurrentStep] = useState<CreateCredentialStep>('select-type')
  const [selectedCredentialType, setSelectedCredentialType] =
    useState<CredentialTypeMetadata | null>(
      initialType ? getCredentialType(initialType) || null : null
    )
  const [isCreating, setIsCreating] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const { createCredential, testCredential } = useCredentials()

  const form = useForm<CredentialFormData>({ defaultValues: { name: '' } })

  // Reset form when dialog opens/closes
  React.useEffect(() => {
    if (open) {
      const initialCredentialType = initialType ? getCredentialType(initialType) : null
      const defaultName = initialCredentialType ? `${initialCredentialType.displayName}` : ''

      form.reset({ name: defaultName })
      setCurrentStep(initialType ? 'configure' : 'select-type')
      setSelectedCredentialType(initialCredentialType)
      setIsCreating(false)
      setIsTesting(false)
    }
  }, [open, initialType, form])

  const handleTypeSelect = (credentialType: CredentialTypeMetadata) => {
    setSelectedCredentialType(credentialType)
    setCurrentStep('configure')

    // Set default values from credential type
    const defaultValues: Record<string, any> = {
      name: `${credentialType.displayName} ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, // User-friendly default name
    }
    credentialType.credentialType.properties.forEach((prop) => {
      if (prop.default !== undefined && prop.default !== null) {
        defaultValues[prop.name] = prop.default
      }
    })
    form.reset(defaultValues)
  }

  const handleNext = () => {
    if (currentStep === 'configure') {
      setCurrentStep('test-save')
    }
  }

  const handleBack = () => {
    const hasInitialType = !!initialType

    switch (currentStep) {
      case 'configure':
        if (!hasInitialType) {
          // Only allow going back to type selection if no initialType
          setCurrentStep('select-type')
          setSelectedCredentialType(null)
        }
        // If hasInitialType, do nothing (no back action available)
        break
      case 'test-save':
        setCurrentStep('configure')
        break
      default:
        break
    }
  }

  const handleTestConnection = async () => {
    if (!selectedCredentialType) return

    setIsTesting(true)
    try {
      // First create a temporary credential to test
      const formData = form.getValues()
      const { name, ...credentialData } = formData

      const credentialId = await createCredential({
        type: selectedCredentialType.credentialType.name,
        name: `temp_test_${Date.now()}`,
        data: credentialData,
      })

      // Test the credential
      const testResult = await testCredential(credentialId)

      // Clean up temporary credential (you might want to add a cleanup endpoint)
      // For now, we'll leave it and let the user decide to save or not

      return testResult
    } catch (error) {
      console.error('Test connection failed:', error)
      return false
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = async () => {
    if (!selectedCredentialType) return

    // Validate form before submission
    const isFormValid = await form.trigger()
    if (!isFormValid) {
      toastError({
        title: 'Validation Error',
        description: 'Please fix the errors in the form before saving',
      })
      return
    }

    setIsCreating(true)
    try {
      const formData = form.getValues()
      const { name, ...credentialData } = formData

      // Additional client-side validation
      const validationResult = validateCredentialData(
        credentialData,
        selectedCredentialType.credentialType.properties
      )

      if (!validationResult.isValid) {
        const errorMessage = Object.values(validationResult.errors).join(', ')
        toastError({ title: 'Validation Error', description: errorMessage })
        return
      }

      await createCredential({
        type: selectedCredentialType.credentialType.name,
        name,
        data: credentialData,
      })

      toastSuccess({
        title: 'Credential Created',
        description: `${name} has been created successfully`,
      })

      onOpenChange(false)
    } catch (error) {
      console.error('Failed to create credential:', error)
      toastError({
        title: 'Failed to Create Credential',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setIsCreating(false)
    }
  }

  const getStepNumber = () => {
    const hasInitialType = !!initialType
    switch (currentStep) {
      case 'select-type':
        return 1
      case 'configure':
        return hasInitialType ? 1 : 2 // Dynamic numbering based on mode
      case 'test-save':
        return hasInitialType ? 2 : 3 // Dynamic numbering based on mode
      default:
        return 1
    }
  }

  const getStepTitle = () => {
    const hasInitialType = !!initialType
    switch (currentStep) {
      case 'select-type':
        return 'Select Credential Type'
      case 'configure':
        return hasInitialType
          ? `Create ${selectedCredentialType?.displayName || 'Credential'}`
          : 'Configure Credential'
      case 'test-save':
        return 'Test & Save'
      default:
        return 'Create Credential'
    }
  }

  const getStepDescription = () => {
    const hasInitialType = !!initialType
    switch (currentStep) {
      case 'select-type':
        return 'Choose the type of credential you want to create'
      case 'configure':
        return hasInitialType
          ? `Enter the configuration details for your ${selectedCredentialType?.displayName || 'credential'}`
          : 'Enter the configuration details for your credential'
      case 'test-save':
        return 'Test your connection and save the credential'
      default:
        return ''
    }
  }

  // Get dynamic steps based on initialType
  const steps = getStepsForMode(!!initialType)

  // Check if back button should be disabled
  const isBackDisabled = () => {
    const hasInitialType = !!initialType
    return currentStep === 'select-type' || (currentStep === 'configure' && hasInitialType)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='lg' position='tc' className='overflow-y-auto max-h-[90vh] p-0'>
        <DialogHeader className='pb-0 mb-0 px-4 pt-4 sticky top-0 bg-background z-10'>
          <div>
            <DialogTitle>{getStepTitle()}</DialogTitle>
            <DialogDescription>{getStepDescription()}</DialogDescription>
          </div>

          {/* Stepper */}
          <Stepper value={getStepNumber()}>
            {steps.map(({ step, title }) => (
              <StepperItem key={step} step={step} className='not-last:flex-1 max-md:items-start'>
                <StepperTrigger className='rounded max-md:flex-col pointer-events-none'>
                  <StepperIndicator />
                  <div className='text-center md:text-left'>
                    <StepperTitle className='text-sm'>{title}</StepperTitle>
                  </div>
                </StepperTrigger>
                {step < steps.length && <StepperSeparator className='max-md:mt-3.5 md:mx-4' />}
              </StepperItem>
            ))}
          </Stepper>

          {selectedCredentialType && (!!initialType || currentStep !== 'select-type') && (
            <>
              <Separator />
              <div className='pt-3 flex items-center gap-3'>
                <selectedCredentialType.icon className='h-5 w-5' />
                <span className='font-medium'>{selectedCredentialType.displayName}</span>
                <Badge variant='secondary'>{selectedCredentialType.category}</Badge>
              </div>
            </>
          )}
        </DialogHeader>

        <div className='flex-1 pt-1 px-4 pb-4 h-full'>
          {currentStep === 'select-type' && (
            <CredentialTypeSelector
              onSelect={handleTypeSelect}
              selectedType={selectedCredentialType?.id}
            />
          )}

          {currentStep === 'configure' && selectedCredentialType && (
            <Form {...form}>
              <div className='space-y-3'>
                {/* Credential Name */}
                <FormField
                  control={form.control}
                  name='name'
                  rules={{ required: 'Credential name is required' }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="after:content-['*'] after:ml-0.5 after:text-red-500">
                        Credential Name
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder='Enter a name for this credential'
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
                  properties={selectedCredentialType.credentialType.properties}
                  form={form}
                  credentialType={selectedCredentialType.credentialType}
                  onOAuth2Success={(credentialId) => {
                    // OAuth2 credential was created successfully - skip test-save step
                    toastSuccess({
                      title: 'Authentication Successful',
                      description: `${selectedCredentialType.displayName} credential "${form.getValues('name')}" has been created and connected successfully`,
                    })
                    onOpenChange(false)
                  }}
                />
              </div>
            </Form>
          )}

          {currentStep === 'test-save' && selectedCredentialType && (
            <div className='space-y-6'>
              <div className='text-center py-8'>
                <selectedCredentialType.icon className='h-12 w-12 mx-auto mb-4 text-muted-foreground' />
                <h3 className='text-lg font-medium mb-2'>Ready to Create Credential</h3>
                <p className='text-muted-foreground'>
                  Your {selectedCredentialType.displayName} credential "{form.getValues('name')}" is
                  configured and ready to be saved.
                </p>
              </div>

              <div className='flex gap-3'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleTestConnection}
                  loading={isTesting}
                  loadingText='Testing...'
                  className='flex-1'>
                  Test Connection
                </Button>

                <Button
                  onClick={handleSave}
                  size='sm'
                  disabled={isCreating}
                  className='flex-1'
                  loading={isCreating}
                  loadingText='Creating...'>
                  Save Credential
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className='flex justify-between border-t pt-4 px-4 pb-4'>
          {!isBackDisabled() ? (
            <Button variant='ghost' size='sm' onClick={handleBack} disabled={isCreating}>
              <ArrowLeft />
              Back
            </Button>
          ) : (
            <div />
          )}

          {currentStep === 'configure' && (
            <Button
              onClick={handleNext}
              size='sm'
              disabled={
                !form.formState.isValid ||
                !form.getValues('name') ||
                // For OAuth2 credentials, disable Next until OAuth is complete
                (selectedCredentialType &&
                  hasOAuth2Config(selectedCredentialType.credentialType) &&
                  !form.getValues('oauthComplete'))
              }>
              Next
              <ArrowRight />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
