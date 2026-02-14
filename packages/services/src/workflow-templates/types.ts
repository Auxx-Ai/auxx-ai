// packages/services/src/workflow-templates/types.ts

/**
 * Input for querying workflow templates
 */
export interface GetWorkflowTemplatesInput {
  limit?: number
  offset?: number
  search?: string
  status?: 'public' | 'private' | 'all'
  categories?: string[]
}

/**
 * Input for creating a workflow template
 */
export interface CreateWorkflowTemplateInput {
  name: string
  description: string
  categories: string[]
  imgUrl?: string
  graph: any
  version?: number
  status?: 'public' | 'private'
  triggerType?: string
  triggerConfig?: Record<string, any>
  envVars?: Array<{
    id: string
    name: string
    value: any
    type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
  }>
  variables?: any[]
  popularity?: number
}

/**
 * Input for updating a workflow template
 */
export interface UpdateWorkflowTemplateInput {
  id: string
  name?: string
  description?: string
  categories?: string[]
  imgUrl?: string
  graph?: any
  version?: number
  status?: 'public' | 'private'
  triggerType?: string
  triggerConfig?: Record<string, any>
  envVars?: Array<{
    id: string
    name: string
    value: any
    type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
  }>
  variables?: any[]
  popularity?: number
}

/**
 * Workflow template list item (without graph data for performance)
 */
export interface WorkflowTemplateListItem {
  id: string
  name: string
  description: string
  categories: string[]
  imgUrl: string | null
  version: number
  status: string
  triggerType: string | null
  popularity: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Workflow template detail (with complete graph data)
 */
export interface WorkflowTemplateDetail {
  id: string
  name: string
  description: string
  categories: string[]
  imgUrl: string | null
  graph: any
  version: number
  status: string
  triggerType: string | null
  triggerConfig: Record<string, any> | null
  envVars: Array<{
    id: string
    name: string
    value: any
    type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
  }> | null
  variables: any[] | null
  popularity: number
  createdAt: Date
  updatedAt: Date
}
