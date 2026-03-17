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
  icon?: { iconId: string; color: string }
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
  requiredApps?: RequiredApp[]
  requiredEntities?: any[]
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
  icon?: { iconId: string; color: string } | null
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
  requiredApps?: RequiredApp[]
  requiredEntities?: any[]
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
  icon: { iconId: string; color: string } | null
  version: number
  status: string
  triggerType: string | null
  requiredApps: RequiredApp[]
  popularity: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Workflow template detail (with complete graph data)
 */
/** Required app declaration for a template */
export interface RequiredApp {
  appSlug: string
  appTitle: string
  blockIds: string[]
  triggerIds: string[]
  required: boolean
}

export interface WorkflowTemplateDetail {
  id: string
  name: string
  description: string
  categories: string[]
  imgUrl: string | null
  icon: { iconId: string; color: string } | null
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
  requiredApps: RequiredApp[]
  requiredEntities: any[]
  popularity: number
  createdAt: Date
  updatedAt: Date
}
