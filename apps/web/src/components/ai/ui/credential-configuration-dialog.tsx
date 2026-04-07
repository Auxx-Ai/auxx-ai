// ~/app/(protected)/app/settings/aiModels/_components/credential-configuration-dialog.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
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
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Eye, EyeOff, PlusIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { TooltipExplanation } from '~/components/global/tooltip'
import { AiProviderPicker } from '~/components/pickers/ai-provider-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { ProviderConfiguration } from './utils'

/**
 * Configuration mode for the unified dialog
 */
type DialogMode = 'provider' | 'custom-model'

/**
 * Operation type for the dialog
 */
type DialogOperation = 'create' | 'edit'

/**
 * Props for the unified credential configuration dialog
 */
interface CredentialConfigurationDialogProps {
  /** Configuration mode */
  mode: DialogMode

  /** Provider to configure (optional - if not provided, shows provider picker) */
  provider?: string

  /** Model ID (required for custom-model mode) */
  modelId?: string

  /** Operation type */
  operation: DialogOperation

  /** Dialog state */
  open: boolean
  onOpenChange: (open: boolean) => void

  /** Callbacks */
  onProviderConfigured?: (provider: string) => void
  onModelCreated?: (modelData: any) => void

  /** Optional trigger */
  trigger?: React.ReactNode

  /** Providers list passed from parent */
  providers: ProviderConfiguration[]
}

/**
 * Model type options for radio group with provider filtering
 */
const MODEL_TYPE_OPTIONS = [
  {
    value: ModelType.LLM,
    label: 'Language Model (LLM)',
    description: 'Text generation, chat, and completion models',
  },
  {
    value: ModelType.TEXT_EMBEDDING,
    label: 'Text Embedding',
    description: 'Convert text into numerical vectors for similarity search',
  },
  {
    value: ModelType.TTS,
    label: 'Text-to-Speech',
    description: 'Convert text into spoken audio',
  },
  {
    value: ModelType.SPEECH2TEXT,
    label: 'Speech-to-Text',
    description: 'Convert spoken audio into text',
  },
  {
    value: ModelType.VISION,
    label: 'Vision',
    description: 'Analyze and understand images',
  },
  {
    value: ModelType.MODERATION,
    label: 'Moderation',
    description: 'Content moderation and safety checks',
  },
  {
    value: ModelType.RERANK,
    label: 'Rerank',
    description: 'Reorder search results by relevance',
  },
] as const

/**
 * Unified Credential Configuration Dialog
 *
 * Handles both provider configuration and custom model creation in a single component.
 * Intelligently switches between modes and provides all critical features from both
 * original dialogs including secret field handling, provider deletion, and model type filtering.
 */
