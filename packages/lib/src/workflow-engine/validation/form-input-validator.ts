// packages/lib/src/workflow-engine/validation/form-input-validator.ts

import { BaseType } from '../core/types'
import {
  getExtensionsForCategories,
  type FileTypeCategory,
} from '../../files/file-type-constants'

/**
 * Select option for ENUM type
 */
interface EnumOption {
  label: string
  value: string
}

/**
 * File options for FILE type
 */
interface FileTypeOptions {
  allowMultiple?: boolean
  maxFiles?: number
  maxFileSize?: number
  allowedFileTypes?: FileTypeCategory[]
  allowedFileExtensions?: string[]
}

/**
 * Form input configuration for validation
 */
export interface FormInputConfig {
  nodeId: string
  label: string
  inputType: BaseType
  required?: boolean
  hint?: string // Helper text shown to end users when filling the input field
  typeOptions?: {
    enum?: EnumOption[]
    file?: FileTypeOptions
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
export function validateFormInputs(
  graph: any,
  inputs: Record<string, any>
): ValidationResult {
  const configs = extractFormInputConfigs(graph)
  const errors: ValidationError[] = []

  for (const config of configs) {
    const value = inputs[config.nodeId]
    const isEmpty = value === undefined || value === null || value === ''

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
        if (isNaN(Number(value))) {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Must be a number',
          })
        }
        break

      case BaseType.ENUM:
        if (config.typeOptions?.enum) {
          const validValues = config.typeOptions.enum.map((o) => o.value)
          if (!validValues.includes(String(value))) {
            errors.push({
              nodeId: config.nodeId,
              field: config.label,
              message: 'Invalid selection',
            })
          }
        }
        break

      case BaseType.BOOLEAN:
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push({
            nodeId: config.nodeId,
            field: config.label,
            message: 'Must be true or false',
          })
        }
        break

      case BaseType.FILE:
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

  return {
    valid: errors.length === 0,
    errors,
  }
}
