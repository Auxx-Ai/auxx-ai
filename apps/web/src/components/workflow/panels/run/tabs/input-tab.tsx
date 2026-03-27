// apps/web/src/components/workflow/panels/run/tabs/input-tab.tsx

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { Alert, AlertDescription, AlertIcon } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { isMac } from '@auxx/utils'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useStoreApi } from '@xyflow/react'
import { AlertCircle, AlertTriangle, Play, Workflow } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useWorkflowTrigger } from '~/components/workflow/hooks'
import { initializeTriggers } from '~/components/workflow/nodes/initialize-triggers'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useDemo } from '~/hooks/use-demo'
import { useWorkflowRun } from '~/hooks/use-workflow-run'

// Initialize triggers once
initializeTriggers()

interface InputTabProps {
  workflowId?: string
  workflowAppId?: string
}

/**
 * Input tab for configuring and starting workflow runs
 */
export function InputTab({ workflowId, workflowAppId }: InputTabProps) {
  const workflow = useWorkflowStore((state) => state.workflow)
  const isRunning = useRunStore((state) => state.isRunning)
  const activeRun = useRunStore((state) => state.activeRun)
  const setRunPanelTab = usePanelStore((state) => state.setRunPanelTab)
  const { isDemo } = useDemo()
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)

  // Get ReactFlow store for reading current node data
  const reactFlowStore = useStoreApi()

  // Workflow run hook for SSE and lifecycle management
  const { startRun } = useWorkflowRun()

  // Use the workflow trigger hook
  const { hasTrigger, triggerType, triggerConfig, validateTriggerInputs, getDefaultInputs } =
    useWorkflowTrigger()

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize inputs based on workflow and trigger
  useEffect(() => {
    const workflowWithEnvVars = workflow as any
    const defaultInputs: Record<string, any> = {}

    // Add trigger-specific default inputs
    if (hasTrigger && triggerConfig) {
      const triggerDefaults = getDefaultInputs()
      Object.assign(defaultInputs, triggerDefaults)
    }

    // Add environment variables
    if (workflowWithEnvVars?.envVars) {
      const envVars = workflowWithEnvVars.envVars as Array<{
        id: string
        name: string
        value: any
        type: string
      }>

      envVars.forEach((envVar) => {
        // Only include non-secret variables in inputs
        if (envVar.type !== 'secret') {
          defaultInputs[envVar.name] = envVar.value
        }
      })
    }

    // Only set inputs if they're different to prevent infinite loops
    setInputs((currentInputs) => {
      // Check if inputs have changed
      const hasChanged =
        Object.keys(defaultInputs).length !== Object.keys(currentInputs).length ||
        Object.keys(defaultInputs).some((key) => defaultInputs[key] !== currentInputs[key])

      return hasChanged ? defaultInputs : currentInputs
    })
  }, [workflow, hasTrigger, triggerConfig, getDefaultInputs])

  const handleInputChange = useCallback(
    (name: string, value: any) => {
      setInputs((prev) => ({ ...prev, [name]: value }))

      // Clear error for this field
      if (errors[name]) {
        setErrors((prev) => {
          const newErrors = { ...prev }
          delete newErrors[name]
          return newErrors
        })
      }
    },
    [errors]
  )

  const validateInputs = () => {
    const newErrors: Record<string, string> = {}

    // Validate trigger inputs
    if (hasTrigger && triggerConfig) {
      const triggerValidation = validateTriggerInputs(inputs)
      if (!triggerValidation.isValid) {
        triggerValidation.errors.forEach((error) => {
          newErrors[error.field] = error.message
        })
      }
    }

    // Validate required environment variables
    const workflowWithEnvVars = workflow as any
    if (workflowWithEnvVars?.envVars) {
      const envVars = workflowWithEnvVars.envVars as Array<{
        id: string
        name: string
        value: any
        type: string
      }>

      envVars.forEach((envVar) => {
        if (envVar.type !== 'secret' && !inputs[envVar.name]) {
          // Check if it's truly required (no default value)
          if (!envVar.value) {
            newErrors[envVar.name] = `${envVar.name} is required`
          }
        }
      })
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  /**
   * Format manual trigger inputs, ensuring files are in correct format
   */
  const formatManualTriggerInputs = (inputs: Record<string, any>): Record<string, any> => {
    const formatted: Record<string, any> = {}

    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value) && value.length > 0 && value[0]?.url) {
        // File input - ensure proper format
        formatted[key] = value.map((file: any) => ({
          id: file.id,
          fileId: file.fileId,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size,
          url: file.url,
          nodeId: file.nodeId,
          uploadedAt: file.uploadedAt,
          expiresAt: file.expiresAt,
        }))
      } else {
        // Regular input
        formatted[key] = value
      }
    }

    return formatted
  }

  /**
   * Strip internal fields (prefixed with _) from inputs before sending to workflow
   */
  const stripInternalFields = (inputs: Record<string, any>): Record<string, any> => {
    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(inputs)) {
      if (!key.startsWith('_')) {
        cleaned[key] = value
      }
    }
    return cleaned
  }

  const handleStartRun = async () => {
    // Show limit dialog for demo users
    if (isDemo) {
      setLimitDialogOpen(true)
      return
    }

    // Check if workflow has a trigger
    if (!hasTrigger) {
      toastError({
        title: 'No trigger defined',
        description: 'This workflow needs a trigger node to be run',
      })
      return
    }

    if (!validateInputs()) {
      return
    }

    if (!workflowId) {
      toastError({ title: 'Missing workflow information', description: 'Workflow ID is required' })
      return
    }

    try {
      // Prepare inputs based on trigger type
      let finalInputs = stripInternalFields(inputs)

      // Format inputs for MANUAL trigger to ensure file data is properly structured
      if (triggerType === WorkflowTriggerType.MANUAL) {
        finalInputs = formatManualTriggerInputs(finalInputs)
      }

      // Transform inputs for app triggers — parse JSON triggerData and spread as top-level inputs
      if (
        triggerType === WorkflowTriggerType.APP_TRIGGER ||
        triggerType === WorkflowTriggerType.APP_POLLING_TRIGGER
      ) {
        const raw = inputs.triggerData
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
        finalInputs = { ...parsed }
      }

      // Transform inputs for RESOURCE_TRIGGER to match expected format
      if (triggerType === WorkflowTriggerType.RESOURCE_TRIGGER) {
        // Get resource type from the trigger node - read from ReactFlow's live store
        const { nodes } = reactFlowStore.getState()
        const resourceTriggerNode = nodes.find((node: any) => {
          const nodeType = node.data?.type || node.type
          return nodeType === 'resource-trigger'
        })

        if (resourceTriggerNode?.data?.resourceType) {
          const resourceType = resourceTriggerNode.data.resourceType
          const { resourceData, selectedResourceId, ...otherInputs } = finalInputs

          // Transform: move resourceData to [resourceType] key and add timestamp
          finalInputs = {
            ...otherInputs,
            [resourceType]: resourceData || {},
            timestamp: new Date().toISOString(),
          }
        }
      }

      // Start the workflow run using the unified endpoint
      startRun({ workflowId, inputs: finalInputs, mode: 'test' })

      // Switch to the tracing tab to show execution progress
      setRunPanelTab('tracing')
    } catch (error) {
      toastError({
        title: 'Failed to start workflow',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Mod+Enter to run workflow when panel is open
  const handleStartRunRef = useRef(handleStartRun)
  handleStartRunRef.current = handleStartRun
  useHotkey('Mod+Enter', () => handleStartRunRef.current())

  return (
    <div className='space-y-4'>
      {/* No trigger warning */}
      {!hasTrigger && (
        <div className='pt-10 px-3'>
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertDescription>
              This workflow doesn't have a trigger node. Add a trigger node (like "Message
              Received") to enable workflow execution.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Trigger-specific inputs */}
      {hasTrigger && triggerConfig && (
        <triggerConfig.component
          inputs={inputs}
          errors={errors}
          onChange={handleInputChange}
          isLoading={isRunning}
        />
      )}

      <div className='p-3'>
        {/* No inputs message */}
        {hasTrigger &&
          !triggerConfig &&
          (!(workflow as any)?.envVars ||
            ((workflow as any).envVars as Array<any>).length === 0) && (
            <Alert className='mb-3'>
              <div className='flex items-center gap-2 flex-row'>
                <AlertIcon icon={AlertCircle}></AlertIcon>
                <AlertDescription>
                  This workflow doesn't require any inputs. Click "Run Workflow" to start testing.
                </AlertDescription>
              </div>
            </Alert>
          )}

        {/* Error summary */}
        {Object.keys(errors).length > 0 && (
          <Alert variant='destructive' className='mb-3'>
            <AlertCircle className='size-4' />
            <AlertDescription>
              Please fix the errors above before running the workflow.
            </AlertDescription>
          </Alert>
        )}

        {/* Run button */}
        <Button
          onClick={handleStartRun}
          disabled={!hasTrigger || (isRunning && activeRun?.status === 'RUNNING')}
          loading={isRunning && activeRun?.status === 'RUNNING'}
          loadingText='Running...'
          className='w-full'
          title={!hasTrigger ? 'Workflow needs a trigger node to run' : undefined}>
          <Play />
          Run Workflow
          <KbdGroup size='sm'>
            <Kbd shortcut={isMac() ? 'cmd' : 'ctrl'} />
            <Kbd shortcut='enter' />
          </KbdGroup>
        </Button>
      </div>

      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Workflow}
        title='Demo Limit Reached'
        description='Running workflows is not available in demo mode. Sign up to start automating your workflows.'
      />
    </div>
  )
}
