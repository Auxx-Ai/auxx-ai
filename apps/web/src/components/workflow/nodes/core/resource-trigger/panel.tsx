// apps/web/src/components/workflow/nodes/core/resource-trigger/panel.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Info } from 'lucide-react'
import type React from 'react'
import { memo, useEffect, useMemo } from 'react'
import { useResource, useResourceFields } from '~/components/resources'
import { useNodeCrud } from '~/components/workflow/hooks'
import Field from '~/components/workflow/ui/field'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { useWorkflowResources } from '../../../providers'
import { BasePanel } from '../../shared/base/base-panel'
import { getResourceTriggerName } from '../../shared/resource-trigger-utils'
import { getResourceTriggerOutputVariables } from './output-variables'
import type { ResourceTriggerData } from './types'

/** Operations remain static */
const RESOURCE_OPERATIONS: Record<string, { operation: string; label: string }> = {
  created: { operation: 'created', label: 'Created' },
  updated: { operation: 'updated', label: 'Updated' },
  deleted: { operation: 'deleted', label: 'Deleted' },
  manual: { operation: 'manual', label: 'Manual' },
}

interface ResourceTriggerPanelProps {
  nodeId: string
  data: ResourceTriggerData
}

const ResourceTriggerPanelComponent: React.FC<ResourceTriggerPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<ResourceTriggerData>(
    nodeId,
    data
  )

  // Get all resources dynamically (system + custom entities)
  const { resources, isLoadingResources } = useWorkflowResources()

  // Get resourceType and operation from node.data
  const resourceType = nodeData.resourceType || 'contact'
  const operation = nodeData.operation || 'created'

  // Get current resource and its fields
  const { resource: currentResource } = useResource(resourceType)
  const { fields } = useResourceFields(resourceType)

  // Build resource options for select
  const resourceOptions = useMemo(
    () =>
      resources.map((r) => ({
        value: r.id,
        label: r.label,
        icon: r.icon,
      })),
    [resources]
  )

  // Ensure node.data has resourceType, entityDefinitionId, and operation on mount
  useEffect(() => {
    if (!nodeData.resourceType || !nodeData.operation || !nodeData.entityDefinitionId) {
      const currentResourceData = resources.find((r) => r.id === resourceType)
      setNodeData({
        ...nodeData,
        resourceType: resourceType,
        entityDefinitionId: currentResourceData?.entityDefinitionId || resourceType,
        operation,
      })
    }
  }, []) // Only run once on mount

  // Change handlers
  const handleResourceTypeChange = (newResourceType: string) => {
    const newResource = resources.find((r) => r.id === newResourceType)
    const operationLabel = RESOURCE_OPERATIONS[operation]?.label || ''

    setNodeData({
      ...nodeData,
      resourceType: newResourceType,
      entityDefinitionId: newResource?.entityDefinitionId || newResourceType, // Store entityDefinitionId from resource
      title: `${newResource?.label || newResourceType} ${operationLabel}`,
      icon: newResource?.icon || 'zap',
    })
  }

  const handleOperationChange = (newOperation: string) => {
    const newOperationConfig = RESOURCE_OPERATIONS[newOperation]

    setNodeData({
      ...nodeData,
      operation: newOperation as 'created' | 'updated' | 'deleted' | 'manual',
      title: `${currentResource?.label || resourceType} ${newOperationConfig?.label || ''}`,
    })
  }

  // Build resource with fields for output variable generation (same pattern as Find node)
  const resourceWithFields = useMemo(() => {
    if (!currentResource) return undefined
    return { ...currentResource, fields }
  }, [currentResource, fields])

  const operationConfig = RESOURCE_OPERATIONS[operation]

  // Generate trigger name for display
  const triggerName = getResourceTriggerName(resourceType, operation)

  // Show loading state while resources are loading
  if (isLoadingResources) {
    return (
      <BasePanel nodeId={nodeId} data={nodeData}>
        <Section title='General'>
          <div className='text-center py-8 text-sm text-muted-foreground'>Loading resources...</div>
        </Section>
      </BasePanel>
    )
  }

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Trigger Information */}
      <Section title='General'>
        <div className='space-y-4'>
          <Field
            title='Resource'
            description='Select the operation and type of resource for this trigger'>
            <VarEditorField className='px-0.5'>
              <div className='flex flex-row'>
                <div className=''>
                  <Select value={operation} onValueChange={handleOperationChange}>
                    <SelectTrigger variant='outline' size='xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RESOURCE_OPERATIONS).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex-1'>
                  <Select value={resourceType} onValueChange={handleResourceTypeChange}>
                    <SelectTrigger variant='transparent' size='xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} className='ps-1'>
                          <div className='flex items-center'>
                            <EntityIcon
                              iconId={option.icon}
                              variant='full'
                              size='sm'
                              className='mr-1'
                            />
                            {option.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </VarEditorField>
          </Field>
        </div>
      </Section>

      {/* Output Variables Display - call with full context like Find node */}
      <OutputVariablesDisplay
        outputVariables={getResourceTriggerOutputVariables(
          nodeData,
          nodeId,
          resourceWithFields,
          resources
        )}
        initialOpen={false}
      />

      <div className='pt-4 px-4'>
        <Alert>
          <Info className='size-4' />
          <AlertDescription>
            <div className='space-y-2'>
              <div>
                {operation === 'manual'
                  ? `This workflow is triggered manually for a specific ${currentResource?.label?.toLowerCase() || resourceType}. The complete data will be available in the workflow.`
                  : `Triggers when a ${currentResource?.label?.toLowerCase() || resourceType} is ${operation}.`}
              </div>
              <div className='font-mono text-xs text-muted-foreground'>Event: {triggerName}</div>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </BasePanel>
  )
}

export const ResourceTriggerPanel = memo(ResourceTriggerPanelComponent)
