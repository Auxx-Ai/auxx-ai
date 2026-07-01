// apps/web/src/components/ai/ui/credential-configuration-dialog.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { PlusIcon, Trash2 } from 'lucide-react'
import type React from 'react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useCredentialForm } from '~/components/connections/hooks/use-credential-form'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { AiProviderPicker } from '~/components/pickers/ai-provider-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { ProviderConfiguration } from './utils'

/** Configuration mode for the unified dialog. */
type DialogMode = 'provider' | 'custom-model'
/** Operation type for the dialog. */
type DialogOperation = 'create' | 'edit'

interface CredentialConfigurationDialogProps {
  /** Configuration mode. */
  mode: DialogMode
  /** Provider to configure (optional — if not provided, shows provider picker). */
  provider?: string
  /** Model ID (required for custom-model mode). */
  modelId?: string
  /** Operation type. */
  operation: DialogOperation
  /** Dialog state. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Callbacks. */
  onProviderConfigured?: (provider: string) => void
  onModelCreated?: (modelData: any) => void
  /** Optional trigger. */
  trigger?: React.ReactNode
  /** Providers list passed from parent. */
  providers: ProviderConfiguration[]
}

/** Model type options for the custom-model radio group (filtered to provider support). */
const MODEL_TYPE_OPTIONS = [
  { value: ModelType.LLM, label: 'Language Model (LLM)' },
  { value: ModelType.TEXT_EMBEDDING, label: 'Text Embedding' },
  { value: ModelType.TTS, label: 'Text-to-Speech' },
  { value: ModelType.SPEECH2TEXT, label: 'Speech-to-Text' },
  { value: ModelType.VISION, label: 'Vision' },
  { value: ModelType.MODERATION, label: 'Moderation' },
  { value: ModelType.RERANK, label: 'Rerank' },
] as const

