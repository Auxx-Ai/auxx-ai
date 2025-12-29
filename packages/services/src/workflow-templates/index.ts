// packages/services/src/workflow-templates/index.ts

// Export types
export type {
  GetWorkflowTemplatesInput,
  CreateWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  WorkflowTemplateListItem,
  WorkflowTemplateDetail,
} from './types'

// Export service functions
export { getAllTemplates } from './get-all-templates'
export { getTemplateById } from './get-template-by-id'
export { createTemplate } from './create-template'
export { updateTemplate } from './update-template'
export { deleteTemplate } from './delete-template'
export { duplicateTemplate } from './duplicate-template'
