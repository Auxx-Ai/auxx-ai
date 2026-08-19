// packages/lib/src/workflow-engine/validation/form-input-validator.ts

import { getExtensionsForCategories } from '../../files/file-type-constants'
import {
  type FormInputNodeData,
  isEmptyFormInputValue,
  isMultiSelect,
} from '../catalog/nodes/form-input'
import { BaseType } from '../core/types'

/**
 * Form input configuration for validation.
 *
 * NOT the node's data shape: this is a flattened extract of a persisted graph,
 * keyed by `nodeId` and carrying only what submission validation reads (see
 * {@link extractFormInputConfigs}). The nested option shapes ARE the catalog's,
 * picked rather than re-declared — `allowMultiple` is optional here because the
 * extract copies whatever the stored node carries.
 */
export interface FormInputConfig {
  nodeId: string
  label: string
  inputType: BaseType
  required?: boolean
  hint?: string // Helper text shown to end users when filling the input field
  typeOptions?: {
    enum?: NonNullable<FormInputNodeData['typeOptions']>['enum']
    file?: Partial<NonNullable<NonNullable<FormInputNodeData['typeOptions']>['file']>>
  }
}

/**
 * Validation error
 */
export interface ValidationError {
  nodeId: string
  field: string
  message: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Extract form-input configs from workflow graph
 * Works with the serialized graph format from the database
 */
export function extractFormInputConfigs(graph: any): FormInputConfig[] {
  const nodes = graph?.nodes || []
  const configs: FormInputConfig[] = []

  for (const node of nodes) {
    if (node.data?.type !== 'form-input') continue

    configs.push({
      nodeId: node.id,
      label: node.data.label || node.data.title || 'Input',
      inputType: node.data.inputType || BaseType.STRING,
      required: node.data.required ?? false,
      hint: node.data.hint,
      typeOptions: node.data.typeOptions,
    })
  }

  return configs
}

/**
 * Validate workflow inputs against form-input configurations
 * This is the single source of truth for form input validation
 */
export function validateFormInputs(graph: any, inputs: Record<string, any>): ValidationResult {
  const configs = extractFormInputConfigs(graph)
  const errors: ValidationError[] = []

  for (const config of configs) {
    const value = inputs[config.nodeId]
    const isEmpty = isEmptyFormInputValue(value)

    // Required check
    if (config.required && isEmpty) {
      errors.push({
        nodeId: config.nodeId,
        field: config.label,
        message: `${config.label} is required`,
      })
      continue
    }

    // Skip further validation if empty and not required
    if (isEmpty) continue

    // Type-specific validation
    switch (config.inputType) {
      case BaseType.EMAIL:
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Invalid email address',
          })
        }
        break

      case BaseType.URL:
        try {
          new URL(String(value))
        } catch {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Invalid URL',
          })
        }
        break

      case BaseType.NUMBER:
        if (Number.isNaN(Number(value))) {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Must be a number',
          })
        }
        break

      case BaseType.ENUM: {
        const options = config.typeOptions?.enum?.options
        if (options) {
          const validValues = new Set(options.map((o) => o.value))
          // A multi Select submits an array; every member has to be a declared
          // option. `String(value)` on an array yields "a,b", which matches no
          // option — so the two cases cannot share one comparison.
          const selected = isMultiSelect(config)
            ? Array.isArray(value)
              ? value
              : [value]
            : [value]
          if (selected.some((v) => !validValues.has(String(v)))) {
            errors.push({
              nodeId: config.nodeId,
              field: config.label,
              message: 'Invalid selection',
            })
          }
        }
        break
      }

      case BaseType.BOOLEAN:
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Must be true or false',
          })
        }
        break

      case BaseType.FILE: {
        const fileOpts = config.typeOptions?.file
        if (fileOpts) {
          // Handle both array and single file values
          const files = Array.isArray(value) ? value : [value]
          const validFiles = files.filter((f) => f && typeof f === 'object')

          // Validate max files
          if (fileOpts.maxFiles && validFiles.length > fileOpts.maxFiles) {
            errors.push({
              nodeId: config.nodeId,
              field: config.label,
              message: `Maximum ${fileOpts.maxFiles} files allowed`,
            })
          }

          // Validate file types
          if (fileOpts.allowedFileTypes?.length) {
            const allowedExtensions = getExtensionsForCategories(
              fileOpts.allowedFileTypes,
              fileOpts.allowedFileExtensions
            )

            for (const file of validFiles) {
              const filename = (file as { filename?: string })?.filename
              if (filename && allowedExtensions.length > 0) {
                const ext = '.' + filename.split('.').pop()?.toLowerCase()
                if (!allowedExtensions.includes(ext)) {
                  errors.push({
                    nodeId: config.nodeId,
                    field: config.label,
                    message: `File type ${ext} not allowed`,
                  })
                }
              }
            }
          }
        }
        break
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
