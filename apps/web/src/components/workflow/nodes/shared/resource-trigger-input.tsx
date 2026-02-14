// apps/web/src/components/workflow/nodes/shared/resource-trigger-input.tsx

'use client'

import type { ResourceId } from '@auxx/lib/workflow-engine/client'
import { useStoreApi } from '@xyflow/react'
import { Loader2 } from 'lucide-react'
import { useResource } from '~/components/resources'
import { ResourceTestInput } from '~/components/workflow/panels/run/tabs/resource-test-input'
import Section from '~/components/workflow/ui/section'
import type { TriggerInputProps } from '../trigger-registry'

/**
 * Resource trigger input component for test mode
 * Allows users to specify resource data and operation-specific fields
 * Delegates to ResourceTestInput for enhanced UX with resource picker
 */
export function ResourceTriggerInput({ inputs, errors, onChange }: TriggerInputProps) {
  const store = useStoreApi()

  // Get the current workflow state to determine the trigger node
  const workflowState = store.getState()

  // Find the unified resource trigger node
  const resourceTriggerNode = workflowState.nodes.find((node) => {
    const nodeType = (node.data?.type || node.type) as string
    return nodeType === 'resource-trigger'
  })

  if (!resourceTriggerNode) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='text-sm text-destructive'>No resource trigger node found in workflow</div>
      </Section>
    )
  }

  // Get resourceType and operation from node.data
  const resourceType = resourceTriggerNode.data?.resourceType as string | undefined
  const operation = resourceTriggerNode.data?.operation as string | undefined

  if (!resourceType || !operation) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='text-sm text-destructive'>
          Resource trigger is not configured. Please configure the resource type and operation in
          the trigger node.
        </div>
      </Section>
    )
  }

  // Get resource config from provider (supports both system and custom resources)
  const { resource, isLoading: isLoadingResources } = useResource(resourceType)

  // Show loading state while resources are being fetched
  if (isLoadingResources) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' />
          Loading resource configuration...
        </div>
      </Section>
    )
  }

  // Validate resource type using ResourceProvider (supports both system and custom resources)
  if (!resource) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='text-sm text-destructive'>
          Invalid resource type: "{resourceType}". This resource type could not be found.
        </div>
      </Section>
    )
  }

  // Delegate to the enhanced component with resource picker
  return (
    <ResourceTestInput
      resourceType={resourceType as ResourceId}
      operation={operation as 'created' | 'updated' | 'deleted'}
      inputs={inputs}
      errors={errors}
      onChange={onChange}
    />
  )
}
