// apps/web/src/components/workflow/share/workflow-trigger-form.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BaseType } from '../types'
import { FormInputField } from '../ui/form-input-field'
import { VarEditorField } from '../ui/input-editor/var-editor'
import { extractFormInputNodes, type WorkflowGraph } from '../utils/form-input-utils'
import { useWorkflowRun } from './hooks/use-workflow-run'
import { useWorkflowShareStore } from './workflow-share-provider'

/**
 * Props for WorkflowTriggerForm component
 */
interface WorkflowTriggerFormProps {
  submitButtonText: string
}

/**
 * Form for collecting workflow inputs and triggering execution
 * Renders form-input nodes extracted from the workflow graph
 * Stays visible during execution with disabled fields
 */
export function WorkflowTriggerForm({ submitButtonText }: WorkflowTriggerFormProps) {
  const shareToken = useWorkflowShareStore((s) => s.shareToken)
  const passport = useWorkflowShareStore((s) => s.passport)
  const siteInfo = useWorkflowShareStore((s) => s.siteInfo)
  const executionError = useWorkflowShareStore((s) => s.executionError)
  const currentRun = useWorkflowShareStore((s) => s.currentRun)
  const isExecuting = useWorkflowShareStore((s) => s.isExecuting)

  const { executeRun, cancelRun, resetRun } = useWorkflowRun(shareToken!)

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Check if workflow is currently running
  // isExecuting covers the initial fetch phase before currentRun is set
  const isRunning =
    isExecuting || currentRun?.status === 'running' || currentRun?.status === 'pending'

  // Extract form-input configs from workflow graph
  const formInputConfigs = useMemo(() => {
    if (!siteInfo?.workflow?.graph) return []
    return extractFormInputNodes(siteInfo.workflow.graph as WorkflowGraph)
  }, [siteInfo?.workflow?.graph])

  /**
   * Compute inputs with default values from form configs
   * Used for both initial state and reset/clear operations
   */
  const computeDefaultInputs = useCallback(
    (configs: typeof formInputConfigs): Record<string, any> => {
      const result: Record<string, any> = {}
      for (const config of configs) {
        if (config.inputType === BaseType.BOOLEAN) {
          // Booleans default to false if no default specified
          result[config.nodeId] = config.defaultValue ?? false
        } else if (config.defaultValue !== undefined) {
          result[config.nodeId] = config.defaultValue
        }
      }
      return result
    },
    []
  )

  // Initialize inputs with defaults synchronously to avoid flash of empty values
  const [inputs, setInputs] = useState<Record<string, any>>(() =>
    computeDefaultInputs(formInputConfigs)
  )

  // Re-initialize when formInputConfigs changes (e.g., different workflow loaded)
  // Only set values for NEW fields that aren't already in state
  useEffect(() => {
    if (formInputConfigs.length === 0) return

    setInputs((prev) => {
      const newInputs = { ...prev }
      let hasChanges = false

      for (const config of formInputConfigs) {
        // Only initialize if this is a NEW field (not already in prev state)
        if (!(config.nodeId in prev)) {
          if (config.inputType === BaseType.BOOLEAN) {
            newInputs[config.nodeId] = config.defaultValue ?? false
            hasChanges = true
          } else if (config.defaultValue !== undefined) {
            newInputs[config.nodeId] = config.defaultValue
            hasChanges = true
          }
        }
      }

      return hasChanges ? newInputs : prev
    })
  }, [formInputConfigs])

  /**
   * Handle input change
   */
  const handleChange = useCallback((nodeId: string, value: any) => {
    setInputs((prev) => ({ ...prev, [nodeId]: value }))
    // Clear error when user changes input
    setErrors((prev) => {
      const next = { ...prev }
      delete next[nodeId]
      return next
    })
  }, [])

  /**
   * Handle input error
   */
  const handleError = useCallback((nodeId: string, error: string | null) => {
    setErrors((prev) => {
      if (error === null) {
        const next = { ...prev }
        delete next[nodeId]
        return next
      }
      return { ...prev, [nodeId]: error }
    })
  }, [])

  /**
   * Validate inputs before submission
   */
  const validateInputs = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}

    for (const config of formInputConfigs) {
      const value = inputs[config.nodeId]

      // Determine if value is empty based on type
      // For booleans, false is a valid value - only undefined/null is empty
      const isEmpty =
        config.inputType === BaseType.BOOLEAN
          ? value === undefined || value === null
          : value === undefined || value === null || value === ''

      // Check required - handle different types appropriately
      if (config.required && isEmpty) {
        // For file inputs, check if value is a file object or array with files
        if (config.inputType === BaseType.FILE) {
          const hasFiles =
            value &&
            ((Array.isArray(value) && value.length > 0) || (!Array.isArray(value) && value.id))
          if (!hasFiles) {
            newErrors[config.nodeId] = `${config.label} is required`
            continue
          }
        } else {
          newErrors[config.nodeId] = `${config.label} is required`
          continue
        }
      }

      // Type-specific validation
      if (!isEmpty) {
        switch (config.inputType) {
          case BaseType.EMAIL:
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
              newErrors[config.nodeId] = 'Invalid email address'
            }
            break
          case BaseType.URL:
            try {
              new URL(String(value))
            } catch {
              newErrors[config.nodeId] = 'Invalid URL'
            }
            break
          case BaseType.NUMBER:
            if (Number.isNaN(Number(value))) {
              newErrors[config.nodeId] = 'Must be a number'
            }
            break
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formInputConfigs, inputs])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateInputs()) return

    await executeRun(inputs)
  }

  /**
   * Handle run again after completion
   */
  const handleRunAgain = () => {
    resetRun()
  }

  /**
   * Clear form and reset run state
   */
  const handleClear = () => {
    setInputs(computeDefaultInputs(formInputConfigs))
    setErrors({})
    resetRun()
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4 min-h-0 flex flex-col'>
      {formInputConfigs.length === 0 ? (
        <p className='text-muted-foreground'>This workflow has no inputs.</p>
      ) : (
        <VarEditorField className='p-0' orientation='vertical'>
          {formInputConfigs.map((config) => (
            <FormInputField
              key={config.nodeId}
              config={config}
              value={inputs[config.nodeId]}
              error={errors[config.nodeId]}
              onChange={handleChange}
              onError={handleError}
              isLoading={isRunning}
              isPublicContext={true}
              shareToken={shareToken!}
              passport={passport!}
            />
          ))}
        </VarEditorField>
      )}

      {/* Validation errors summary */}
      {Object.keys(errors).length > 0 && (
        <Alert variant='destructive'>
          <AlertCircle />
          <AlertDescription>Please fix the errors above before submitting.</AlertDescription>
        </Alert>
      )}

      {/* Execution error */}
      {executionError && (
        <Alert variant='destructive'>
          <AlertCircle />
          <AlertDescription>{executionError}</AlertDescription>
        </Alert>
      )}

      {/* Buttons - always show two buttons */}
      <div className='flex gap-2'>
        {isRunning ? (
          // While running: [Cancel] [Running...]
          <>
            <Button type='button' variant='outline' className='flex-1' onClick={cancelRun}>
              Cancel
            </Button>
            <Button type='submit' className='flex-1' loading loadingText='Running...' disabled>
              {submitButtonText}
            </Button>
          </>
        ) : currentRun ? (
          // After completion: [Clear] [Run Again]
          <>
            <Button type='button' variant='outline' className='flex-1' onClick={handleClear}>
              Clear
            </Button>
            <Button type='button' className='flex-1' onClick={handleRunAgain}>
              Run Again
            </Button>
          </>
        ) : (
          // Idle state: [Clear] [Run Workflow]
          <>
            <Button type='button' variant='outline' className='flex-1' onClick={handleClear}>
              Clear
            </Button>
            <Button type='submit' className='flex-1'>
              {submitButtonText}
            </Button>
          </>
        )}
      </div>
    </form>
  )
}
