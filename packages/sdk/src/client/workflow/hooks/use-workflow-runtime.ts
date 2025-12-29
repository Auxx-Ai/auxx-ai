// packages/sdk/src/client/workflow/hooks/use-workflow-runtime.ts

'use client'

import { createContext, useContext } from 'react'
import type { Connection } from './use-workflow-node.js'

/**
 * Workflow variable definition
 */
export interface WorkflowVariable {
  /** Node ID that produces this variable */
  nodeId: string
  /** Node label/name */
  nodeName: string
  /** Output variables from this node */
  outputs: Array<{
    name: string
    type: string
    value: any
  }>
}

/**
 * User information in workflow context
 */
export interface WorkflowUser {
  /** User ID */
  id: string
  /** User email */
  email: string
  /** User name */
  name: string
}

/**
 * Organization information in workflow context
 */
export interface WorkflowOrganization {
  /** Organization ID */
  id: string
  /** Organization handle */
  handle: string
  /** Organization name */
  name: string
}

/**
 * Workflow runtime context data
 */
export interface WorkflowRuntimeContextData {
  /** Workflow ID */
  workflowId: string

  /** Workflow name */
  workflowName: string

  /** Available variables from other nodes */
  variables: WorkflowVariable[]

  /** Get a specific variable by node ID and output name */
  getVariable: (nodeId: string, outputName: string) => any

  /** Workflow settings */
  settings: Record<string, any>

  /** Get a specific setting value */
  getSetting: (key: string) => any

  /** Current user information */
  user: WorkflowUser

  /** Current organization information */
  organization: WorkflowOrganization

  /** App connection (if available) */
  connection?: Connection

  /** Whether the app has a connection */
  hasConnection: boolean
}

/**
 * React context for workflow runtime data
 */
export const WorkflowRuntimeContext = createContext<WorkflowRuntimeContextData | null>(null)

/**
 * Access workflow runtime context and SDK methods.
 *
 * This hook provides access to workflow-level information including variables
 * from other nodes, settings, user/organization info, and connection status.
 *
 * @example
 * ```typescript
 * export function ApiRequestPanel() {
 *   const { connection, hasConnection, variables } = useWorkflowRuntime()
 *   const { StringInput, Section } = useWorkflow(apiRequestSchema.input)
 *
 *   if (!hasConnection) {
 *     return (
 *       <WorkflowPanel>
 *         <Alert variant="warning">
 *           Please connect your API account in settings.
 *         </Alert>
 *       </WorkflowPanel>
 *     )
 *   }
 *
 *   return (
 *     <WorkflowPanel>
 *       <Section>
 *         <StringInput name="endpoint" />
 *
 *         {/* Show available variables *\/}
 *         <div className="mt-2">
 *           <label className="text-sm text-muted-foreground">
 *             Available variables:
 *           </label>
 *           {variables.map((v) => (
 *             <Badge key={v.nodeId}>{v.nodeName}</Badge>
 *           ))}
 *         </div>
 *       </Section>
 *     </WorkflowPanel>
 *   )
 * }
 * ```
 */
export function useWorkflowRuntime(): WorkflowRuntimeContextData {
  const context = useContext(WorkflowRuntimeContext)

  if (!context) {
    throw new Error(
      'useWorkflowRuntime must be used within a WorkflowRuntimeContext.Provider'
    )
  }

  return context
}
