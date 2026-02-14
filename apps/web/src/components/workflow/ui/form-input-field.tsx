// apps/web/src/components/workflow/ui/form-input-field.tsx

'use client'

import { getMimePatternsForCategories } from '@auxx/lib/files/client'
import { memo, useMemo } from 'react'
import type { TypeOptions } from '~/components/workflow/nodes/inputs/form-input/types'
import {
  PublicFileInput,
  type PublicFileMetadata,
} from '~/components/workflow/share/inputs/public-file-input'
import { BaseType } from '~/components/workflow/types'
import { getInputComponent, getSpecificPropsForType } from './input-editor/get-input-component'
import { VarEditorFieldRow } from './input-editor/var-editor'

/**
 * Simplified form input config for rendering
 * Used by both ManualTriggerInput and WorkflowTriggerForm
 */
export interface FormInputConfig {
  nodeId: string
  label: string
  inputType: BaseType
  description?: string
  required?: boolean
  placeholder?: string
  typeOptions?: TypeOptions
  defaultValue?: any
}

/**
 * Props for FormInputField component
 */
export interface FormInputFieldProps {
  config: FormInputConfig
  value: any
  error?: string
  onChange: (nodeId: string, value: any) => void
  onError?: (nodeId: string, error: string | null) => void
  isLoading?: boolean
  /** Public context props - required for file uploads in shared workflows */
  isPublicContext?: boolean
  shareToken?: string
  passport?: string
}

/**
 * Shared component for rendering a form-input field
 * Used by both ManualTriggerInput and WorkflowTriggerForm
 * Renders using VarEditorFieldRow pattern with appropriate input component
 *
 * For file inputs in public context, uses PublicFileInput component
 * which handles presigned URL uploads with passport authentication
 */
export const FormInputField = memo(function FormInputField({
  config,
  value,
  error,
  onChange,
  onError,
  isLoading,
  isPublicContext,
  shareToken,
  passport,
}: FormInputFieldProps) {
  const {
    nodeId,
    label,
    inputType,
    description,
    required,
    placeholder,
    typeOptions,
    defaultValue,
  } = config

  // Handle file inputs in public context specially
  // PublicFileInput uses presigned URLs and passport auth instead of FilesystemProvider
  if (isPublicContext && inputType === BaseType.FILE && shareToken && passport) {
    const fileValue = value as PublicFileMetadata | PublicFileMetadata[] | null

    // Convert maxFileSize from MB to bytes (typeOptions stores in MB)
    const maxFileSizeBytes = typeOptions?.file?.maxFileSize
      ? typeOptions.file.maxFileSize * 1024 * 1024
      : undefined

    // Convert file type categories to MIME patterns, falling back to legacy allowedTypes
    const allowedMimeTypes = typeOptions?.file?.allowedFileTypes
      ? getMimePatternsForCategories(
          typeOptions.file.allowedFileTypes,
          typeOptions.file.allowedFileExtensions
        )
      : typeOptions?.file?.allowedTypes

    return (
      <VarEditorFieldRow
        title={label}
        type={inputType}
        description={description}
        isRequired={required}
        validationError={error}
        validationType={error ? 'error' : undefined}
        className='[&_[data-slot=field-row-label]]:font-medium'>
        <PublicFileInput
          name={nodeId}
          value={fileValue}
          onChange={(_, val) => onChange(nodeId, val)}
          allowMultiple={typeOptions?.file?.allowMultiple}
          maxFiles={typeOptions?.file?.maxFiles}
          maxFileSize={maxFileSizeBytes}
          allowedTypes={allowedMimeTypes}
          disabled={isLoading}
          shareToken={shareToken}
          passport={passport}
          nodeId={nodeId}
          placeholder={placeholder || `Upload file`}
        />
      </VarEditorFieldRow>
    )
  }

  // Get the appropriate input component for this type
  const InputComponent = getInputComponent(inputType)

  // Build common props following NodeInputProps interface
  const commonProps = {
    inputs: { [nodeId]: value },
    errors: error ? { [nodeId]: error } : {},
    onChange: (_name: string, val: any) => onChange(nodeId, val),
    onError: (_name: string, err: string | null) => onError?.(nodeId, err),
    isLoading,
  }

  // Get type-specific props using the shared helper
  const specificProps = {
    name: nodeId,
    label,
    description,
    required,
    placeholder: placeholder || `Enter ${label}`,
    defaultValue, // Pass through for fallback in input components (e.g., EnumInput)
    ...getSpecificPropsForType(inputType, {
      fieldOptions: {
        enum: typeOptions?.enum,
        currency: typeOptions?.currency
          ? {
              currencyCode: typeOptions.currency.currencyCode,
              decimalPlaces:
                typeOptions.currency.decimalPlaces === 'no-decimal' ? 'no-decimal' : undefined,
              displayType: typeOptions.currency.displayType,
              groups: typeOptions.currency.groups,
            }
          : undefined,
        variant: typeOptions?.boolean?.variant,
        allowMultiple: typeOptions?.file?.allowMultiple,
      },
    }),
  }

  return (
    <VarEditorFieldRow
      title={label}
      type={inputType}
      description={description}
      isRequired={required}
      validationError={error}
      validationType={error ? 'error' : undefined}
      className='[&_[data-slot=field-row-label]]:font-medium'>
      <InputComponent {...commonProps} {...specificProps} />
    </VarEditorFieldRow>
  )
})
