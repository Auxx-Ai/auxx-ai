// packages/services/src/workflow-templates/index.ts

export { createTemplate } from './create-template'
export { deleteTemplate } from './delete-template'
export { duplicateTemplate } from './duplicate-template'
// Export service functions
export { getAllTemplates } from './get-all-templates'
export { getTemplateById } from './get-template-by-id'
// Export types
export type {
  CreateWorkflowTemplateInput,
  GetWorkflowTemplatesInput,
  UpdateWorkflowTemplateInput,
  WorkflowTemplateDetail,
  WorkflowTemplateListItem,
} from './types'
export { updateTemplate } from './update-template'