const MODEL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * AI provider/model credential dialog. A thin wrapper that owns only the AI-specific chrome
 * (provider picker, custom-model id/type, provider-vs-model scope filtering) and delegates the
 * credential fields to the shared connections field block (`ConnectionVariableFields`) — one
 * descriptor, one renderer, one validator across both worlds.
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
  const [selectedProvider, setSelectedProvider] = useState<string | null>(provider ?? null)
  const [modelIdValue, setModelIdValue] = useState(modelId ?? '')
  const [modelTypeValue, setModelTypeValue] = useState<ModelType>(ModelType.LLM)
  const [confirmDelete, ConfirmDialog] = useConfirm()

  const utils = api.useUtils()

  // Editing: load the masked stored credentials (secrets as the HIDDEN_VALUE sentinel, plain
  // fields real). Skipped for a fresh create, so a new provider starts blank.
  const { data: existingCredentials } = api.aiIntegration.getCredentials.useQuery(
    {
      mode: mode === 'custom-model' ? 'model' : 'provider',
      provider: selectedProvider ?? '',
      model: mode === 'custom-model' ? modelId : undefined,
    },
    {
      enabled: open && operation === 'edit' && !!selectedProvider,
      select: (data) => data.credentials,
    }
  )

  const providerCapabilities = useMemo(
    () => providers.find((p) => p.provider === selectedProvider) ?? null,
    [selectedProvider, providers]
  )

  // The visible fields for this scope: provider-mode shows provider/both fields, custom-model
  // shows model/both fields (scope/priority come from the AI-specific fieldMeta map).
  const currentScope = mode === 'custom-model' ? 'model' : 'provider'
  const visibleFields = useMemo(() => {
    if (!providerCapabilities) return []
    const meta = providerCapabilities.fieldMeta ?? {}
    return providerCapabilities.connectionVariables.filter((v) => {
      const scope = meta[v.key]?.scope ?? 'provider'
      return scope === currentScope || scope === 'both'
    })
  }, [providerCapabilities, currentScope])

  const availableModelTypes = useMemo(() => {
    if (!providerCapabilities?.supportedModelTypes) return MODEL_TYPE_OPTIONS
    return MODEL_TYPE_OPTIONS.filter((o) =>
      providerCapabilities.supportedModelTypes.includes(o.value)
    )
  }, [providerCapabilities])

  // Shared form lifecycle — field values/errors, seed-on-open, set-secret derivation, validation.
  // `visibleFields` is already scope-filtered (provider vs model), so the hook stays AI-agnostic.
  const needsLoad = operation === 'edit' && !!selectedProvider
  const { values, setValue, errors, setErrors, savedSecrets, validate } = useCredentialForm({
    open,
    variables: visibleFields,
    existingValues: existingCredentials,
    loading: needsLoad && !existingCredentials,
  })

  // Keep selectedProvider in sync with the prop when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedProvider excluded to avoid a loop.
  useEffect(() => {
    if (provider && provider !== selectedProvider) setSelectedProvider(provider)
  }, [provider])

  // The custom-model id/type chrome is AI-only, so it seeds alongside the shared values effect on
  // open / load.
  useEffect(() => {
    if (!open) return
    if (needsLoad && !existingCredentials) return
    setModelIdValue(modelId ?? '')
    setModelTypeValue(availableModelTypes[0]?.value ?? ModelType.LLM)
  }, [open, needsLoad, existingCredentials, modelId, availableModelTypes])

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
    },
    onError: (error) => toastError({ title: 'Configuration failed', description: error.message }),
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
    },
    onError: (error) =>
      toastError({
        title: operation === 'create' ? 'Failed to Create Model' : 'Failed to Update Model',
        description: error.message,
      }),
  })

  const deleteProvider = api.aiIntegration.deleteProviderConfiguration.useMutation({
    onSuccess: async (result) => {
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      await utils.aiIntegration.getQuotaStatus.invalidate()
      toastSuccess({ title: 'API key removed', description: result.message })
      onOpenChange(false)
    },
    onError: (error) =>
      toastError({ title: 'Failed to remove API key', description: error.message }),
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
    },
    onError: (error) =>
      toastError({ title: 'Failed to remove custom model', description: error.message }),
  })

  // Send each field as-is (omit empties). An unchanged secret carries the sentinel, which the
  // server drops to preserve the stored value.
  function collectCredentials(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const v of visibleFields) {
      const value = values[v.key] ?? ''
      if (value.trim().length === 0) continue
      out[v.key] = value
    }
    return out
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedProvider || !providerCapabilities) return

    const next = validate()
    if (mode === 'custom-model') {
      if (!modelIdValue.trim()) next.__modelId = 'Model ID is required'
      else if (!MODEL_ID_PATTERN.test(modelIdValue))
        next.__modelId = 'Only letters, numbers, hyphens, and underscores allowed'
      setErrors(next)
    }
    if (Object.keys(next).length > 0) return

    const credentials = collectCredentials()
    if (mode === 'provider') {
      await saveProviderConfiguration.mutateAsync({
        provider: selectedProvider,
        credentials,
        mode: operation,
      })
    } else {
      await saveCustomModel.mutateAsync({
        provider: selectedProvider,
        modelId: modelIdValue,
        modelType: modelTypeValue,
        credentials,
        mode: operation,
      })
    }
  }

  async function handleDeleteProvider() {
    if (!selectedProvider || !providerCapabilities) return
    const confirmed = await confirmDelete({
      title: `Remove ${providerCapabilities.displayName} API Key?`,
      description:
        'This will remove your custom API credentials. If you have system credits available, you will automatically switch to using them.',
      confirmText: 'Remove API Key',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) await deleteProvider.mutateAsync({ provider: selectedProvider })
  }

  async function handleDeleteCustomModel() {
    if (!selectedProvider || !modelId) return
    const confirmed = await confirmDelete({
      title: 'Remove custom model?',
      description:
        'This will remove the custom model and its configuration. This action cannot be undone.',
      confirmText: 'Remove Model',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) await deleteCustomModel.mutateAsync({ provider: selectedProvider, modelId })
  }

  const isProviderMode = mode === 'provider'
  const title = isProviderMode
    ? `${operation === 'create' ? 'Setup' : 'Edit'} ${providerCapabilities?.displayName ?? 'Provider'}`
    : `${operation === 'edit' ? 'Edit' : 'Add'} Custom ${providerCapabilities?.displayName ?? ''} Model`
  const description = isProviderMode
    ? selectedProvider
      ? `Configure your ${providerCapabilities?.displayName} API credentials.`
      : 'Choose a provider and configure your API credentials.'
    : `${operation === 'edit' ? 'Update your' : 'Create a'} custom ${providerCapabilities?.displayName ?? 'model'} configuration.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className='max-h-[90vh] overflow-y-auto' position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-6' autoComplete='off'>
          {/* Provider picker (only when no provider is preselected). */}
          {isProviderMode && operation === 'create' && !provider && (
            <div className='flex items-center gap-2'>
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

          {selectedProvider && (
            <>
              {/* Custom-model chrome. */}
              {mode === 'custom-model' && (
                <div className='space-y-4'>
                  <h3 className='text-sm font-semibold uppercase text-primary-500'>
                    Model Information
                  </h3>
                  <div className='space-y-1'>
                    <Label htmlFor='modelId'>Model ID *</Label>
                    <Input
                      id='modelId'
                      value={modelIdValue}
                      onChange={(e) => setModelIdValue(e.target.value)}
                      placeholder='my-custom-model'
                    />
                    {errors.__modelId && (
                      <p className='text-destructive text-sm'>{errors.__modelId}</p>
                    )}
                  </div>
                  <div className='space-y-1'>
                    <Label>Model Type *</Label>
                    <RadioGroup
                      value={modelTypeValue}
                      onValueChange={(v) => setModelTypeValue(v as ModelType)}
                      className='flex flex-wrap gap-2'>
                      {availableModelTypes.map((option) => (
                        <div
                          key={option.value}
                          className='relative flex items-center gap-2 rounded-md border border-input px-3 py-2 shadow-xs outline-none has-[&_[data-state=checked]]:border-info'>
                          <RadioGroupItem
                            id={`modelType-${option.value}`}
                            value={option.value}
                            className='peer after:absolute after:inset-0'
                          />
                          <Label
                            htmlFor={`modelType-${option.value}`}
                            className='font-medium whitespace-nowrap cursor-pointer peer-data-[state=checked]:text-info'>
                            {option.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </div>
              )}

              {/* Shared credential field block. */}
              {visibleFields.length > 0 && (
                <>
                  <Separator />
                  <div className='space-y-4'>
                    <h3 className='text-sm font-semibold uppercase text-primary-500'>
                      {isProviderMode ? 'Provider Credentials' : 'Model Credentials'}
                    </h3>
                    <FieldPanel
                      orientation='responsive'
                      breakpoint='md'
                      className='p-0'
                      resizeId='ai-credential'
                      defaultLabelWidth={280}>
                      <ConnectionVariableFields
                        variables={visibleFields}
                        values={values}
                        onValueChange={setValue}
                        errors={errors}
                        savedSecrets={savedSecrets}
                      />
                    </FieldPanel>
                  </div>
                </>
              )}

              <DialogFooter className='mt-0'>
                {operation === 'edit' && (
                  <Button
                    type='button'
                    size='sm'
                    variant='destructive-hover'
                    onClick={isProviderMode ? handleDeleteProvider : handleDeleteCustomModel}
                    loading={deleteProvider.isPending || deleteCustomModel.isPending}
                    loadingText='Removing...'
                    className='mr-auto'>
                    <Trash2 />
                    {isProviderMode ? 'Remove API Key' : 'Remove Model'}
                  </Button>
                )}
                <Button type='button' variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
                  Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                <Button
                  type='submit'
                  size='sm'
                  variant='outline'
                  loading={saveProviderConfiguration.isPending || saveCustomModel.isPending}
                  loadingText={
                    isProviderMode
                      ? 'Saving...'
                      : operation === 'create'
                        ? 'Creating...'
                        : 'Updating...'
                  }>
                  {isProviderMode
                    ? `${operation === 'create' ? 'Save' : 'Update'} Provider`
                    : `${operation === 'create' ? 'Create' : 'Update'} Custom Model`}{' '}
                  <KbdSubmit variant='outline' size='sm' />
                </Button>
              </DialogFooter>
            </>
          )}

          <ConfirmDialog />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Convenience component for creating new providers. */
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
