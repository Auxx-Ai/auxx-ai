// packages/lib/src/entity-templates/index.ts

export { appTemplateId, projectAppConnectorTemplates } from './app-template-projector'
export {
  getAppTemplates,
  getOrgTemplateSummaries,
  resolveOrgTemplateById,
  resolveOrgTemplatesByIds,
} from './org-templates'
export type { InstallTemplatesOptions, InstallTemplatesResult } from './template-installer'
export { installTemplates } from './template-installer'
export type { TemplateSummary } from './template-registry'
export { getAllTemplates, getTemplateById, getTemplatesByIds } from './template-registry'
export type { ConflictResolution, EntityTemplate, EntityTemplateField } from './types'