export function CredentialConfigurationDialog({
  mode,
  provider,
  modelId,
  operation,
  open,
  onOpenChange,
  onProviderConfigured,
  onModelCreated,
  trigger,
  providers,
}: CredentialConfigurationDialogProps) {
  // Component state
  const [selectedProvider, setSelectedProvider] = useState<string | null>(provider || null)
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [originalValues, setOriginalValues] = useState<any>(null)
  const [confirmDelete, ConfirmDialog] = useConfirm()

  const utils = api.useUtils()

  // Fetch existing credentials for edit mode
  const { data: existingCredentials } = api.aiIntegration.getCredentials.useQuery(
    {
      mode: mode === 'custom-model' ? 'model' : 'provider',
      provider: selectedProvider!,
      model: mode === 'custom-model' ? modelId : undefined,
    },
    {
      enabled: operation === 'edit' && !!selectedProvider,
      select: (data) => data.credentials,
    }
  )

  // Get provider capabilities from passed providers data
  const providerCapabilities = useMemo(() => {
    if (!selectedProvider) return null
    const provider = providers.find((p) => p.provider === selectedProvider)
    return provider || null
  }, [selectedProvider, providers])

  // Get relevant fields based on mode and unified schema
  const getRelevantFields = useMemo(() => {
    if (!providerCapabilities) return []

    // Use new unified schema with scope filtering
    return providerCapabilities.credentialSchema.filter(
      (field) => field.scope === mode.replace('-', '_') || field.scope === 'both'
    )
  }, [providerCapabilities, mode])

  // Filter model types based on provider capabilities
  const availableModelTypes = useMemo(() => {
    if (!providerCapabilities?.supportedModelTypes) {
      return MODEL_TYPE_OPTIONS // Fallback to all types
    }

    return MODEL_TYPE_OPTIONS.filter((option) =>
      providerCapabilities.supportedModelTypes.includes(option.value)
    )
  }, [providerCapabilities])

  // Dynamic form schema
  // biome-ignore lint/correctness/useExhaustiveDependencies: operation and originalValues are intentionally excluded - they are stable for the lifetime of the dialog
  const formSchema = useMemo(() => {
    if (!providerCapabilities) return z.object({})

    // Base credential fields
    const credentialFields = getRelevantFields.reduce(
      (acc, field) => {
        let validator = z.string()

        if (field.type === 'secret-input') {
          // Secret fields: optional, validate only if provided
          validator = validator.optional().refine(
            (value) => {
              if (!value || value.length === 0) return true // Empty is OK

              // In edit mode, if value is identical to original value, skip validation
              if (operation === 'edit' && originalValues?.credentials?.[field.variable]) {
                const originalValue = originalValues.credentials[field.variable]
                if (value === originalValue) {
                  return true // Skip validation for unchanged values
                }
              }

              // Apply pattern validation for new/changed values
              if (field.validation?.pattern) {
                const regex = new RegExp(field.validation.pattern)
                return regex.test(value)
              }

              return true
            },
            { message: field.validation?.message || `Invalid ${field.label} format` }
          )
        } else {
          // Non-secret fields: normal validation
          if (field.required) {
            validator = validator.min(1, `${field.label} is required`)
          } else {
            validator = validator.optional()
          }

          if (field.validation?.pattern) {
            const regex = new RegExp(field.validation.pattern)
            validator = validator.regex(regex, field.validation.message)
          }
        }

        if (field.type === 'checkbox') {
          acc[field.variable] = field.required ? z.boolean() : z.boolean().optional()
        } else {
          acc[field.variable] = validator as z.ZodType
        }

        return acc
      },
      {} as Record<string, z.ZodType>
    )

    // Add mode-specific fields
    const modeSpecificFields =
      mode === 'custom-model'
        ? {
            modelId: z
              .string()
              .min(1, 'Model ID is required')
              .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, hyphens, and underscores allowed'),
            modelType: z.enum(ModelType),
          }
        : {}

    return z.object({
      ...modeSpecificFields,
      credentials: z.object(credentialFields),
    })
  }, [providerCapabilities, mode, getRelevantFields])

  // React Hook Form setup
  const form = useForm<Record<string, any>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {},
    mode: 'onChange',
  })

  // API mutations
  const saveProviderConfiguration = api.aiIntegration.saveProviderConfiguration.useMutation({
    onSuccess: async (result) => {
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      await utils.aiIntegration.getCredentials.invalidate()
      toastSuccess({
        title: operation === 'create' ? 'Provider added' : 'Provider updated',
        description:
          result.message || `${providerCapabilities?.displayName} has been configured successfully`,
      })
      onProviderConfigured?.(selectedProvider!)
      onOpenChange(false)
      resetForm()
    },
    onError: (error) => {
      toastError({ title: 'Configuration failed', description: error.message })
    },
  })

  const saveCustomModel = api.aiIntegration.saveCustomModel.useMutation({
    onSuccess: async (result) => {
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      await utils.aiIntegration.getCredentials.invalidate()
      toastSuccess({
        title: operation === 'create' ? 'Custom Model Created' : 'Custom Model Updated',
        description: `${result.displayName} has been ${operation === 'create' ? 'created' : 'updated'} successfully`,
      })
      onModelCreated?.(result)
      onOpenChange(false)
      resetForm()
    },
    onError: (error) => {
      toastError({
        title: operation === 'create' ? 'Failed to Create Model' : 'Failed to Update Model',
        description: error.message,
      })
    },
  })

  const deleteProvider = api.aiIntegration.deleteProviderConfiguration.useMutation({
    onSuccess: async (result) => {
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      await utils.aiIntegration.getQuotaStatus.invalidate()
      toastSuccess({
        title: 'API key removed',
        description: result.message,
      })
      onOpenChange(false)
      resetForm()
    },
    onError: (error) => {
      toastError({ title: 'Failed to remove API key', description: error.message })
    },
  })

  const deleteCustomModel = api.aiIntegration.deleteCustomModel.useMutation({
    onSuccess: async (result) => {
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      await utils.aiIntegration.getCredentials.invalidate()
      toastSuccess({
        title: 'Custom model removed',
        description: result.message || 'The custom model has been removed.',
      })
      onOpenChange(false)
      resetForm()
    },
    onError: (error) => {
      toastError({ title: 'Failed to remove custom model', description: error.message })
    },
  })

  // Reset form state
  const resetForm = () => {
    form.reset()
    setSelectedProvider(provider || null)
    setVisibleSecrets({})
  }

  // Handle provider prop changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedProvider is intentionally excluded to avoid infinite loop
  useEffect(() => {
    if (provider && provider !== selectedProvider) {
      setSelectedProvider(provider)
    }
  }, [provider])

  // Setup form with existing credentials when they're loaded
  useEffect(() => {
    if (!selectedProvider || !providerCapabilities || !getRelevantFields.length) {
      return
    }

    // Build form defaults - just use existing values or field defaults
    const credentialDefaults = getRelevantFields.reduce(
      (acc, field) => {
        acc[field.variable] = existingCredentials?.[field.variable] ?? field.default ?? ''
        return acc
      },
      {} as Record<string, any>
    )

    const formData =
      mode === 'custom-model'
        ? {
            modelId: modelId || '',
            modelType: availableModelTypes[0]?.value || 'llm',
            credentials: credentialDefaults,
          }
        : {
            credentials: credentialDefaults,
          }

    form.reset(formData)
    setOriginalValues(formData) // Store original values for comparison
  }, [
    selectedProvider,
    providerCapabilities,
    getRelevantFields,
    existingCredentials,
    mode,
    modelId,
    availableModelTypes,
    form,
  ])

  // Submit handler with intelligent credential filtering
  const onSubmit = async (values: any) => {
    if (!selectedProvider || !providerCapabilities) return

    // Process credentials with secret field handling
    const credentials = Object.fromEntries(
      Object.entries(values.credentials || values)
        .map(([key, value]) => {
          const field = getRelevantFields.find((f) => f.variable === key)

          if (field?.type === 'secret-input') {
            // For secret fields: compare with original value
            const originalValue = originalValues?.credentials?.[key] ?? ''

            if (value === originalValue) {
              // If unchanged, send hidden marker
              return [key, '[**HIDDEN**]']
            } else if (value && typeof value === 'string' && value.trim().length > 0) {
              // If changed and not empty, send new value
              return [key, value]
            } else {
              // If empty, don't include in submission
              return null
            }
          } else {
            // Non-secret fields: always send current value
            return [key, value]
          }
        })
        .filter(Boolean) // Remove null entries (empty secret fields)
    )

    if (mode === 'provider') {
      // Provider configuration
      await saveProviderConfiguration.mutateAsync({
        provider: selectedProvider,
        credentials,
        mode: operation,
      })
    } else if (mode === 'custom-model') {
      // Custom model save (create or update)
      await saveCustomModel.mutateAsync({
        provider: selectedProvider,
        modelId: values.modelId,
        modelType: values.modelType,
        credentials,
        mode: operation,
      })
    }
  }

  // Handle provider API key removal
  const handleDeleteProvider = async () => {
    if (!selectedProvider || !providerCapabilities) return

    const confirmed = await confirmDelete({
      title: `Remove ${providerCapabilities.displayName} API Key?`,
      description:
        'This will remove your custom API credentials. If you have system credits available, you will automatically switch to using them.',
      confirmText: 'Remove API Key',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteProvider.mutateAsync({ provider: selectedProvider })
    }
  }

  // Handle custom model deletion
  const handleDeleteCustomModel = async () => {
    if (!selectedProvider || !modelId) return

    const confirmed = await confirmDelete({
      title: `Remove custom model?`,
      description:
        'This will remove the custom model and its configuration. This action cannot be undone.',
      confirmText: 'Remove Model',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteCustomModel.mutateAsync({
        provider: selectedProvider,
        modelId: modelId,
      })
    }
  }

  // Toggle secret field visibility
  const toggleSecretVisibility = (fieldVariable: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [fieldVariable]: !prev[fieldVariable] }))
  }

  // Get dialog content based on mode
  const getDialogContent = () => {
    if (mode === 'provider') {
      return {
        title: `${operation === 'create' ? 'Setup' : 'Edit'} ${providerCapabilities?.displayName || 'Provider'}`,
        description: selectedProvider
          ? `Configure your ${providerCapabilities?.displayName} API credentials.`
          : 'Choose a provider and configure your API credentials.',
      }
    } else {
      // custom-model mode - check operation
      const isEdit = operation === 'edit'
      return {
        title: isEdit
          ? `Edit Custom ${providerCapabilities?.displayName || ''} Model`
          : `Add Custom ${providerCapabilities?.displayName || ''} Model`,
        description: isEdit
          ? `Update your custom ${providerCapabilities?.displayName || 'model'} configuration.`
          : `Create a custom model for ${providerCapabilities?.displayName || 'this provider'}-compatible endpoints.`,
      }
    }
  }

  // Render field control
  const renderFieldControl = (field: any, formField: any) => {
    switch (field.type) {
      case 'secret-input':
        return (
          <InputGroup>
            <InputGroupInput
              {...formField}
              type={visibleSecrets[field.variable] ? 'text' : 'password'}
              placeholder={field.placeholder}
              autoComplete='new-password'
            />
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                className='mr-1'
                aria-label={visibleSecrets[field.variable] ? 'Hide secret' : 'Show secret'}
                aria-pressed={visibleSecrets[field.variable]}
                size='icon-xs'
                onClick={() => toggleSecretVisibility(field.variable)}>
                {visibleSecrets[field.variable] ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )

      case 'select':
        return (
          <Select onValueChange={formField.onChange} defaultValue={formField.value}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option: any) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'textarea':
        return <Textarea {...formField} placeholder={field.placeholder} rows={3} />

      case 'checkbox':
        return (
          <div className='flex items-center space-x-2'>
            <Checkbox checked={formField.value} onCheckedChange={formField.onChange} />
            <Label className='text-sm font-normal'>{field.label}</Label>
          </div>
        )

      default:
        return <Input {...formField} placeholder={field.placeholder} />
    }
  }

  // Render form field
  const renderField = (field: any) => {
    return (
      <FormField
        key={field.variable}
        control={form.control}
        name={`credentials.${field.variable}`}
        render={({ field: formField }) => (
          <FormItem>
            <FormLabel className='flex items-center gap-0.5'>
              {field.label}
              {field.helpText && <TooltipExplanation text={field.helpText} />}
              {field.required && <span className='text-destructive ml-1'>*</span>}
            </FormLabel>
            <FormControl>{renderFieldControl(field, formField)}</FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    )
  }

  const { title, description } = getDialogContent()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className=' max-h-[90vh] overflow-y-auto' position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6' autoComplete='off'>
            {/* Provider Selection (only when no provider specified) */}
            {mode === 'provider' && operation === 'create' && !provider && (
              <div className='space-y-2 gap-2 flex items-center'>
                <Label className='mb-0'>
                  Provider <span className='text-destructive'>*</span>
                </Label>
                <AiProviderPicker
                  value={selectedProvider}
                  onChange={setSelectedProvider}
                  placeholder='Choose an AI provider...'
                  providers={providers}
                />
              </div>
            )}

            {/* Only show form fields if provider is selected */}
            {selectedProvider && (
              <>
                {/* Model-specific fields (only for custom-model mode) */}
                {mode === 'custom-model' && (
                  <div className='space-y-4'>
                    <h3 className='text-sm font-semibold uppercase text-primary-500 mb-0.5 '>
                      Model Information
                    </h3>

                    {/* Model ID Field */}
                    <FormField
                      control={form.control}
                      name='modelId'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Model ID *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder='my-custom-model' />
                          </FormControl>
                          <FormDescription>
                            Unique identifier that will be used as the model name.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Model Type Radio Group */}
                    <FormField
                      control={form.control}
                      name='modelType'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Model Type *</FormLabel>
                          <FormControl>
                            <RadioGroup
                              value={field.value}
                              onValueChange={field.onChange}
                              className='flex flex-wrap gap-3 grid-cols-4'>
                              {availableModelTypes.map((option) => (
                                <div
                                  key={option.value}
                                  className='relative flex flex-col flex-1 gap-3 rounded-md border border-input p-4 shadow-xs outline-none has-[&_[data-state=checked]]:border-info'>
                                  <div className='flex items-center gap-2'>
                                    <RadioGroupItem
                                      id={`modelType-${option.value}`}
                                      value={option.value}
                                      className='peer after:absolute after:inset-0'
                                    />
                                    <Label
                                      htmlFor={`modelType-${option.value}`}
                                      className='font-medium cursor-pointer peer-data-[state=checked]:text-info'>
                                      {option.label}
                                    </Label>
                                  </div>
                                </div>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          <FormDescription>
                            Select the type of AI model you want to create.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Credentials Section (always present when provider selected) */}
                {getRelevantFields.length > 0 && (
                  <>
                    <Separator />
                    <div className='space-y-4'>
                      <h3 className='text-sm font-semibold uppercase text-primary-500 mb-0.5'>
                        {mode === 'provider' ? 'Provider Credentials' : 'Model Credentials'}
                      </h3>
                      <div className='space-y-4'>{getRelevantFields.map(renderField)}</div>
                    </div>
                  </>
                )}

                {/* Action Buttons */}
                <div className='flex justify-between pt-4'>
                  {/* Delete button (for provider edit mode OR custom-model edit mode) */}
                  {operation === 'edit' && (
                    <Button
                      type='button'
                      size='sm'
                      variant='destructive'
                      onClick={mode === 'provider' ? handleDeleteProvider : handleDeleteCustomModel}
                      loading={deleteProvider.isPending || deleteCustomModel.isPending}
                      loadingText='Removing...'>
                      {mode === 'provider' ? 'Remove API Key' : 'Remove Model'}
                    </Button>
                  )}

                  <div className='flex gap-2 ml-auto'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button
                      type='submit'
                      size='sm'
                      variant='outline'
                      loading={saveProviderConfiguration.isPending || saveCustomModel.isPending}
                      loadingText={
                        mode === 'provider'
                          ? 'Saving...'
                          : operation === 'create'
                            ? 'Creating...'
                            : 'Updating...'
                      }>
                      {mode === 'provider'
                        ? `${operation === 'create' ? 'Save' : 'Update'} Provider`
                        : `${operation === 'create' ? 'Create' : 'Update'} Custom Model`}
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Confirmation Dialog for Delete */}
            <ConfirmDialog />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Convenience component for creating new providers
 */
export function CreateProviderButton(
  props: Omit<CredentialConfigurationDialogProps, 'mode' | 'operation' | 'trigger'>
) {
  const [open, setOpen] = useState(false)

  return (
    <CredentialConfigurationDialog
      {...props}
      mode='provider'
      operation='create'
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant='outline' size='sm'>
          <PlusIcon />
          Add Provider
        </Button>
      }
    />
  )
}
